import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';
import { Stage, StageStatus } from '../types';

/**
 * Framework-internal files that don't need human review.
 * These are used by the AIDLC orchestrator for state, memory, and decision tracking.
 */
const FRAMEWORK_FILES = new Set([
  'memory.md',           // Orchestrator diary (interpretations, deviations, tradeoffs)
  'audit-trail.md',      // Decision log
  'runtime-graph.json',  // Runtime execution graph
]);

/** Patterns for framework-internal filenames */
const FRAMEWORK_PATTERNS = [
  /^\.aidlc/,            // Any hidden .aidlc file
  /^memory\.md$/,
];

function isFrameworkFile(fileName: string): boolean {
  if (FRAMEWORK_FILES.has(fileName)) { return true; }
  return FRAMEWORK_PATTERNS.some((p) => p.test(fileName));
}

export class ArtifactsProvider implements vscode.TreeDataProvider<ArtifactTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ArtifactTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly stateManager: StateManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ArtifactTreeItem): Promise<ArtifactTreeItem[]> {
    const state = await this.stateManager.getCurrentState();
    if (!state) { return []; }

    if (!element) {
      return this.buildStageGroups(state.stages, state.intent.directory);
    }

    if (element.children) {
      return element.children;
    }

    return [];
  }

  private async buildStageGroups(stages: Stage[], intentDir: string): Promise<ArtifactTreeItem[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return []; }

    const items: ArtifactTreeItem[] = [];
    const intentUri = vscode.Uri.joinPath(workspaceFolder.uri, intentDir);
    const phaseDirectories = ['initialization', 'ideation', 'inception', 'construction', 'operation', 'verification'];

    for (const stage of stages) {
      if (stage.status === 'pending') { continue; }

      const stageFiles = await this.findStageFilesOnDisk(intentUri, stage, phaseDirectories);
      if (stageFiles.length === 0) { continue; }

      // Split into reviewable and framework files
      const reviewable = stageFiles.filter((f) => !isFrameworkFile(f.path.split('/').pop() ?? ''));
      const framework = stageFiles.filter((f) => isFrameworkFile(f.path.split('/').pop() ?? ''));

      const { icon, statusText } = this.getStageStatusVisuals(stage.status);

      const stageItem = new ArtifactTreeItem(
        `${stage.id} ${stage.name}`,
        vscode.TreeItemCollapsibleState.Expanded,
        statusText,
        icon,
        `artifact-stage-${stage.status}`
      );

      const children: ArtifactTreeItem[] = [];

      // Reviewable artifacts first — with approval icons
      for (const fileUri of reviewable) {
        const fileName = fileUri.path.split('/').pop() ?? 'unknown';
        const fileIcon = this.getReviewableIcon(stage.status);
        const statusLabel = this.getReviewableStatusLabel(stage.status);

        const child = new ArtifactTreeItem(
          fileName,
          vscode.TreeItemCollapsibleState.None,
          statusLabel,
          fileIcon,
          `artifact-reviewable-${stage.status}`
        );
        child.command = { command: 'vscode.open', title: 'Open', arguments: [fileUri] };
        child.resourceUri = fileUri;
        child.tooltip = new vscode.MarkdownString(
          `**${fileName}** — *Reviewable artifact*\n\nStage: ${stage.id} ${stage.name}\nStatus: ${statusText}\n\n*Click to open and review*`
        );
        children.push(child);
      }

      // Framework files — dimmed, no approval status
      for (const fileUri of framework) {
        const fileName = fileUri.path.split('/').pop() ?? 'unknown';

        const child = new ArtifactTreeItem(
          fileName,
          vscode.TreeItemCollapsibleState.None,
          'framework',
          new vscode.ThemeIcon('tools', new vscode.ThemeColor('disabledForeground')),
          'artifact-framework'
        );
        child.command = { command: 'vscode.open', title: 'Open', arguments: [fileUri] };
        child.resourceUri = fileUri;
        child.tooltip = new vscode.MarkdownString(
          `**${fileName}** — *Framework internal file*\n\nUsed by AIDLC for orchestration. Not a review artifact.`
        );
        children.push(child);
      }

      stageItem.children = children;
      items.push(stageItem);
    }

    if (items.length === 0) {
      return [
        new ArtifactTreeItem(
          'No artifacts generated yet',
          vscode.TreeItemCollapsibleState.None,
          'Artifacts appear as stages complete',
          new vscode.ThemeIcon('info'),
          'artifact-empty'
        ),
      ];
    }

    return items;
  }

  private async findStageFilesOnDisk(
    intentUri: vscode.Uri, stage: Stage, phaseDirectories: string[]
  ): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    const phaseName = phaseDirectories[stage.phase] ?? '';
    const stageSlug = stage.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const possibleDirs = [
      vscode.Uri.joinPath(intentUri, phaseName, stageSlug),
      vscode.Uri.joinPath(intentUri, phaseName, this.idToSlug(stage.id)),
    ];

    for (const dirUri of possibleDirs) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
          if (type === vscode.FileType.File && !name.startsWith('.')) {
            files.push(vscode.Uri.joinPath(dirUri, name));
          }
        }
        if (files.length > 0) { break; }
      } catch { /* dir doesn't exist */ }
    }

    return files;
  }

  private idToSlug(id: string): string {
    const slugMap: Record<string, string> = {
      '0.1': 'workspace-scaffold', '0.2': 'workspace-detection', '0.3': 'state-init',
      '1.1': 'intent-capture', '1.2': 'market-research', '1.3': 'feasibility',
      '1.4': 'scope-definition', '1.5': 'team-formation', '1.6': 'rough-mockups',
      '1.7': 'approval-handoff',
      '2.1': 'reverse-engineering', '2.2': 'practices-discovery',
      '2.3': 'requirements-analysis', '2.4': 'user-stories',
      '2.5': 'application-design', '2.6': 'risk-assessment',
      '2.7': 'units-generation', '2.8': 'estimation', '2.9': 'delivery-planning',
      '3.1': 'functional-design', '3.2': 'technical-design',
      '3.3': 'environment-setup', '3.4': 'code-scaffolding',
      '3.5': 'code-generation', '3.6': 'build-and-test', '3.7': 'ci-pipeline',
      '4.1': 'deployment-planning', '4.2': 'infrastructure-setup',
      '4.3': 'deployment-execution', '4.4': 'smoke-testing',
      '4.5': 'monitoring-setup', '4.6': 'incident-playbook',
      '4.7': 'feedback-optimization',
    };
    return slugMap[id] ?? id;
  }

  private getStageStatusVisuals(status: StageStatus): { icon: vscode.ThemeIcon; statusText: string } {
    switch (status) {
      case 'completed':
        return { icon: new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')), statusText: '\u2713 Approved' };
      case 'awaiting-approval':
        return { icon: new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('notificationsInfoIcon.foreground')), statusText: '\u23F3 Awaiting approval' };
      case 'revised':
        return { icon: new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.orange')), statusText: '\u21A9 Revision requested' };
      case 'active':
        return { icon: new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow')), statusText: '\u25B6 In progress' };
      case 'skipped':
        return { icon: new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('disabledForeground')), statusText: '\u23ED Skipped' };
      default:
        return { icon: new vscode.ThemeIcon('circle-outline'), statusText: 'Pending' };
    }
  }

  private getReviewableIcon(stageStatus: StageStatus): vscode.ThemeIcon {
    switch (stageStatus) {
      case 'completed':
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      case 'awaiting-approval':
        return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
      case 'revised':
        return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.orange'));
      case 'active':
        return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.yellow'));
      default:
        return new vscode.ThemeIcon('file');
    }
  }

  private getReviewableStatusLabel(stageStatus: StageStatus): string {
    switch (stageStatus) {
      case 'completed': return '\u2713 Approved';
      case 'awaiting-approval': return '\u23F3 Review needed';
      case 'revised': return '\u21A9 Changes requested';
      case 'active': return '\u25B6 Generating...';
      default: return '';
    }
  }
}

export class ArtifactTreeItem extends vscode.TreeItem {
  children?: ArtifactTreeItem[];

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
