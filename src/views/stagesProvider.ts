import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';
import { Stage, PhaseId, StageStatus } from '../types';

export class StagesProvider implements vscode.TreeDataProvider<StageTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StageTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly stateManager: StateManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StageTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: StageTreeItem): Promise<StageTreeItem[]> {
    const state = await this.stateManager.getCurrentState();
    if (!state) {
      return [];
    }

    // If no stages planned yet (scope not decided by framework), show guidance
    if (!element && state.stages.length === 0) {
      const item = new StageTreeItem(
        'Stages not planned yet',
        vscode.TreeItemCollapsibleState.None,
        'The framework will populate stages after scope is decided',
        new vscode.ThemeIcon('info'),
        'stages-empty'
      );
      return [item];
    }

    // Root level: show phases
    if (!element) {
      return this.buildPhaseItems(state.stages, state.currentStageId);
    }

    // Phase level: show stages in that phase
    if (element.contextValue?.startsWith('phase')) {
      const phaseId = element.phaseId;
      if (phaseId === undefined) {
        return [];
      }
      const phaseStages = state.stages.filter((s) => s.phase === phaseId);
      return phaseStages.map((stage) => this.buildStageItem(stage, state.currentStageId));
    }

    return [];
  }

  private buildPhaseItems(stages: Stage[], _currentStageId: string): StageTreeItem[] {
    const phases: { id: PhaseId; name: string }[] = [
      { id: 0, name: 'Initialization' },
      { id: 1, name: 'Ideation' },
      { id: 2, name: 'Inception' },
      { id: 3, name: 'Construction' },
      { id: 4, name: 'Operation' },
    ];

    return phases
      .filter((phase) => stages.some((s) => s.phase === phase.id))
      .map((phase) => {
        const phaseStages = stages.filter((s) => s.phase === phase.id);
        const completed = phaseStages.filter((s) => s.status === 'completed').length;
        const skipped = phaseStages.filter((s) => s.status === 'skipped').length;
        const total = phaseStages.length;
        const allDone = (completed + skipped) === total && total > 0;
        const hasAwaiting = phaseStages.some((s) => s.status === 'awaiting-approval');
        const hasActive = phaseStages.some((s) => s.status === 'active');

        let icon: vscode.ThemeIcon;
        if (allDone) {
          icon = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else if (hasAwaiting) {
          icon = new vscode.ThemeIcon('bell', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
        } else if (hasActive) {
          icon = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'));
        } else {
          icon = new vscode.ThemeIcon('circle-outline');
        }

        const item = new StageTreeItem(
          `Phase ${phase.id}: ${phase.name}`,
          vscode.TreeItemCollapsibleState.Expanded,
          allDone ? `✓ ${completed}/${total}` : `${completed}/${total}`,
          icon,
          'phase'
        );
        item.phaseId = phase.id;
        return item;
      });
  }

  private buildStageItem(stage: Stage, currentStageId: string): StageTreeItem {
    const isCurrent = stage.id === currentStageId;
    const { icon, contextValue, statusLabel } = this.getStageVisuals(stage, isCurrent);

    const label = isCurrent && stage.status !== 'completed'
      ? `\u25B6 ${stage.id} ${stage.name}`
      : `${stage.id} ${stage.name}`;

    const item = new StageTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      statusLabel,
      icon,
      contextValue
    );

    item.stageId = stage.id;

    // Build rich tooltip
    item.tooltip = this.buildTooltip(stage);

    // For awaiting-approval: clicking opens the artifact for review
    if (stage.status === 'awaiting-approval' && stage.artifacts.length > 0) {
      item.command = {
        command: 'amadeus-aidlc.reviewArtifact',
        title: 'Review Artifact',
        arguments: [stage.id],
      };
    }

    return item;
  }

  private getStageVisuals(stage: Stage, _isCurrent: boolean): {
    icon: vscode.ThemeIcon;
    contextValue: string;
    statusLabel: string;
  } {
    switch (stage.status) {
      case 'completed':
        return {
          icon: new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
          contextValue: 'stage-completed',
          statusLabel: `\u2713 Approved${stage.approvalInfo ? ` (${this.timeAgo(stage.approvalInfo.timestamp)})` : ''}`,
        };

      case 'awaiting-approval':
        return {
          icon: new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
          contextValue: 'stage-awaiting-approval',
          statusLabel: '\u23F3 Awaiting approval',
        };

      case 'active':
        return {
          icon: new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow')),
          contextValue: 'stage-active',
          statusLabel: '\u25B6 Running...',
        };

      case 'skipped':
        return {
          icon: new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('disabledForeground')),
          contextValue: 'stage-skipped',
          statusLabel: `\u23ED Skipped${stage.skipReason ? `: ${stage.skipReason}` : ''}`,
        };

      case 'revised':
        return {
          icon: new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.orange')),
          contextValue: 'stage-revised',
          statusLabel: `\u21A9 Revision requested${stage.revisionCount ? ` (${stage.revisionCount}x)` : ''}`,
        };

      default:
        return {
          icon: new vscode.ThemeIcon('circle-outline'),
          contextValue: 'stage-pending',
          statusLabel: stage.leadAgent,
        };
    }
  }

  private buildTooltip(stage: Stage): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${stage.id} ${stage.name}**\n\n`);
    md.appendMarkdown(`**Agent:** ${stage.leadAgent}\n\n`);
    md.appendMarkdown(`**Status:** ${this.statusToLabel(stage.status)}\n\n`);

    if (stage.approvalInfo) {
      md.appendMarkdown(`**Approved:** ${stage.approvalInfo.timestamp}\n\n`);
      if (stage.approvalInfo.feedback) {
        md.appendMarkdown(`**Notes:** ${stage.approvalInfo.feedback}\n\n`);
      }
    }

    if (stage.revisionCount && stage.revisionCount > 0) {
      md.appendMarkdown(`**Revisions:** ${stage.revisionCount}\n\n`);
    }

    if (stage.artifacts.length > 0) {
      md.appendMarkdown(`**Artifacts:**\n`);
      for (const artifact of stage.artifacts) {
        md.appendMarkdown(`- ${artifact}\n`);
      }
    }

    if (stage.skipReason) {
      md.appendMarkdown(`\n**Skip reason:** ${stage.skipReason}`);
    }

    return md;
  }

  private statusToLabel(status: StageStatus): string {
    const labels: Record<StageStatus, string> = {
      'pending': 'Pending',
      'active': 'Running',
      'awaiting-approval': 'Awaiting Approval',
      'completed': 'Approved',
      'skipped': 'Skipped',
      'revised': 'Revision Requested',
    };
    return labels[status] ?? status;
  }

  private timeAgo(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;

    if (diffMs < 60000) { return 'just now'; }
    if (diffMs < 3600000) { return `${Math.floor(diffMs / 60000)}m ago`; }
    if (diffMs < 86400000) { return `${Math.floor(diffMs / 3600000)}h ago`; }
    return `${Math.floor(diffMs / 86400000)}d ago`;
  }
}

export class StageTreeItem extends vscode.TreeItem {
  phaseId?: PhaseId;
  stageId?: string;

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
