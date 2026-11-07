import * as vscode from 'vscode';

/**
 * Reads the per-repo AIDLC framework-rules version from the workspace's
 * `.kiro/tools/aidlc-version.ts`, whose single source of truth is the
 * hand-edited constant:
 *
 *   export const AIDLC_VERSION = "2.5.67";
 *
 * This is the version of the framework rules configured IN this repo, which is
 * a different question from which CLI the user has installed globally. The two
 * can legitimately differ.
 *
 * READ-ONLY: the file is parsed as TEXT (never imported or executed) so the
 * extension never runs the framework's TS. The pure parser below has no
 * `vscode` dependency and is unit-tested in isolation; the thin fs wrapper
 * wires it to the workspace filesystem and never throws.
 */

/** Workspace-relative path to the repo's version constant file. */
export const REPO_VERSION_FILE_RELPATH = '.kiro/tools/aidlc-version.ts';

/**
 * Parse the `AIDLC_VERSION` constant out of the given file text. Tolerant of
 * single or double quotes and extra whitespace around the `=`. Returns the
 * version string, or null when the export is absent or malformed. Pure — never
 * throws, no I/O.
 */
export function parseRepoAidlcVersion(fileText: string): string | null {
  if (!fileText) { return null; }
  const match = fileText.match(/AIDLC_VERSION\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * Read and parse the repo's `.kiro/tools/aidlc-version.ts`. Returns the version
 * string, or null when the file is absent or unparseable. Never throws.
 */
export async function readRepoAidlcVersion(workspaceUri: vscode.Uri): Promise<string | null> {
  try {
    const fileUri = vscode.Uri.joinPath(workspaceUri, ...REPO_VERSION_FILE_RELPATH.split('/'));
    const content = await vscode.workspace.fs.readFile(fileUri);
    return parseRepoAidlcVersion(Buffer.from(content).toString('utf-8'));
  } catch {
    return null;
  }
}
