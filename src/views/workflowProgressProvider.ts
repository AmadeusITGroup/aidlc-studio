import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';
import { WorkflowState } from '../types';

export class WorkflowProgressProvider implements vscode.TreeDataProvider<ProgressItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProgressItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly stateManager: StateManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProgressItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProgressItem): Promise<ProgressItem[]> {
    if (element) {
      return element.children ?? [];
    }

    const state = await this.stateManager.getCurrentState();
    if (!state) {
      return [];
    }

    return this.buildRootItems(state);
  }

  private buildRootItems(state: WorkflowState): ProgressItem[] {
    const items: ProgressItem[] = [];

    // Intent label (always shown once an intent exists)
    items.push(new ProgressItem(
      `${state.intent.label}`,
      vscode.TreeItemCollapsibleState.None,
      undefined,
      new vscode.ThemeIcon('target'),
      'progress-intent'
    ));

    // Scope
    items.push(new ProgressItem(
      `Scope: ${state.intent.scope}`,
      vscode.TreeItemCollapsibleState.None,
      `Depth: ${state.intent.depth}`,
      new vscode.ThemeIcon('telescope'),
      'progress-scope'
    ));

    // If the framework hasn't planned stages yet (scope undecided), don't
    // show a fabricated phase/progress. Just guide the user to continue.
    if (state.stages.length === 0) {
      const hint = new ProgressItem(
        'Scope not decided yet',
        vscode.TreeItemCollapsibleState.None,
        'Continue in Kiro chat to plan the workflow',
        new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow')),
        'progress-unplanned'
      );
      hint.command = {
        command: 'amadeus-aidlc.copyAndContinue',
        title: 'Copy continue command',
      };
      items.push(hint);
      return items;
    }

    const phaseName = this.getPhaseName(state.currentPhase);
    const currentStage = state.stages.find((s) => s.id === state.currentStageId);
    const percentage = Math.round((state.stagesCompleted / state.stagesTotal) * 100);
    const progressBar = this.renderProgressBar(state.stagesCompleted, state.stagesTotal);
    const isComplete = state.stagesCompleted >= state.stagesTotal && state.stagesTotal > 0;
    const awaitingStage = state.stages.find((s) => s.status === 'awaiting-approval');

    // Phase & Stage
    if (isComplete) {
      items.push(new ProgressItem(
        'Workflow Complete',
        vscode.TreeItemCollapsibleState.None,
        'All stages finished',
        new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed')),
        'progress-complete'
      ));
    } else {
      items.push(new ProgressItem(
        `${phaseName}`,
        vscode.TreeItemCollapsibleState.None,
        `Stage: ${currentStage?.name ?? state.currentStageId}`,
        new vscode.ThemeIcon('layers'),
        'progress-phase'
      ));
    }

    // Progress bar
    items.push(new ProgressItem(
      `${progressBar} ${percentage}%`,
      vscode.TreeItemCollapsibleState.None,
      `${state.stagesCompleted}/${state.stagesTotal} stages`,
      new vscode.ThemeIcon('graph'),
      'progress-bar'
    ));

    // Agent
    if (!isComplete && currentStage) {
      items.push(new ProgressItem(
        `Agent: ${currentStage.leadAgent}`,
        vscode.TreeItemCollapsibleState.None,
        'Leading current stage',
        new vscode.ThemeIcon('person'),
        'progress-agent'
      ));
    }

    // --- Continue / Action Hint ---
    if (isComplete) {
      // Workflow done
      const hint = new ProgressItem(
        'Start a new workflow?',
        vscode.TreeItemCollapsibleState.None,
        'Use: /aidlc [description]',
        new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green')),
        'progress-hint'
      );
      hint.command = {
        command: 'amadeus-aidlc.startWorkflow',
        title: 'Start New Workflow',
      };
      items.push(hint);
    } else if (awaitingStage) {
      // Stage needs approval
      const hint = new ProgressItem(
        `Action needed: Review & approve`,
        vscode.TreeItemCollapsibleState.None,
        `${awaitingStage.id} ${awaitingStage.name}`,
        new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
        'progress-hint-approval'
      );
      hint.command = {
        command: 'amadeus-aidlc.reviewArtifact',
        title: 'Review Artifact',
        arguments: [awaitingStage.id],
      };
      items.push(hint);
    } else if (currentStage?.status === 'active') {
      // Stage is running — tell user to use chat with copy action
      const hint = new ProgressItem(
        'Continue in Kiro chat',
        vscode.TreeItemCollapsibleState.None,
        'Click to copy: /aidlc',
        new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.blue')),
        'progress-hint-chat'
      );
      hint.command = {
        command: 'amadeus-aidlc.copyAndContinue',
        title: 'Copy /aidlc to clipboard',
      };
      items.push(hint);
    } else if (currentStage?.status === 'revised') {
      // Stage needs rework
      const hint = new ProgressItem(
        'Stage needs rework',
        vscode.TreeItemCollapsibleState.None,
        'Click to copy: /aidlc',
        new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.orange')),
        'progress-hint-revision'
      );
      hint.command = {
        command: 'amadeus-aidlc.copyAndContinue',
        title: 'Copy /aidlc to clipboard',
      };
      items.push(hint);
    }

    return items;
  }

  private renderProgressBar(completed: number, total: number): string {
    const width = 10;
    const filled = Math.round((completed / total) * width);
    const empty = width - filled;
    return '[' + '\u2593'.repeat(filled) + '\u2591'.repeat(empty) + ']';
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

export class ProgressItem extends vscode.TreeItem {
  children?: ProgressItem[];

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    description?: string,
    icon?: vscode.ThemeIcon,
    contextValue?: string
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = contextValue;
  }
}
