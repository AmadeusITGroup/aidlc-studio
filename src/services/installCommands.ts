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

/** A terminal launch spec: the shell to open and the line to send to it. */
export interface InstallerTerminal {
  shellPath: string;
  command: string;
}

/**
 * Build the OFFICIAL Amadeus AI-DLC 2.10 "Set up your machine" command
 * (README section 1) for the given platform, plus the shell it must run in.
 *
 *  - Windows (PowerShell, NOT as administrator): download the ps1 to %TEMP%,
 *    run it, then delete it. Download-then-run is the only valid shape
 *    (`-File <url>` and `irm | iex` do not work with this installer).
 *  - macOS / Linux: `bash <(curl -fsSL <url>)`. Process substitution needs
 *    bash, so the terminal is bash (not sh).
 *
 * No skip flags and no `--preview`: the README base command has none, and the
 * interactive terminal lets the installer's credentials prompt work.
 */
export function buildAmadeusInstallerTerminal(
  platform: NodeJS.Platform,
  urls: { unix: string; windows: string }
): InstallerTerminal {
  if (platform === 'win32') {
    return {
      shellPath: 'powershell.exe',
      command:
        '$f = Join-Path $env:TEMP "install-aidlc.ps1"; ' +
        `curl.exe -fsSL ${urls.windows} -o $f; ` +
        'powershell -ExecutionPolicy Bypass -File $f; ' +
        'Remove-Item $f',
    };
  }
  return {
    shellPath: '/bin/bash',
    command: `bash <(curl -fsSL ${urls.unix})`,
  };
}

/**
 * One-line hint with the exact official command, for error messages shown
 * when an Amadeus flow fails and the user must run the installer by hand.
 */
export function amadeusManualInstallHint(
  platform: NodeJS.Platform,
  urls: { unix: string; windows: string }
): string {
  const { command } = buildAmadeusInstallerTerminal(platform, urls);
  const where = platform === 'win32' ? 'PowerShell (not as administrator)' : 'a bash terminal';
  return `To install it manually, run this in ${where}: ${command}`;
}

/**
 * The README next steps shown right after the installer terminal is launched.
 */
export function amadeusInstallNextSteps(platform: NodeJS.Platform): string {
  const after =
    platform === 'win32'
      ? 'When the installer finishes, quit and reopen this editor so the new PATH is picked up. ' +
        'It must run in PowerShell, not as administrator.'
      : 'When the installer finishes, open a new terminal so the new PATH is picked up.';
  return (
    `The Amadeus AI-DLC installer is running in the "AIDLC Installer" terminal. ${after} ` +
    'Then run Setup again to configure this project. If you skipped the credentials prompt, ' +
    'run `eve credentials amaiisdom <your-username>` before the first workflow.'
  );
}

/**
 * Build the access probe for a URL-gated installer: a short-timeout HEAD
 * request. `curl.exe` on Windows (so PowerShell's `curl` alias is never hit);
 * `curl` elsewhere. `-f` makes HTTP 4xx/5xx a non-zero exit.
 */
export function buildAccessProbeCommand(platform: NodeJS.Platform, url: string): string {
  const curl = platform === 'win32' ? 'curl.exe' : 'curl';
  return `${curl} -fsS -I --max-time 10 "${url}"`;
}

/**
 * True when `aidlc doctor` output says `aidlc` resolves only through the
 * interactive PATH (so the IDE's hook shells can't find it). The official fix
 * is `aidlc config runtime`.
 */
export function doctorReportsInteractiveOnlyPath(text: string | undefined): boolean {
  return /interactive[\s-]+only|only\s+(?:through|via|in)\s+the\s+interactive|interactive\s+PATH/i.test(
    text ?? ''
  );
}

/** True when `aidlc config` output/error reports a file conflict. */
export function reportsConfigConflict(text: string | undefined): boolean {
  return /conflict/i.test(text ?? '');
}

/**
 * Build the Amadeus official one-click repo-installer invocation for the given
 * platform. The script is a LOCAL file inside the cloned repo (not a remote
 * URL), so Windows runs it with `-File` and Unix invokes it with `sh`.
 *
 * LEGACY (AI-DLC 2.5 layout): the `-Target`/`-Harness` flags are legacy-only on
 * the 2.10+ installer. Retained ONLY for the explicit git-clone-copy custom
 * fork path; the Amadeus variant never uses this.
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
