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
   *   - macOS   → `xcode-select --install` (the standard git provisioning on
   *     Mac); fall back to the link.
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

    const installCmd = platform === 'win32'
      ? 'winget install --id Git.Git -e --source winget'
      : 'xcode-select --install';

    const confirmed = await vscode.window.showInformationMessage(
      'AIDLC requires `git` (used to resolve variant access and clone custom forks). Install it now?',
      { detail: `This will run: ${installCmd}`, modal: true },
      'Install Git',
      'Cancel'
    );

    if (confirmed !== 'Install Git') {
      return false;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Installing Git...',
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: 'Downloading and installing...' });
          this.outputChannel.appendLine(`Running: ${installCmd}`);
          const { stdout, stderr } = await execAsync(installCmd, {
            timeout: 300000,
            env: { ...process.env },
          });
          if (stdout) { this.outputChannel.appendLine(stdout); }
          if (stderr) { this.outputChannel.appendLine(stderr); }

          progress.report({ message: 'Verifying...' });
          const result = await this.check();

          if (result.installed) {
            vscode.window.showInformationMessage(
              `git v${result.version ?? 'installed'} installed.` +
                (platform === 'darwin'
                  ? ' You may need to complete the macOS Command Line Tools dialog first.'
                  : ' Reload the window if git is not yet detected.')
            );
            return true;
          }

          // Install ran but git isn't detectable yet — offer the manual link.
          // On macOS xcode-select opens an OS dialog that finishes out of band.
          this.showManualInstallFallback(downloadUrl, platform === 'darwin'
            ? 'Finish the macOS Command Line Tools installation, then reload the window.'
            : 'git installation could not be verified. You may need to install it manually.');
          return false;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.outputChannel.appendLine(`git installation failed: ${message}`);
          this.showManualInstallFallback(
            downloadUrl,
            `Failed to install git automatically: ${message}. Install it manually.`
          );
          return false;
        }
      }
    );
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
