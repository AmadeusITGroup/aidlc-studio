import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface BunCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
  onPath?: boolean;
}

export class BunInstaller {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  /**
   * The default bun binary location.
   */
  private get bunBinDir(): string {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), '.bun', 'bin');
    }
    return path.join(os.homedir(), '.bun', 'bin');
  }

  private get bunBinary(): string {
    const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
    return path.join(this.bunBinDir, exe);
  }

  /**
   * Check if bun is installed. Checks PATH first, then the default install
   * location (~/.bun/bin) since Kiro's non-interactive shells may not have
   * bun on PATH even when it's installed.
   */
  async check(): Promise<BunCheckResult> {
    // First: is bun on PATH?
    try {
      const { stdout } = await execAsync('bun --version', { timeout: 10000 });
      const version = stdout.trim();
      this.outputChannel.appendLine(`bun detected on PATH: v${version}`);

      let bunPath: string | undefined;
      try {
        const whichCmd = process.platform === 'win32' ? 'where bun' : 'which bun';
        const { stdout: pathOut } = await execAsync(whichCmd, { timeout: 5000 });
        bunPath = pathOut.trim().split('\n')[0];
      } catch { /* non-critical */ }

      return { installed: true, version, path: bunPath, onPath: true };
    } catch {
      // Not on PATH — check the default install location
      if (fs.existsSync(this.bunBinary)) {
        try {
          const { stdout } = await execAsync(`"${this.bunBinary}" --version`, { timeout: 10000 });
          const version = stdout.trim();
          this.outputChannel.appendLine(`bun found at ${this.bunBinary} (v${version}) but NOT on PATH`);
          return { installed: true, version, path: this.bunBinary, onPath: false };
        } catch { /* corrupt binary */ }
      }

      this.outputChannel.appendLine('bun not found');
      return { installed: false };
    }
  }

  /**
   * Install bun and ensure it's on PATH for Kiro's non-interactive shells.
   */
  async install(): Promise<boolean> {
    const platform = process.platform;

    const installCmd = platform === 'win32'
      ? 'powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex"'
      : 'curl -fsSL https://bun.sh/install | bash';

    const confirmed = await vscode.window.showInformationMessage(
      'AIDLC requires `bun` (a JavaScript runtime used by AIDLC hooks and tools). Install it now?',
      { detail: `This will run: ${installCmd}`, modal: true },
      'Install bun',
      'Cancel'
    );

    if (confirmed !== 'Install bun') {
      return false;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Installing bun...',
        cancellable: false,
      },
      async (progress) => {
        try {
          // If already at the install location, skip download
          if (!fs.existsSync(this.bunBinary)) {
            progress.report({ message: 'Downloading and installing...' });
            this.outputChannel.appendLine(`Running: ${installCmd}`);
            const { stdout, stderr } = await execAsync(installCmd, {
              timeout: 120000,
              env: { ...process.env },
            });
            if (stdout) { this.outputChannel.appendLine(stdout); }
            if (stderr) { this.outputChannel.appendLine(stderr); }
          } else {
            this.outputChannel.appendLine('bun binary already present, ensuring PATH only.');
          }

          // Critical: ensure bun is on PATH for NON-INTERACTIVE shells
          progress.report({ message: 'Configuring PATH for Kiro shells...' });
          const pathConfigured = await this.ensureBunOnPath();

          progress.report({ message: 'Verifying...' });
          const result = await this.check();

          if (result.installed && result.onPath) {
            vscode.window.showInformationMessage(`bun v${result.version} installed and on PATH.`);
            return true;
          } else if (result.installed) {
            // Installed + env file written, but current process PATH not refreshed
            const action = await vscode.window.showWarningMessage(
              `bun v${result.version} installed. ${pathConfigured ? 'PATH configured for Kiro shells — reload the window to activate.' : 'You may need to restart your terminal.'}`,
              'Reload Window',
              'Later'
            );
            if (action === 'Reload Window') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            return true;
          } else {
            vscode.window.showWarningMessage(
              'bun installation could not be verified. You may need to install it manually.',
              'Open Install Guide'
            ).then((a) => {
              if (a === 'Open Install Guide') {
                vscode.env.openExternal(vscode.Uri.parse('https://bun.sh/docs/installation'));
              }
            });
            return false;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.outputChannel.appendLine(`bun installation failed: ${message}`);
          vscode.window.showErrorMessage(
            `Failed to install bun: ${message}. Install manually: https://bun.sh/docs/installation`,
            'Open Install Guide'
          ).then((action) => {
            if (action === 'Open Install Guide') {
              vscode.env.openExternal(vscode.Uri.parse('https://bun.sh/docs/installation'));
            }
          });
          return false;
        }
      }
    );
  }

  /**
   * Ensure bun's bin dir is exported in the shell env files that
   * NON-INTERACTIVE shells read (the ones Kiro uses to run hooks/tools).
   *
   * - zsh non-interactive reads ~/.zshenv (NOT ~/.zshrc)
   * - bash non-interactive reads ~/.bashrc
   * - Windows: bun installer adds to the user PATH env var via registry
   *
   * Returns true if a config file was written/updated.
   */
  private async ensureBunOnPath(): Promise<boolean> {
    if (process.platform === 'win32') {
      // The bun PowerShell installer updates the user PATH env var (registry).
      // Also update the current process env so it's usable this session.
      process.env.PATH = `${this.bunBinDir};${process.env.PATH ?? ''}`;
      this.outputChannel.appendLine('Windows: bun installer updated user PATH (registry). Reload to pick it up.');
      return true;
    }

    // Unix: write the export to the non-interactive shell env files
    const home = os.homedir();
    const exportBlock = [
      '',
      '# AIDLC Studio — bun on PATH for non-interactive shells',
      'export BUN_INSTALL="$HOME/.bun"',
      'export PATH="$BUN_INSTALL/bin:$PATH"',
      '',
    ].join('\n');
    const marker = 'AIDLC Studio — bun on PATH';

    // zsh non-interactive → ~/.zshenv ; bash non-interactive → ~/.bashrc
    const targets = [
      path.join(home, '.zshenv'),
      path.join(home, '.bashrc'),
    ];

    let wroteAny = false;
    for (const file of targets) {
      try {
        let content = '';
        if (fs.existsSync(file)) {
          content = fs.readFileSync(file, 'utf-8');
        }
        if (content.includes(marker)) {
          this.outputChannel.appendLine(`bun PATH already configured in ${file}`);
          continue;
        }
        fs.appendFileSync(file, exportBlock, 'utf-8');
        this.outputChannel.appendLine(`Added bun to PATH in ${file}`);
        wroteAny = true;
      } catch (e) {
        this.outputChannel.appendLine(`Could not update ${file}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Also update current process PATH so it works this session
    process.env.BUN_INSTALL = path.join(home, '.bun');
    process.env.PATH = `${this.bunBinDir}:${process.env.PATH ?? ''}`;

    return wroteAny;
  }

  /**
   * Ensure bun is available — check first, install if missing.
   * If installed but not on PATH, fix the PATH.
   */
  async ensure(): Promise<boolean> {
    const result = await this.check();
    if (result.installed && result.onPath) {
      return true;
    }
    if (result.installed && !result.onPath) {
      // Installed but not on PATH — fix it silently
      this.outputChannel.appendLine('bun installed but not on PATH — configuring...');
      await this.ensureBunOnPath();
      return true;
    }
    return this.install();
  }
}
