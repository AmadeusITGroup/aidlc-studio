import * as vscode from 'vscode';
import { UpdateChecker } from '../services/updateChecker';
import { AidlcCli } from '../services/aidlcCli';

export class UpdateCommand {
  constructor(
    private readonly updateChecker: UpdateChecker,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Check for updates and display result.
   */
  async checkForUpdates(): Promise<void> {
    this.outputChannel.appendLine('Checking for AIDLC updates...');

    try {
      const info = await this.updateChecker.checkForUpdates();

      if (info.updateAvailable) {
        // Build a detailed modal with version info and release notes
        const detailParts: string[] = [
          `Current version: ${info.currentVersion ?? 'unknown'}`,
          `Latest version:  ${info.latestVersion}`,
        ];
        if (info.publishedAt) {
          detailParts.push(`Released: ${new Date(info.publishedAt).toLocaleDateString()}`);
        }
        if (info.releaseName) {
          detailParts.push(``, `${info.releaseName}`);
        }
        if (info.releaseNotes) {
          // Trim release notes to keep the modal readable
          const notes = info.releaseNotes.trim().slice(0, 500);
          detailParts.push(``, notes + (info.releaseNotes.length > 500 ? '...' : ''));
        }

        const action = await vscode.window.showInformationMessage(
          `AIDLC update available: ${info.currentVersion ?? 'unknown'} → ${info.latestVersion}`,
          {
            modal: true,
            detail: detailParts.join('\n'),
          },
          'Update Now',
          'View Release'
        );

        if (action === 'Update Now') {
          await this.updateRules();
        } else if (action === 'View Release' && info.releaseUrl) {
          vscode.env.openExternal(vscode.Uri.parse(info.releaseUrl));
        }
      } else {
        vscode.window.showInformationMessage(
          `AIDLC is up to date (v${info.currentVersion ?? info.latestVersion}).`
        );
      }

      // Refresh system view
      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to check for updates: ${message}`);
    }
  }

  /**
   * Pull latest rules and run doctor to verify.
   */
  async updateRules(): Promise<void> {
    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== Updating AIDLC ===');

    try {
      await this.updateChecker.pullLatest();

      // Run doctor post-update
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        this.outputChannel.appendLine('Running post-update health check...');
        const cli = new AidlcCli(this.outputChannel, workspaceFolder.uri);
        const doctorResult = await cli.doctor();

        if (doctorResult.passed) {
          vscode.window.showInformationMessage(
            'AIDLC updated successfully. All health checks pass.',
            'OK'
          );
        } else {
          vscode.window.showWarningMessage(
            `Updated, but /aidlc --doctor reports ${doctorResult.failures.length} issue(s). Check output.`,
            'Show Output'
          ).then((action) => {
            if (action === 'Show Output') {
              this.outputChannel.show(true);
            }
          });
        }
      }

      // Refresh views
      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');

      this.outputChannel.appendLine('=== Update Complete ===');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`Update failed: ${message}`);
      vscode.window.showErrorMessage(`AIDLC update failed: ${message}`);
    }
  }
}
