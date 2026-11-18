import * as vscode from 'vscode';
import * as path from 'path';
import { StateParser } from './stateParser';
import { studioSpace } from './spaces';
import {
  LifecycleInput, LifecycleModel, LifecycleResult, MAX_FILE_BYTES, buildLifecycleModel, isSafeSegment,
} from './lifecycleModel';

/**
 * Reads the files of one intent for the Analytics "Lifecycle" tab and hands them to the pure
 * builder in `lifecycleModel.ts`. Everything the model exports is re-exported here, so a
 * consumer may import from either module (a vscode-free consumer should import the model).
 *
 * Read-only: `vscode.workspace.fs` reads and directory listings only; no write, no shell, no
 * network. Every file is untrusted input: size-capped, and listed by a bounded walk.
 */
export * from './lifecycleModel';

type ReadResult =
  | { kind: 'missing' }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; detail: string; tooLarge: boolean };

/** `<record>/<phase>/<stage>/<sub>/<file>` and `<record>/construction/<unit>/<stage>/<file>`. */
const MAX_RECORD_DEPTH = 3;
// Framework source: .kiro/tools/aidlc-lib.ts (codekbDir, relativeCodekbDir): the codekb of a space is
// `aidlc/spaces/<space>/codekb/<repo>/<file>`, a sibling of `intents/`, shared by every intent.
/** `<codekb>/<repo>/<file>`. */
const MAX_CODEKB_DEPTH = 1;
const MAX_WALK_FILES = 5000;

const TOO_LARGE = 'file is larger than 2 MB';

/**
 * Reads the lifecycle of one intent. Read-only: `vscode.workspace.fs` reads and directory
 * listings only; no write, no shell, no network.
 */
export class LifecycleCollector {

  constructor(private readonly stateParser: StateParser = new StateParser()) {}

  /**
   * Same as `collectResult`, without the reason: null when there is no intent or its state file
   * cannot be read.
   */
  async collect(workspaceUri: vscode.Uri, intentDirName?: string): Promise<LifecycleModel | null> {
    const result = await this.collectResult(workspaceUri, intentDirName);
    return result.kind === 'ok' ? result.model : null;
  }

  /**
   * @param intentDirName record directory name under `aidlc/spaces/<space>/intents/`; the active
   *   intent (as StateParser.findActiveState resolves it) when omitted.
   * @returns `none` when no intent is active, `unreadable` (with a short reason) when an intent is
   *   named or active but its state file is missing, too large or unreadable, `ok` with the model.
   */
  async collectResult(workspaceUri: vscode.Uri, intentDirName?: string): Promise<LifecycleResult> {
    try {
      return await this.collectUnsafe(workspaceUri, intentDirName);
    } catch {
      return { kind: 'unreadable', reason: 'lifecycle data could not be read' };
    }
  }

  private async collectUnsafe(workspaceUri: vscode.Uri, intentDirName?: string): Promise<LifecycleResult> {
    const space = studioSpace();
    const spaceUri = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', space);
    const intentsDir = vscode.Uri.joinPath(spaceUri, 'intents');

    let dirName: string;
    if (intentDirName !== undefined) {
      if (!isSafeSegment(intentDirName) || intentDirName.startsWith('.')) {
        return { kind: 'unreadable', reason: 'intent directory name is not valid' };
      }
      dirName = intentDirName;
    } else {
      const active = await this.stateParser.findActiveState(workspaceUri);
      if (!active) { return { kind: 'none' }; }
      dirName = path.posix.basename(path.posix.dirname(active.path));
      // The pointer is untrusted: only an intent directly under intents/ is read.
      const expected = vscode.Uri.joinPath(intentsDir, dirName, 'aidlc-state.md');
      if (!isSafeSegment(dirName) || expected.path !== active.path) {
        return { kind: 'unreadable', reason: 'active intent is not a directory of intents/' };
      }
    }

    const recordUri = vscode.Uri.joinPath(intentsDir, dirName);
    const recordDir = `aidlc/spaces/${space}/intents/${dirName}`;
    const codekbUri = vscode.Uri.joinPath(spaceUri, 'codekb');
    const codekbDir = `aidlc/spaces/${space}/codekb`;

    const state = await this.readCapped(vscode.Uri.joinPath(recordUri, 'aidlc-state.md'));
    if (state.kind === 'missing') { return { kind: 'unreadable', reason: 'state file missing' }; }
    if (state.kind === 'error') {
      return { kind: 'unreadable', reason: state.tooLarge ? 'state file too large (over 2 MB)' : 'state file unreadable' };
    }

    const [stageGraph, runtimeGraph, dependencyDoc, files, codekbFiles] = await Promise.all([
      this.readCapped(vscode.Uri.joinPath(workspaceUri, '.kiro', 'tools', 'data', 'stage-graph.json')),
      this.readCapped(vscode.Uri.joinPath(recordUri, 'runtime-graph.json')),
      this.readCapped(vscode.Uri.joinPath(recordUri, 'inception', 'units-generation', 'unit-of-work-dependency.md')),
      this.listFiles(recordUri, recordDir, MAX_RECORD_DEPTH, ['audit']),
      this.listFiles(codekbUri, codekbDir, MAX_CODEKB_DEPTH, []),
    ]);

    const input: LifecycleInput = {
      stateText: state.text,
      stageGraphText: stageGraph.kind === 'ok' ? stageGraph.text : null,
      runtimeGraphText: runtimeGraph.kind === 'ok' ? runtimeGraph.text : null,
      dependencyDocText: dependencyDoc.kind === 'ok' ? dependencyDoc.text : null,
      dependencyDocError: dependencyDoc.kind === 'error' ? dependencyDoc.detail : null,
      recordDir,
      files,
      codekbDir,
      codekbFiles,
    };
    return { kind: 'ok', model: buildLifecycleModel(input) };
  }

  /** Reads a text file, refusing anything over 2 MB. */
  private async readCapped(uri: vscode.Uri): Promise<ReadResult> {
    let size: number;
    try {
      size = (await vscode.workspace.fs.stat(uri)).size;
    } catch {
      return { kind: 'missing' };
    }
    if (size > MAX_FILE_BYTES) { return { kind: 'error', detail: TOO_LARGE, tooLarge: true }; }
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      if (content.byteLength > MAX_FILE_BYTES) { return { kind: 'error', detail: TOO_LARGE, tooLarge: true }; }
      return { kind: 'ok', text: Buffer.from(content).toString('utf-8') };
    } catch (e) {
      return { kind: 'error', detail: e instanceof Error ? e.message : 'read failed', tooLarge: false };
    }
  }

  /**
   * Lists the files under `rootUri` down to `maxDepth` directory levels below the root, as
   * workspace-relative POSIX paths. Symbolic links and hidden directories are not followed, nor
   * are the `skipTop` directories directly under the root (the record's `audit/`); an unsafe
   * name is dropped; the walk stops at 5000 files.
   */
  private async listFiles(rootUri: vscode.Uri, rootRel: string, maxDepth: number, skipTop: string[]): Promise<string[]> {
    const out: string[] = [];
    const walk = async (uri: vscode.Uri, rel: string, depth: number): Promise<void> => {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(uri);
      } catch {
        return;
      }
      for (const [name, type] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
        if (out.length >= MAX_WALK_FILES) { return; }
        if (!isSafeSegment(name) || (type & vscode.FileType.SymbolicLink) !== 0) { continue; }
        if ((type & vscode.FileType.File) !== 0) {
          out.push(`${rel}/${name}`);
        } else if (
          (type & vscode.FileType.Directory) !== 0
          && depth < maxDepth
          && !name.startsWith('.')
          && !(depth === 0 && skipTop.includes(name))
        ) {
          await walk(vscode.Uri.joinPath(uri, name), `${rel}/${name}`, depth + 1);
        }
      }
    };
    await walk(rootUri, rootRel, 0);
    return out;
  }
}
