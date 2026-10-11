import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

export class ShowStatusCommand {
  constructor(
    private readonly stateManager: StateManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async execute(): Promise<void> {
    const state = await this.stateManager.getCurrentState();

    if (!state) {
      vscode.window.showInformationMessage('No active AIDLC workflow.');
      return;
    }

    const phaseName = this.getPhaseName(state.currentPhase);
    const currentStage = state.stages.find((s) => s.id === state.currentStageId);
    const completedStages = state.stages.filter((s) => s.status === 'completed');
    const skippedStages = state.stages.filter((s) => s.status === 'skipped');

    const statusLines = [
      `# AIDLC Workflow Status`,
      ``,
      `**Intent:** ${state.intent.label}`,
      `**Scope:** ${state.intent.scope} | **Depth:** ${state.intent.depth} | **Test Strategy:** ${state.intent.testStrategy}`,
      `**Workspace:** ${state.workspace.type}`,
      ``,
      `## Progress`,
      ``,
      `**Phase:** ${phaseName}`,
      `**Stage:** ${currentStage?.name ?? state.currentStageId} (${currentStage?.leadAgent ?? 'unknown'} agent)`,
      `**Completed:** ${state.stagesCompleted}/${state.stagesTotal} stages`,
      `**Skipped:** ${skippedStages.length} stages`,
      ``,
      `## Completed Stages`,
      ``,
      ...completedStages.map((s) => `- [x] ${s.id} ${s.name}`),
      ``,
      `## Remaining`,
      ``,
      ...state.stages
        .filter((s) => s.status === 'pending' || s.status === 'active')
        .map((s) => `- [ ] ${s.id} ${s.name} (${s.leadAgent})`),
    ];

    // Show in a virtual document
    const content = statusLines.join('\n');
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });

    this.outputChannel.appendLine(`Status: ${phaseName} > ${currentStage?.name} [${state.stagesCompleted}/${state.stagesTotal}]`);
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
