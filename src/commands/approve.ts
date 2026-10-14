import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

/**
 * Handles stage review and approval guidance.
 * The extension is READ-ONLY — actual approvals happen in Kiro chat
 * via the framework's gate system. These commands open artifacts
 * for review and guide the user to approve in chat.
 */
export class ApproveCommand {
  constructor(
    private readonly stateManager: StateManager,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onApprovalChange: () => void
  ) {}

  /**
   * Open the artifact file for the stage awaiting approval.
   */
  async reviewArtifact(stageId?: string): Promise<void> {
    const state = await this.stateManager.getCurrentState();
    if (!state) {
      vscode.window.showInformationMessage('No active workflow.');
      return;
    }

    const targetStage = stageId
      ? state.stages.find((s) => s.id === stageId)
      : state.stages.find((s) => s.status === 'awaiting-approval');

    if (!targetStage) {
      vscode.window.showInformationMessage('No stage awaiting approval.');
      return;
    }

    if (targetStage.artifacts.length === 0) {
      vscode.window.showInformationMessage(
        `Stage ${targetStage.id} (${targetStage.name}) has no artifacts to review.`
      );
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }

    const primaryArtifact = targetStage.artifacts[0];
    const artifactUri = vscode.Uri.joinPath(
      workspaceFolder.uri, state.intent.directory, primaryArtifact
    );

    try {
      const doc = await vscode.workspace.openTextDocument(artifactUri);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });

      vscode.window.showInformationMessage(
        `Reviewing: Stage ${targetStage.id} — ${targetStage.name}. Approve in Kiro chat when ready.`,
        'Copy "approve" to clipboard'
      ).then((action) => {
        if (action) {
          vscode.env.clipboard.writeText('approve');
          vscode.window.showInformationMessage('Copied "approve" — paste in Kiro chat.');
        }
      });
    } catch {
      vscode.window.showWarningMessage(
        `Artifact not found: ${primaryArtifact}. The stage may still be generating output.`
      );
    }
  }

  /**
   * Guide user to approve in chat.
   */
  async approveStage(_stageId?: string): Promise<void> {
    await vscode.env.clipboard.writeText('approve');
    vscode.window.showInformationMessage(
      'Copied "approve" to clipboard. Paste in Kiro chat to approve the current stage.'
    );
  }

  /**
   * Guide user to request changes in chat.
   */
  async requestChanges(_stageId?: string): Promise<void> {
    const feedback = await vscode.window.showInputBox({
      title: 'Request Changes',
      prompt: 'What needs to change? This will be copied to your clipboard for pasting in chat.',
      placeHolder: 'e.g., "Add error handling for edge case X"',
      ignoreFocusOut: true,
    });

    if (feedback === undefined) { return; }

    const msg = `I'd like to request changes: ${feedback}`;
    await vscode.env.clipboard.writeText(msg);
    vscode.window.showInformationMessage(
      'Copied to clipboard. Paste in Kiro chat to request changes.'
    );
  }

  /**
   * Guide user to skip in chat.
   */
  async skipStage(_stageId?: string): Promise<void> {
    await vscode.env.clipboard.writeText('skip');
    vscode.window.showInformationMessage(
      'Copied "skip" to clipboard. Paste in Kiro chat to skip the current stage.'
    );
  }
}
