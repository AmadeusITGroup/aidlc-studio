import * as vscode from 'vscode';
import type { AttentionItem, OverviewModel } from '../services/overviewCollector';
import type { KbHealth } from '../services/documentKbReader';

/** What the provider needs from the collector (OverviewCollector satisfies it). */
export interface OverviewSource {
  collect(): Promise<OverviewModel>;
}

export class OverviewProvider implements vscode.TreeDataProvider<OverviewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OverviewItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly source: OverviewSource) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OverviewItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OverviewItem): Promise<OverviewItem[]> {
    if (element) {
      return element.children ?? [];
    }
    let model: OverviewModel;
    try {
      model = await this.source.collect();
    } catch {
      return [];
    }
    return this.buildGroups(model);
  }

  private buildGroups(model: OverviewModel): OverviewItem[] {
    const groups: OverviewItem[] = [];
    if (model.needsAttention.length > 0) {
      groups.push(this.attentionGroup(model.needsAttention));
    }
    groups.push(this.lifecycleGroup(model));
    groups.push(this.podGroup(model));
    return groups;
  }

  private attentionGroup(items: AttentionItem[]): OverviewItem {
    const group = new OverviewItem(
      'Needs attention',
      vscode.TreeItemCollapsibleState.Expanded,
      String(items.length),
      new vscode.ThemeIcon('bell'),
      'overview-attention'
    );
    group.children = items.map((item) => this.attentionItem(item));
    return group;
  }

  private attentionItem(item: AttentionItem): OverviewItem {
    const row = new OverviewItem(
      item.label,
      vscode.TreeItemCollapsibleState.None,
      undefined,
      new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
      `overview-attention-${item.kind}`
    );
    switch (item.kind) {
      case 'gate':
        // Same command as Workflow Progress. It currently answers "has no artifacts to
        // review": StateParser never fills Stage.artifacts (pre-existing upstream bug,
        // tracked as a separate issue), so the click is a dead end until that is fixed.
        row.tooltip = 'Awaiting your approval. Click to review the artifact.';
        row.command = { command: 'amadeus-aidlc.reviewArtifact', title: 'Review Artifact', arguments: [item.stageId] };
        break;
      case 'rework':
        row.tooltip = 'This stage was sent back for rework. Click to copy /aidlc and continue in the chat.';
        row.command = { command: 'amadeus-aidlc.copyAndContinue', title: 'Copy /aidlc to clipboard' };
        break;
      case 'kb-unreadable':
        row.tooltip = `${item.detail ?? 'The DocumentKB index cannot be read.'}\n\nClick to run the knowledge command.`;
        row.command = { command: 'amadeus-aidlc.knowledge', title: 'Knowledge' };
        break;
      case 'kb-remedy':
        row.tooltip = 'Click to run the knowledge command.';
        row.command = { command: 'amadeus-aidlc.knowledge', title: 'Knowledge' };
        break;
      case 'no-code-map':
        row.tooltip = 'No aidlc/spaces/<space>/codekb/<repo>/ folder holds a code map for this brownfield workspace.';
        break;
    }
    return row;
  }

  private lifecycleGroup(model: OverviewModel): OverviewItem {
    const life = model.lifecycle;
    const group = new OverviewItem(
      'AI-DLC lifecycle',
      vscode.TreeItemCollapsibleState.Expanded,
      life.intentLabel ?? undefined,
      new vscode.ThemeIcon('git-merge'),
      'overview-lifecycle'
    );
    group.command = { command: 'amadeus-aidlc.openAnalytics', title: 'Open Analytics' };

    if (!life.hasIntent) {
      const empty = new OverviewItem(
        'No AI-DLC workflow yet',
        vscode.TreeItemCollapsibleState.None,
        'Click to copy /aidlc',
        new vscode.ThemeIcon('info'),
        'overview-no-intent'
      );
      empty.command = { command: 'amadeus-aidlc.startWorkflow', title: 'Start New Workflow' };
      group.children = [empty];
      return group;
    }

    group.children = [
      new OverviewItem(
        'Progress',
        vscode.TreeItemCollapsibleState.None,
        `${life.progressDone}/${life.progressTotal}`,
        new vscode.ThemeIcon('checklist'),
        'overview-progress'
      ),
      new OverviewItem(
        'Phase',
        vscode.TreeItemCollapsibleState.None,
        life.phase ?? 'Scope not decided yet',
        new vscode.ThemeIcon('layers'),
        'overview-phase'
      ),
      new OverviewItem(
        'Now',
        vscode.TreeItemCollapsibleState.None,
        life.complete ? 'All stages finished' : life.now ?? '-',
        new vscode.ThemeIcon('play'),
        'overview-now'
      ),
      this.gatesRow(
        'Gates open',
        life.gatesOpen,
        'overview-gates',
        'Stages of the active intent that are awaiting your approval.'
      ),
    ];
    return group;
  }

  private podGroup(model: OverviewModel): OverviewItem {
    const pod = model.pod;
    const group = new OverviewItem(
      'AI pod',
      vscode.TreeItemCollapsibleState.Expanded,
      undefined,
      new vscode.ThemeIcon('organization'),
      'overview-pod'
    );
    group.command = { command: 'amadeus-aidlc.openAnalytics', title: 'Open Analytics' };

    const running = new OverviewItem(
      'Intents running',
      vscode.TreeItemCollapsibleState.None,
      `${pod.intentsRunning} of ${pod.intentsTotal}`,
      new vscode.ThemeIcon('run'),
      'overview-intents-running'
    );
    running.tooltip = `${pod.intentsRunning} in flight, ${pod.intentsTotal} intent(s) in the "${model.space}" space`;

    const codeMaps = new OverviewItem(
      'Code maps',
      vscode.TreeItemCollapsibleState.None,
      String(pod.codeMaps.length),
      new vscode.ThemeIcon('file-code'),
      'overview-code-maps'
    );
    codeMaps.tooltip = pod.codeMaps.length > 0
      ? pod.codeMaps.join('\n')
      : 'No code map under codekb/ yet';

    const gates = this.gatesRow(
      'Gates open (space)',
      pod.gatesOpen,
      'overview-gates-space',
      `Stages awaiting approval, summed over every intent of the "${model.space}" space.`
    );

    group.children = [running, gates, codeMaps, this.knowledgeRow(pod.knowledge)];
    return group;
  }

  private gatesRow(label: string, open: number, contextValue: string, tooltip: string): OverviewItem {
    const row = new OverviewItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      String(open),
      open > 0
        ? new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.yellow'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
      contextValue
    );
    row.tooltip = tooltip;
    return row;
  }

  private knowledgeRow(kb: KbHealth): OverviewItem {
    const description = kb.state === 'unreadable'
      ? 'unreadable'
      : kb.knowledgePct !== null ? `${kb.knowledgePct}%` : '-';
    const row = new OverviewItem(
      'Knowledge',
      vscode.TreeItemCollapsibleState.None,
      description,
      new vscode.ThemeIcon('book'),
      'overview-knowledge'
    );
    row.command = { command: 'amadeus-aidlc.knowledge', title: 'Knowledge' };
    row.tooltip = knowledgeTooltip(kb);
    return row;
  }
}

function knowledgeTooltip(kb: KbHealth): string {
  if (kb.state === 'unreadable') {
    return `Knowledge index unreadable: ${kb.error ?? 'unknown error'}`;
  }
  if (kb.state === 'absent') {
    return 'No DocumentKB in this space yet';
  }
  return [
    `Active documents: ${kb.active}`,
    `Extracted: ${kb.extracted} of ${kb.extractable}`,
    `Need a remedy: ${kb.needsRemedy}`,
    `Intent-scoped: ${kb.intentScoped}`,
    `Space-wide: ${kb.spaceWide}`,
    `Summarized: ${kb.summarized}`,
  ].join('\n');
}

export class OverviewItem extends vscode.TreeItem {
  children?: OverviewItem[];

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
