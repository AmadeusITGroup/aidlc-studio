import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

export class SwitchIntentCommand {
  constructor(
    private readonly stateManager: StateManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async execute(): Promise<void> {
    try {
      const intents = await this.stateManager.listIntents();

      if (intents.length === 0) {
        vscode.window.showInformationMessage('No AIDLC intents found. Start a workflow first.');
        return;
      }

      const currentState = await this.stateManager.getCurrentState();
      const currentDir = currentState?.intent.directory;

      const items: vscode.QuickPickItem[] = intents.map((intent) => ({
        label: intent.label,
        description: `${intent.scope} | ${intent.createdAt}`,
        detail: intent.directory,
        picked: intent.directory === currentDir,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'AIDLC — Switch Intent',
        placeHolder: 'Select an intent to switch to',
      });

      if (!selected) {
        return;
      }

      const targetIntent = intents.find((i) => i.directory === selected.detail);
      if (!targetIntent) {
        return;
      }

      await this.stateManager.switchToIntent(targetIntent);

      this.outputChannel.appendLine(`Switched to intent: ${targetIntent.label}`);
      vscode.window.showInformationMessage(`Switched to: ${targetIntent.label}`);

      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`Switch failed: ${message}`);
      vscode.window.showErrorMessage(`Failed to switch intent: ${message}`);
    }
  }
}
