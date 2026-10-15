import * as path from 'path';

/**
 * Pure, dependency-free builders for the OFFICIAL AI-DLC install commands and
 * the known `aidlc` binary locations, factored out so OS-branching is unit
 * tested without executing real installers. No `vscode` import — callers pass
 * the platform explicitly so tests are deterministic regardless of host OS.
 */

/**
 * Build the AWS official native-install one-liner for the given platform.
 * Windows pipes the remote PowerShell installer into `iex`; Unix pipes the
 * remote shell installer into `sh` — mirroring the upstream README exactly.
 *
 * The `-Yes` flag is passed on Windows so the installer skips its interactive
 * UAC-elevation confirmation prompt.  When the extension runs the installer
 * via `child_process.exec`, stdin is redirected (non-interactive), which
 * causes the installer to abort with "Run the install command from a normal
 * PowerShell window" if `-Yes` is absent.
 */
export function buildNativeInstallCommand(platform: NodeJS.Platform, scriptUrl: string): string {
  if (platform === 'win32') {
    // Download the script text first, then invoke it with -Yes so the
    // non-interactive UAC confirmation check is bypassed.  Using a script
    // block lets us pass named parameters to the piped script.
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm '${scriptUrl}'))) -Yes"`;
  }
  return `curl -fsSL ${scriptUrl} | sh`;
}

/**
 * Ordered list of known `aidlc` binary locations for the given platform, used
 * to call the freshly-installed binary by absolute path when it isn't yet on
 * PATH in the current process.
 *
 * Windows: the AWS installer puts the binary at
 *   %LOCALAPPDATA%\aidlc\bin\aidlc   (no .exe extension, inside a bin\ subdir)
 * The legacy guess of aidlc.exe at the root is kept as a fallback.
 */
export function aidlcBinaryCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
    return [
      // Actual install location used by the AWS native installer (v2+)
      path.win32.join(localAppData, 'aidlc', 'bin', 'aidlc'),
      // Legacy / fallback guesses
      path.win32.join(home, '.aidlc', 'bin', 'aidlc.exe'),
      path.win32.join(localAppData, 'aidlc', 'aidlc.exe'),
    ];
  }
  return [
    path.posix.join(home, '.aidlc', 'bin', 'aidlc'),
    path.posix.join(home, '.local', 'bin', 'aidlc'),
    '/usr/local/bin/aidlc',
  ];
}

/**
 * Build the Amadeus official one-click repo-installer invocation for the given
 * platform. The script is a LOCAL file inside the cloned repo (not a remote
 * URL), so Windows runs it with `-File` and Unix invokes it with `sh`.
 */
export function buildRepoInstallerCommand(
  platform: NodeJS.Platform,
  scriptDir: string,
  targetDir: string,
  harness: string
): string {
  if (platform === 'win32') {
    const scriptPath = path.win32.join(scriptDir, 'install-aidlc.ps1');
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Target "${targetDir}" -Harness ${harness}`;
  }
  const scriptPath = path.posix.join(scriptDir, 'install-aidlc.sh');
  return `sh "${scriptPath}" --target "${targetDir}" --harness ${harness}`;
}
