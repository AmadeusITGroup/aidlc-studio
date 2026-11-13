import * as vscode from 'vscode';
import { UpdateChecker } from '../services/updateChecker';
import { RuleLoader, RepoAccessError } from '../services/ruleLoader';
import { AidlcCli } from '../services/aidlcCli';
import { detectCliPresence } from '../services/cliPresence';
import { getVariant } from '../services/variants';

/**
 * The extension exposes TWO distinct, independent update operations, because
 * they answer different questions:
 *
 *  1. UPDATE CLI       — upgrade the machine-wide `aidlc` binary (`aidlc
 *                        update`). "Is an update available?" is sourced from
 *                        the CLI itself (`aidlc update --check`); when no CLI
 *                        is installed there is nothing to update.
 *  2. UPDATE WORKSPACE — re-apply the installed CLI's framework into THIS
 *                        project's `.kiro/` (`aidlc config`). "Is a refresh
 *                        needed?" = the workspace framework version vs what the
 *                        installed CLI would write (reported honestly, never
 *                        inventing a target version).
 *
 * ORDER when doing both: CLI FIRST, THEN workspace — `aidlc config` uses
 * whichever CLI is installed, so the binary must be current before the
 * workspace is refreshed against it.
 */
export class UpdateCommand {
  constructor(
    private readonly updateChecker: UpdateChecker,
    private readonly outputChannel: vscode.OutputChannel,
    /** Needed for the WORKSPACE refresh (`aidlc config`). */
    private readonly ruleLoader: RuleLoader
  ) {}

  /**
   * CLI-UPDATE availability check + optional upgrade. This is the
   * "Installed CLI" row / CLI-update flow. Uses the CLI-update version check
   * (CLI's own `aidlc update --check` when present, else the per-variant feed)
   * and, when the user accepts, upgrades ONLY the binary via `aidlc update`.
   */
  async checkForUpdates(): Promise<void> {
    this.outputChannel.appendLine('Checking for AIDLC CLI updates...');

    try {
      const info = await this.updateChecker.checkCliUpdate();

      // No CLI installed → nothing to update; guide the user to install first.
      if (info.cliAbsent) {
        vscode.window.showWarningMessage(
          'No `aidlc` CLI is installed on this machine. Run Setup to install it first.'
        );
        vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
        return;
      }

      if (info.updateAvailable) {
        // The latest token may be a real version or the 'available' marker when
        // the CLI signalled an update without a version. Show what we have.
        const detail = [
          `Current version: ${info.currentVersion ?? 'unknown'}`,
          `Latest version:  ${info.latestVersion}`,
        ].join('\n');

        const action = await vscode.window.showInformationMessage(
          `AIDLC CLI update available: ${info.currentVersion ?? 'unknown'} → ${info.latestVersion}`,
          { modal: true, detail },
          'Update CLI Now'
        );

        if (action === 'Update CLI Now') {
          await this.updateCli();
        }
      } else {
        vscode.window.showInformationMessage(
          `AIDLC CLI is up to date (v${info.currentVersion ?? info.latestVersion}).`
        );
      }

      // Refresh system view
      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to check for CLI updates: ${message}`);
    }
  }

  /**
   * UPDATE CLI (operation 1): upgrade ONLY the machine-wide `aidlc` binary via
   * `aidlc update`. Does NOT touch this workspace's rules — that is the
   * separate WORKSPACE update. On completion, refresh the views.
   */
  async updateCli(): Promise<void> {
    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== Updating AIDLC CLI ===');

    try {
      await this.updateChecker.updateCliBinary();

      vscode.window.showInformationMessage(
        'AIDLC CLI updated. Run "Update Workspace" to refresh this project against the new CLI.',
        'Update Workspace'
      ).then((choice) => {
        if (choice === 'Update Workspace') {
          vscode.commands.executeCommand('amadeus-aidlc.updateWorkspace');
        }
      });

      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
      this.outputChannel.appendLine('=== CLI Update Complete ===');
    } catch (error) {
      this.handleUpdateError(error, 'CLI update');
    }
  }

  /**
   * UPDATE WORKSPACE (operation 2): re-apply the installed CLI's framework into
   * THIS project via `aidlc config` (RuleLoader.configureWorkspaceForVariant),
   * using the DETECTED variant from the installed CLI. Runs `aidlc doctor`
   * afterwards, then refreshes the views. Does NOT upgrade the CLI binary.
   */
  async updateWorkspace(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== Refreshing AIDLC Workspace ===');

    try {
      // Honesty check first: a refresh needs the workspace configured AND a CLI
      // present (so `aidlc config` can run). Don't over-claim a version delta.
      const state = await this.updateChecker.checkWorkspaceState();
      if (!state.cliPresent) {
        vscode.window.showWarningMessage(
          'No `aidlc` CLI is installed, so the workspace cannot be refreshed. ' +
          'Install the CLI (run Setup or Update CLI) first.'
        );
        return;
      }
      if (!state.configured) {
        vscode.window.showWarningMessage(
          'This workspace is not configured yet. Run Setup to install AIDLC into this project first.'
        );
        return;
      }

      // Detect the installed variant so `aidlc config` targets the right
      // harness. Fall back to the checker's active variant, then AWS.
      const presence = await detectCliPresence();
      const variant = presence.variantId
        ? getVariant(presence.variantId)
        : this.updateChecker.variant;
      this.ruleLoader.setVariant(variant);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Refreshing workspace (aidlc config)...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Running aidlc config...', increment: 50 });
          await this.ruleLoader.configureWorkspaceForVariant(workspaceFolder.uri, variant);

          // Post-op health check, same as setup.
          progress.report({ message: 'Running aidlc doctor...', increment: 50 });
          const cli = new AidlcCli(this.outputChannel, workspaceFolder.uri);
          const doctorResult = await cli.doctor(variant.doctorMode);

          if (doctorResult.passed) {
            vscode.window.showInformationMessage(
              'Workspace refreshed. All health checks pass.',
              'OK'
            );
          } else {
            vscode.window.showWarningMessage(
              `Workspace refreshed, but doctor reports ${doctorResult.failures.length} issue(s). Check output.`,
              'Show Output'
            ).then((action) => {
              if (action === 'Show Output') {
                this.outputChannel.show(true);
              }
            });
          }
        }
      );

      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
      this.outputChannel.appendLine('=== Workspace Refresh Complete ===');
    } catch (error) {
      this.handleUpdateError(error, 'Workspace refresh');
    }
  }

  /**
   * COMBINED convenience (kept so the legacy `updateRules` command id and the
   * System "Update Available" row keep working): update the CLI FIRST, THEN
   * refresh the workspace, reporting each step. Order matters — `aidlc config`
   * uses whichever CLI is installed.
   */
  async updateRules(): Promise<void> {
    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== Updating AIDLC (CLI, then workspace) ===');

    // Step 1: CLI first.
    try {
      await this.updateChecker.updateCliBinary();
      this.outputChannel.appendLine('Step 1/2: CLI update — done.');
    } catch (error) {
      this.handleUpdateError(error, 'CLI update');
      return; // Don't refresh the workspace against a CLI that failed to update.
    }

    // Step 2: then workspace.
    try {
      await this.updateWorkspace();
      this.outputChannel.appendLine('Step 2/2: Workspace refresh — done.');
    } catch (error) {
      this.handleUpdateError(error, 'Workspace refresh');
    }

    vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
    this.outputChannel.appendLine('=== Update Complete ===');
  }

  /**
   * Shared error handling for the update flows. A RepoAccessError (private/SSO
   * variant repo the user can't reach) gets the friendly "you don't have
   * access" message setup uses; everything else shows the raw message.
   */
  private handleUpdateError(error: unknown, label: string): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.outputChannel.appendLine(`${label} failed: ${message}`);

    if (error instanceof RepoAccessError) {
      vscode.window.showErrorMessage(
        `You don't have access to "${error.variantLabel}". This version is restricted — ` +
        `make sure you're on the required network and signed in, or choose the open-source version instead.`
      );
      return;
    }

    vscode.window.showErrorMessage(`AIDLC ${label} failed: ${message}`);
  }
}
