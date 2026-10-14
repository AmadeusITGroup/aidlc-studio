import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

export class ResumeWorkflowCommand {
  constructor(
    private readonly stateManager: StateManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async execute(): Promise<void> {
    this.outputChannel.appendLine('Attempting to resume AIDLC workflow...');

    try {
      const state = await this.stateManager.getCurrentState();

      if (!state) {
        vscode.window.showInformationMessage(
          'No AIDLC workflow found to resume. Start a new one?',
          'Start Workflow'
        ).then((action) => {
          if (action === 'Start Workflow') {
            vscode.commands.executeCommand('amadeus-aidlc.startWorkflow');
          }
        });
        return;
      }

      if (state.stagesCompleted >= state.stagesTotal) {
        vscode.window.showInformationMessage(
          'The current workflow is already complete. Start a new one?',
          'Start New Workflow'
        ).then((action) => {
          if (action === 'Start New Workflow') {
            vscode.commands.executeCommand('amadeus-aidlc.startWorkflow');
          }
        });
        return;
      }

      // Validate artifacts from completed stages
      const validation = await this.stateManager.validateCompletedArtifacts(state);

      if (!validation.valid) {
        const action = await vscode.window.showWarningMessage(
          `Some completed stage artifacts are missing: ${validation.missingArtifacts.join(', ')}. How to proceed?`,
          'Resume Anyway',
          'Restart',
          'Cancel'
        );

        if (action === 'Restart') {
          vscode.commands.executeCommand('amadeus-aidlc.startWorkflow');
          return;
        } else if (action !== 'Resume Anyway') {
          return;
        }
      }

      // Resume
      const currentStage = state.stages.find((s) => s.id === state.currentStageId);
      const phaseName = this.getPhaseName(state.currentPhase);

      this.outputChannel.appendLine(
        `Resuming: ${phaseName} > ${currentStage?.name ?? state.currentStageId} (${state.stagesCompleted}/${state.stagesTotal})`
      );

      vscode.window.showInformationMessage(
        `Resumed AIDLC: ${phaseName} > ${currentStage?.name ?? 'Unknown'} (${state.stagesCompleted}/${state.stagesTotal} complete)`
      );

      // Refresh views
      vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`Resume failed: ${message}`);
      vscode.window.showErrorMessage(`Failed to resume workflow: ${message}`);
    }
  }

  private getPhaseName(phase: number): string {
    const names: Record<number, string> = {
      0: 'Initialization',
      1: 'Ideation',
      2: 'Inception',
      3: 'Construction',
      4: 'Operation',
    };
    return names[phase] ?? `Phase ${phase}`;
  }
}
