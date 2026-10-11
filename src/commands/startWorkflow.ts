import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

/**
 * Start Workflow is a launcher — it composes the `/aidlc` command for the user
 * and copies it to the clipboard. The AIDLC framework (running in Kiro chat)
 * performs scope detection, initialization, and state management. The extension
 * only reflects the real state afterward; it never fabricates it.
 */
export class StartWorkflowCommand {
  constructor(
    private readonly stateManager: StateManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async execute(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
      return;
    }

    // Step 1: Get the intent description
    const intentDescription = await vscode.window.showInputBox({
      title: 'AIDLC — What do you want to build?',
      prompt: 'Describe your intent. The AIDLC framework will detect the scope and guide you.',
      placeHolder: 'e.g., Build a REST API for inventory management',
      ignoreFocusOut: true,
    });

    if (!intentDescription) {
      return; // User cancelled
    }

    // Step 2: Optionally let the user pin a scope (or let the framework auto-detect)
    const scopeChoice = await vscode.window.showQuickPick(
      [
        { label: 'Auto-detect (recommended)', description: 'Let AIDLC choose the scope from your description', scope: '' },
        { label: 'feature', description: 'New feature in existing codebase', scope: 'feature' },
        { label: 'enterprise', description: 'Large-scale, multi-team systems', scope: 'enterprise' },
        { label: 'mvp', description: 'Minimum viable product', scope: 'mvp' },
        { label: 'poc', description: 'Proof of concept', scope: 'poc' },
        { label: 'bugfix', description: 'Fix a known defect', scope: 'bugfix' },
        { label: 'refactor', description: 'Code improvement, no behavior change', scope: 'refactor' },
        { label: 'express', description: 'Quick task, minimal ceremony', scope: 'express' },
      ],
      {
        title: 'AIDLC — Scope',
        placeHolder: 'Choose a scope, or let AIDLC auto-detect from your description',
      }
    );

    if (!scopeChoice) {
      return; // User cancelled
    }

    // Step 3: Compose the /aidlc command
    const scope = scopeChoice.scope;
    const command = scope
      ? `/aidlc ${scope} ${intentDescription}`
      : `/aidlc ${intentDescription}`;

    // Copy to clipboard and guide the user
    await vscode.env.clipboard.writeText(command);

    this.outputChannel.appendLine(`Composed workflow command: ${command}`);

    const action = await vscode.window.showInformationMessage(
      'Your AIDLC command is copied to the clipboard. Paste it in Kiro chat to start the workflow. The framework will handle scope, initialization, and stages.',
      { detail: command },
      'Open Chat',
      'OK'
    );

    if (action === 'Open Chat') {
      vscode.commands.executeCommand('workbench.action.chat.open');
    }
  }

  /**
   * Compose a "continue" prompt for an existing/interrupted workflow and copy it.
   */
  async continueWorkflow(): Promise<void> {
    const state = await this.stateManager.getCurrentState();

    let command: string;
    if (state) {
      const currentStage = state.stages.find((s) => s.id === state.currentStageId);
      command = `/aidlc please continue the workflow for the "${state.intent.label}" intent${currentStage ? ` from stage ${currentStage.id} (${currentStage.name})` : ''}`;
    } else {
      command = '/aidlc please continue the workflow for the current intent';
    }

    await vscode.env.clipboard.writeText(command);

    const action = await vscode.window.showInformationMessage(
      'Continue command copied to clipboard. Paste it in Kiro chat to resume.',
      { detail: command },
      'Open Chat',
      'OK'
    );

    if (action === 'Open Chat') {
      vscode.commands.executeCommand('workbench.action.chat.open');
    }
  }
}
