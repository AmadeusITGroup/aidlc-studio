import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Shared helper for the "append an export block to the non-interactive shell
 * env files (~/.zshenv, ~/.bashrc), guarded by a unique marker comment so it's
 * written only once" pattern. Both bun and the aidlc CLI need this on Unix so
 * that Kiro's non-interactive hook shells can find a binary installed under a
 * user bin dir (e.g. ~/.local/bin or ~/.bun/bin) that only the INTERACTIVE
 * login PATH would otherwise carry.
 *
 * Kept small and dependency-light (fs/os/path only, no vscode) so the
 * marker/idempotency decision is unit-testable.
 */

/**
 * The non-interactive shell env files to update, in order:
 *   - zsh non-interactive reads ~/.zshenv (NOT ~/.zshrc)
 *   - bash non-interactive reads ~/.bashrc
 */
export function nonInteractiveShellEnvFiles(home: string = os.homedir()): string[] {
  return [path.join(home, '.zshenv'), path.join(home, '.bashrc')];
}

/**
 * Decide whether a PATH export block needs to be appended to the given file
 * content. Idempotent: returns needsWrite=false when the marker is already
 * present. Pure — no I/O. `exportBlock` must contain `marker` (typically as a
 * comment) so a re-run detects the prior write.
 */
export function planPathExport(
  existingContent: string,
  exportBlock: string,
  marker: string
): { needsWrite: boolean; newContent: string } {
  if (existingContent.includes(marker)) {
    return { needsWrite: false, newContent: existingContent };
  }
  return { needsWrite: true, newContent: existingContent + exportBlock };
}

/**
 * Build the export block for adding a bin dir to PATH, guarded by `marker`.
 * The marker appears as a comment on the first line so planPathExport can
 * detect a prior write.
 */
export function buildPathExportBlock(marker: string, binDir: string): string {
  return [
    '',
    `# ${marker}`,
    `export PATH="${binDir}:$PATH"`,
    '',
  ].join('\n');
}

/**
 * Append `exportBlock` (guarded by `marker`) to each file in `files` that
 * doesn't already contain the marker. Creates files that don't exist. Never
 * throws — I/O failures are reported through onLog and skipped. Returns true
 * if at least one file was written.
 */
export function applyPathExport(
  files: string[],
  exportBlock: string,
  marker: string,
  onLog?: (message: string) => void
): boolean {
  let wroteAny = false;
  for (const file of files) {
    try {
      let content = '';
      if (fs.existsSync(file)) {
        content = fs.readFileSync(file, 'utf-8');
      }
      const { needsWrite, newContent } = planPathExport(content, exportBlock, marker);
      if (!needsWrite) {
        onLog?.(`PATH already configured in ${file}`);
        continue;
      }
      // Append only the delta so we don't rewrite the user's file wholesale.
      fs.appendFileSync(file, exportBlock, 'utf-8');
      void newContent; // newContent is the planned full content (for tests)
      onLog?.(`Added PATH export to ${file}`);
      wroteAny = true;
    } catch (e) {
      onLog?.(`Could not update ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return wroteAny;
}
