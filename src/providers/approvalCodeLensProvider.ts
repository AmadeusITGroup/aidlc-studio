import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';

/**
 * Provides CodeLens actions on AIDLC artifact files that are awaiting approval.
 * When a stage is in "awaiting-approval" state, its artifact files get
 * [Approve] [Request Changes] [Skip] lenses at the top.
 */
export class ApprovalCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly stateManager: StateManager) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const state = await this.stateManager.getCurrentState();
    if (!state) {
      return [];
    }

    // Find if this document is an artifact of a stage awaiting approval
    const awaitingStage = state.stages.find(
      (s) => s.status === 'awaiting-approval'
    );

    if (!awaitingStage) {
      return [];
    }

    // Check if current document path matches any artifact of the awaiting stage
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const docRelativePath = vscode.workspace.asRelativePath(document.uri);
    const intentDir = state.intent.directory;

    // Check if the file is inside the intent's record directory
    const isArtifact = awaitingStage.artifacts.some((artifact) => {
      const artifactPath = `${intentDir}/${artifact}`;
      return docRelativePath === artifactPath
        || docRelativePath.endsWith(artifact)
        || docRelativePath.includes(`/${awaitingStage.id.replace('.', '/')}/`);
    });

    // Also match if the file is in the stage's phase directory
    const phaseNames = ['initialization', 'ideation', 'inception', 'construction', 'operation'];
    const phaseName = phaseNames[awaitingStage.phase] ?? '';
    const stageSlug = awaitingStage.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const isInStageDir = docRelativePath.includes(`${phaseName}/${stageSlug}/`)
      || docRelativePath.includes(`${phaseName}/${awaitingStage.id}/`);

    if (!isArtifact && !isInStageDir) {
      return [];
    }

    // Place CodeLens at line 0
    const range = new vscode.Range(0, 0, 0, 0);

    const lenses: vscode.CodeLens[] = [
      // Stage info lens
      new vscode.CodeLens(range, {
        title: `$(bell-dot) Stage ${awaitingStage.id}: ${awaitingStage.name} — Awaiting Your Approval`,
        command: '',
      }),
      // Approve
      new vscode.CodeLens(range, {
        title: '$(check) Approve',
        command: 'amadeus-aidlc.approveStage',
        arguments: [awaitingStage.id],
        tooltip: 'Approve this stage and advance the workflow',
      }),
      // Request Changes
      new vscode.CodeLens(range, {
        title: '$(edit) Request Changes',
        command: 'amadeus-aidlc.requestChanges',
        arguments: [awaitingStage.id],
        tooltip: 'Send back for revision with feedback',
      }),
      // Skip
      new vscode.CodeLens(range, {
        title: '$(debug-step-over) Skip',
        command: 'amadeus-aidlc.skipStage',
        arguments: [awaitingStage.id],
        tooltip: 'Skip this stage and continue',
      }),
    ];

    return lenses;
  }
}
