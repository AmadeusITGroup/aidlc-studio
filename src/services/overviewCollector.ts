import * as vscode from 'vscode';
import { StateManager } from './stateManager';
import { StateParser } from './stateParser';
import { KbHealth, absentKbHealth, readKbHealth } from './documentKbReader';
import { studioSpace } from './spaces';
import { WorkflowState } from '../types';

// Builds the model of the Overview tree view, read-only, from:
//   - the active intent's state (StateManager),
//   - intents.json (the registry: count and status) and ONE state file per
//     intent (gates open), and
//   - the space's DocumentKB index.json and the codekb/ directory names.
// It deliberately does not use AnalyticsCollector.collectGlobal: that one also
// reads every audit shard and walks every artifact directory, which is too much
// work for a view that refreshes on every state write.
//
// Framework source: .kiro/tools/aidlc-lib.ts (IntentRegistryEntry, readIntentRegistry,
//   intentsRegistryPath; dirName is optional in a registry row)

export type AttentionKind = 'gate' | 'rework' | 'kb-unreadable' | 'kb-remedy' | 'no-code-map';

export interface AttentionItem {
  kind: AttentionKind;
  label: string;
  stageId?: string;
  detail?: string; // longer text for the tooltip (never the label)
}

export interface OverviewLifecycle {
  hasIntent: boolean;
  intentLabel: string | null;
  progressDone: number; // state.stagesCompleted: the same numbers as Workflow Progress
  progressTotal: number; // state.stagesTotal
  complete: boolean;
  phase: string | null; // null while the scope is not decided (no stages planned)
  now: string | null; // the current stage name; null when nothing is planned or all is done
  gatesOpen: number;
}

export interface OverviewPod {
  intentsRunning: number; // intents with status 'in-flight'
  intentsTotal: number;
  gatesOpen: number; // stages awaiting approval, summed over the intents of the space
  codeMaps: string[]; // repo names under aidlc/spaces/<space>/codekb/<repo>/ holding a file
  knowledge: KbHealth;
}

export interface OverviewModel {
  space: string;
  needsAttention: AttentionItem[];
  lifecycle: OverviewLifecycle;
  pod: OverviewPod;
}

/** One registry row with the number of its stages awaiting approval. */
export interface OverviewIntent {
  status: string;
  stagesAwaiting: number;
}

export interface OverviewInput {
  space: string;
  state: WorkflowState | null;
  intents: ReadonlyArray<OverviewIntent>;
  knowledge: KbHealth;
  codeMaps: string[];
}

export const KB_UNREADABLE_LABEL = 'Knowledge catalog unreadable';
const MAX_DETAIL_LENGTH = 300;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const PHASE_NAMES = ['Initialization', 'Ideation', 'Inception', 'Construction', 'Operation'];

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Pure: builds the model from already-read inputs. */
export function buildOverviewModel(input: OverviewInput): OverviewModel {
  const { state, intents, knowledge, codeMaps } = input;
  const stages = state?.stages ?? [];
  const awaiting = stages.filter((s) => s.status === 'awaiting-approval');
  const revised = stages.filter((s) => s.status === 'revised');

  const needsAttention: AttentionItem[] = [];
  for (const stage of awaiting) {
    needsAttention.push({ kind: 'gate', label: `Gate: ${stage.id} ${stage.name}`, stageId: stage.id });
  }
  for (const stage of revised) {
    needsAttention.push({ kind: 'rework', label: `Rework: ${stage.id} ${stage.name}`, stageId: stage.id });
  }
  if (knowledge.state === 'unreadable') {
    needsAttention.push({
      kind: 'kb-unreadable',
      label: KB_UNREADABLE_LABEL,
      detail: truncate(knowledge.error ?? 'The DocumentKB index cannot be read', MAX_DETAIL_LENGTH),
    });
  } else if (knowledge.needsRemedy > 0) {
    const n = knowledge.needsRemedy;
    needsAttention.push({
      kind: 'kb-remedy',
      label: `${n} knowledge ${plural(n, 'document needs', 'documents need')} a remedy`,
    });
  }
  if (state !== null && state.workspace.type === 'brownfield' && codeMaps.length === 0) {
    needsAttention.push({ kind: 'no-code-map', label: 'No code map yet' });
  }

  const planned = stages.length > 0;
  const complete = planned && state !== null && state.stagesCompleted >= state.stagesTotal && state.stagesTotal > 0;
  const currentStage = state ? stages.find((s) => s.id === state.currentStageId) : undefined;

  return {
    space: input.space,
    needsAttention,
    lifecycle: {
      hasIntent: state !== null,
      intentLabel: state?.intent.label ?? null,
      progressDone: state?.stagesCompleted ?? 0,
      progressTotal: state?.stagesTotal ?? 0,
      complete,
      phase: state && planned ? PHASE_NAMES[state.currentPhase] ?? `Phase ${state.currentPhase}` : null,
      now: state && planned && !complete ? currentStage?.name ?? state.currentStageId : null,
      gatesOpen: awaiting.length,
    },
    pod: {
      intentsRunning: intents.filter((i) => i.status === 'in-flight').length,
      intentsTotal: intents.length,
      gatesOpen: intents.reduce((sum, i) => sum + i.stagesAwaiting, 0),
      codeMaps,
      knowledge,
    },
  };
}

/**
 * Names of the code maps: `aidlc/spaces/<space>/codekb/<repo>/` directories that
 * hold at least one file. Symbolic links are not followed. Read-only.
 *
 * Framework source: .kiro/tools/aidlc-lib.ts (codekbDir)
 */
export async function readCodeMaps(workspaceUri: vscode.Uri, space: string = studioSpace()): Promise<string[]> {
  const root = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', space, 'codekb');
  let repos: [string, vscode.FileType][];
  try {
    repos = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const [name, type] of repos) {
    if (name.startsWith('.') || (type & vscode.FileType.Directory) === 0 || (type & vscode.FileType.SymbolicLink) !== 0) {
      continue;
    }
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, name));
      if (files.some(([, t]) => (t & vscode.FileType.File) !== 0 && (t & vscode.FileType.SymbolicLink) === 0)) {
        names.push(name);
      }
    } catch { /* unreadable repo dir: not a code map */ }
  }
  return names.sort();
}

/** Size cap for intents.json, a committed (untrusted) file: 5 MB. */
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024;

/** A registry row reduced to what the Overview needs. */
export interface RegistryRow {
  status: string;
  dirName: string | null; // null: the row has no usable record dir name
}

// The record dir name is joined into a path: one plain segment only.
function safeDirName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..') { return null; }
  return /[\\/\0]/.test(value) ? null : value;
}

/**
 * Parses the text of intents.json. Pure. Like the framework's readIntentRegistry,
 * anything that is not a JSON array reads as an empty registry; entries that are
 * not objects are ignored.
 */
export function parseIntentRegistry(text: string): RegistryRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) { return []; }
  const rows: RegistryRow[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) { continue; }
    const row = entry as Record<string, unknown>;
    rows.push({
      status: typeof row.status === 'string' ? row.status : 'unknown',
      dirName: safeDirName(row.dirName),
    });
  }
  return rows;
}

/** The parts of StateParser the collector uses (a test double satisfies it). */
export type StateFileReader = Pick<StateParser, 'parseStateFile'>;

/**
 * Reads intents.json of the space, then ONE state file per intent for the number
 * of stages awaiting approval. It reads nothing else: no audit shard, no artifact
 * directory. A missing registry is an empty list; a row without a usable dirName
 * or with an unreadable state counts as an intent with no open gate.
 */
export async function readOverviewIntents(
  workspaceUri: vscode.Uri,
  space: string = studioSpace(),
  reader: StateFileReader = new StateParser()
): Promise<OverviewIntent[]> {
  const intentsDir = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', space, 'intents');
  let rows: RegistryRow[];
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(intentsDir, 'intents.json'));
    rows = bytes.byteLength > MAX_REGISTRY_BYTES ? [] : parseIntentRegistry(Buffer.from(bytes).toString('utf-8'));
  } catch {
    return [];
  }
  return Promise.all(
    rows.map(async (row) => {
      if (row.dirName === null) { return { status: row.status, stagesAwaiting: 0 }; }
      const state = await reader
        .parseStateFile(vscode.Uri.joinPath(intentsDir, row.dirName, 'aidlc-state.md'))
        .catch(() => null);
      const stagesAwaiting = state?.stages.filter((s) => s.status === 'awaiting-approval').length ?? 0;
      return { status: row.status, stagesAwaiting };
    })
  );
}

/** Reads the inputs and builds the model. */
export class OverviewCollector {
  constructor(
    private readonly stateManager: StateManager,
    private readonly stateReader: StateFileReader = new StateParser()
  ) {}

  async collect(): Promise<OverviewModel> {
    const space = studioSpace();
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) {
      return buildOverviewModel({ space, state: null, intents: [], knowledge: absentKbHealth(space), codeMaps: [] });
    }

    const [state, intents, knowledge, codeMaps] = await Promise.all([
      this.stateManager.getCurrentState().catch(() => null),
      readOverviewIntents(workspaceUri, space, this.stateReader).catch(() => []),
      readKbHealth(workspaceUri, space),
      readCodeMaps(workspaceUri, space),
    ]);

    return buildOverviewModel({ space, state, intents, knowledge, codeMaps });
  }
}
