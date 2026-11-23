import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
}

/**
 * Parse the semver out of `git --version` output, e.g. "git version 2.43.0"
 * or "git version 2.43.0.windows.1" → "2.43.0". Returns undefined when no
 * version-like token is present. Pure/unit-testable.
 */
export function parseGitVersion(stdout: string): string | undefined {
  const match = stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Per-platform download link shown when git can't be self-installed. Git has
 * no clean universal silent installer, so we always offer the official page as
 * a graceful fallback (mirrors how BunInstaller offers its install guide).
 */
export function gitDownloadUrl(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'https://git-scm.com/download/win';
    case 'darwin':
      return 'https://git-scm.com/download/mac';
    default:
      return 'https://git-scm.com/download/linux';
  }
}

/**
 * Installs / detects the `git` CLI. Modeled on BunInstaller, but simpler: git
 * installers put git on the GLOBAL PATH, so (unlike bun) there is no
 * non-interactive-PATH rc-file writing to do.
 */
export class GitInstaller {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  /**
   * Check whether git is installed. Runs `git --version`, parses the semver,
   * and tries to resolve its path (`where git` / `which git`). Swallows every
   * failure to `{ installed: false }`.
   */
  async check(): Promise<GitCheckResult> {
    try {
      const { stdout } = await execAsync('git --version', { timeout: 10000 });
      const version = parseGitVersion(stdout.trim());
      this.outputChannel.appendLine(`git detected on PATH: ${version ? `v${version}` : stdout.trim()}`);

      let gitPath: string | undefined;
      try {
        const whichCmd = process.platform === 'win32' ? 'where git' : 'which git';
        const { stdout: pathOut } = await execAsync(whichCmd, { timeout: 5000 });
        gitPath = pathOut.trim().split('\n')[0]?.trim() || undefined;
      } catch { /* non-critical */ }

      return { installed: true, version, path: gitPath };
    } catch {
      this.outputChannel.appendLine('git not found');
      return { installed: false };
    }
  }

  /**
   * Attempt a per-platform install, degrading gracefully to a "install
   * manually" link when it can't self-install:
   *   - Windows → `winget install --id Git.Git -e --source winget`; if winget
   *     is absent/fails, show the download link.
   *   - macOS   → a graceful ladder that NEVER installs a package manager
   *     itself (see installMac): use Homebrew if present (`brew install git`),
   *     else rely on / trigger Apple Command Line Tools, else the link.
   *   - Linux   → do NOT attempt a package-manager install blindly; show the
   *     link with a note to use the distro package manager.
   * Always confirms with a modal before running anything.
   */
  async install(): Promise<boolean> {
    const platform = process.platform;
    const downloadUrl = gitDownloadUrl(platform);

    // Linux: never run a blind package-manager install — just point the user
    // at the official download/instructions.
    if (platform === 'linux') {
      vscode.window.showWarningMessage(
        'AIDLC uses `git`. On Linux, install it with your distribution package manager ' +
          '(e.g. `apt install git`, `dnf install git`).',
        'Open Install Guide'
      ).then((a) => {
        if (a === 'Open Install Guide') {
          vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
        }
      });
      return false;
    }

    if (platform === 'darwin') {
      return this.installMac(downloadUrl);
    }

    return this.installWindows(downloadUrl);
  }

  /**
   * Windows install: winget (non-interactive), falling back to the link.
   */
  private async installWindows(downloadUrl: string): Promise<boolean> {
    const installCmd = 'winget install --id Git.Git -e --source winget';

    const confirmed = await vscode.window.showInformationMessage(
      'AIDLC requires `git` (used to resolve variant access and clone custom forks). Install it now?',
      { detail: `This will run: ${installCmd}`, modal: true },
      'Install Git',
      'Cancel'
    );
    if (confirmed !== 'Install Git') { return false; }

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Installing Git...', cancellable: false },
      async (progress) => {
        try {
          progress.report({ message: 'Downloading and installing...' });
          this.outputChannel.appendLine(`Running: ${installCmd}`);
          const { stdout, stderr } = await execAsync(installCmd, { timeout: 300000, env: { ...process.env } });
          if (stdout) { this.outputChannel.appendLine(stdout); }
          if (stderr) { this.outputChannel.appendLine(stderr); }

          progress.report({ message: 'Verifying...' });
          const result = await this.check();
          if (result.installed) {
            vscode.window.showInformationMessage(
              `git v${result.version ?? 'installed'} installed. Reload the window if git is not yet detected.`
            );
            return true;
          }
          this.showManualInstallFallback(
            downloadUrl,
            'git was installed but is not on PATH yet. Reload the window, or install it manually.'
          );
          return false;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.outputChannel.appendLine(`git installation failed: ${message}`);
          this.showManualInstallFallback(
            downloadUrl,
            `Could not install git via winget automatically: ${message}. Install it manually.`
          );
          return false;
        }
      }
    );
  }

  /**
   * macOS install ladder. We deliberately NEVER install Homebrew ourselves —
   * that is a heavy, system-altering, possibly-sudo operation that is the wrong
   * blast radius for a one-click "install git". Instead we use what is already
   * present:
   *   1. Homebrew present      → `brew install git` (clean, git-only).
   *   2. Command Line Tools    → git already comes with CLT; just verify.
   *      already installed
   *   3. otherwise             → `xcode-select --install` (Apple's own GUI
   *      provisioning; finishes out of band), then tell the user to finish the
   *      dialog and reload.
   *   4. anything unexpected   → the official download link.
   */
  private async installMac(downloadUrl: string): Promise<boolean> {
    const brew = await this.commandExists('brew');

    // Decide the plan + the modal copy up front so the confirm is honest.
    let plan: 'brew' | 'xcode';
    let detail: string;
    if (brew) {
      plan = 'brew';
      detail = 'This will run: brew install git';
    } else {
      plan = 'xcode';
      detail =
        'Homebrew was not found. This will run `xcode-select --install`, which opens the ' +
        'macOS Command Line Tools installer (this provides git). We will NOT install Homebrew.';
    }

    const confirmed = await vscode.window.showInformationMessage(
      'AIDLC requires `git` (used to resolve variant access and clone custom forks). Install it now?',
      { detail, modal: true },
      'Install Git',
      'Cancel'
    );
    if (confirmed !== 'Install Git') { return false; }

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Installing Git...', cancellable: false },
      async (progress) => {
        if (plan === 'brew') {
          try {
            progress.report({ message: 'Installing via Homebrew...' });
            this.outputChannel.appendLine('Running: brew install git');
            const { stdout, stderr } = await execAsync('brew install git', { timeout: 600000, env: { ...process.env } });
            if (stdout) { this.outputChannel.appendLine(stdout); }
            if (stderr) { this.outputChannel.appendLine(stderr); }

            progress.report({ message: 'Verifying...' });
            const result = await this.check();
            if (result.installed) {
              vscode.window.showInformationMessage(`git v${result.version ?? 'installed'} installed via Homebrew.`);
              return true;
            }
            this.showManualInstallFallback(downloadUrl, 'brew install git ran but git is not detectable. Reload the window, or install manually.');
            return false;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`brew install git failed: ${message}`);
            this.showManualInstallFallback(downloadUrl, `Homebrew install failed: ${message}. Install git manually.`);
            return false;
          }
        }

        // plan === 'xcode': trigger Apple Command Line Tools.
        try {
          progress.report({ message: 'Opening Command Line Tools installer...' });
          this.outputChannel.appendLine('Running: xcode-select --install');
          const { stdout, stderr } = await execAsync('xcode-select --install', { timeout: 60000, env: { ...process.env } });
          if (stdout) { this.outputChannel.appendLine(stdout); }
          if (stderr) { this.outputChannel.appendLine(stderr); }
        } catch (error) {
          // "already installed" is reported as an error by xcode-select — not a
          // real failure. If git is actually present, treat it as success.
          const message = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`xcode-select --install: ${message}`);
          if (/already installed|command line tools are already/i.test(message)) {
            const result = await this.check();
            if (result.installed) {
              vscode.window.showInformationMessage(`git v${result.version ?? 'installed'} already available via Command Line Tools.`);
              return true;
            }
          }
        }

        // xcode-select --install finishes out of band via an OS dialog; git is
        // typically NOT available this same session. Guide the user.
        const result = await this.check();
        if (result.installed) {
          vscode.window.showInformationMessage(`git v${result.version ?? 'installed'} installed.`);
          return true;
        }
        this.showManualInstallFallback(
          downloadUrl,
          'Finish the macOS "Command Line Tools" installation dialog, then reload the window. ' +
            'If it does not appear, install git manually.'
        );
        return false;
      }
    );
  }

  /**
   * Whether a command is resolvable on PATH (e.g. `brew`). Uses `which` on
   * Unix. Returns false on any failure. Never throws.
   */
  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const probe = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
      const { stdout } = await execAsync(probe, { timeout: 5000 });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private showManualInstallFallback(downloadUrl: string, message: string): void {
    vscode.window.showWarningMessage(message, 'Open Install Guide').then((a) => {
      if (a === 'Open Install Guide') {
        vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
      }
    });
  }

  /**
   * Ensure git is available — check first, install if missing.
   */
  async ensure(): Promise<boolean> {
    const result = await this.check();
    if (result.installed) {
      return true;
    }
    return this.install();
  }
}
