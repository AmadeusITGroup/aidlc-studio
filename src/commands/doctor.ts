import * as vscode from 'vscode';
import { AidlcCli } from '../services/aidlcCli';
import { BunInstaller } from '../services/bunInstaller';

export class DoctorCommand {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  /**
   * Run /aidlc --doctor
   */
  async execute(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== /aidlc --doctor ===');

    // Pre-check: is bun available?
    const bunInstaller = new BunInstaller(this.outputChannel);
    const bunCheck = await bunInstaller.check();
    if (!bunCheck.installed) {
      this.outputChannel.appendLine('✗ bun not found — cannot run doctor');
      vscode.window.showErrorMessage(
        'bun is required to run /aidlc --doctor. Install it first.',
        'Install bun'
      ).then((action) => {
        if (action === 'Install bun') {
          bunInstaller.install();
        }
      });
      return;
    }

    const cli = new AidlcCli(this.outputChannel, workspaceFolder.uri);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Running /aidlc --doctor...',
        cancellable: false,
      },
      async () => {
        const result = await cli.doctor();

        this.outputChannel.appendLine('');
        if (result.passed) {
          const passCount = result.checks.filter((c) => c.passed).length;
          this.outputChannel.appendLine(`✓ All checks passed (${passCount} total)`);
          vscode.window.showInformationMessage(
            `AIDLC doctor: all ${passCount} checks passed.`
          );
        } else {
          this.outputChannel.appendLine(`✗ ${result.failures.length} failure(s):`);
          for (const f of result.failures) {
            this.outputChannel.appendLine(`  ✗ ${f}`);
          }
          if (result.warnings.length > 0) {
            this.outputChannel.appendLine(`⚠ ${result.warnings.length} warning(s):`);
            for (const w of result.warnings) {
              this.outputChannel.appendLine(`  ⚠ ${w}`);
            }
          }
          vscode.window.showWarningMessage(
            `AIDLC doctor: ${result.failures.length} failure(s). See output for details.`,
            'Show Output'
          ).then((action) => {
            if (action === 'Show Output') {
              this.outputChannel.show(true);
            }
          });
        }
      }
    );
  }

  /**
   * Run /aidlc --doctor --export
   */
  async executeExport(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== /aidlc --doctor --export ===');

    const cli = new AidlcCli(this.outputChannel, workspaceFolder.uri);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting AIDLC diagnostic report...',
        cancellable: false,
      },
      async () => {
        const result = await cli.doctorExport();

        if (result.success) {
          this.outputChannel.appendLine('✓ Diagnostic report exported.');
          this.outputChannel.appendLine(result.stdout);

          vscode.window.showInformationMessage(
            'AIDLC diagnostic report exported to aidlc/diagnostics/',
            'Open Folder'
          ).then((action) => {
            if (action === 'Open Folder') {
              const diagUri = vscode.Uri.joinPath(workspaceFolder.uri, 'aidlc', 'diagnostics');
              vscode.commands.executeCommand('revealFileInOS', diagUri);
            }
          });
        } else {
          this.outputChannel.appendLine(`✗ Export failed: ${result.stderr}`);
          vscode.window.showErrorMessage('Failed to export diagnostic report. See output.');
        }
      }
    );
  }
}
