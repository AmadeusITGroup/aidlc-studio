import * as vscode from 'vscode';
import { StateManager } from '../services/stateManager';
import { Intent } from '../types';

export class IntentsProvider implements vscode.TreeDataProvider<IntentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IntentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly stateManager: StateManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IntentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: IntentTreeItem): Promise<IntentTreeItem[]> {
    if (element) {
      return [];
    }

    const intents = await this.stateManager.listIntents();
    if (intents.length === 0) {
      return [
        new IntentTreeItem(
          'No intents yet',
          vscode.TreeItemCollapsibleState.None,
          'Start a workflow to create one',
          new vscode.ThemeIcon('info'),
          'intent-empty'
        ),
      ];
    }

    const currentState = await this.stateManager.getCurrentState();
    const currentDir = currentState?.intent.directory;

    return intents.map((intent) => {
      const isCurrent = intent.directory === currentDir;
      const icon = isCurrent
        ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
        : new vscode.ThemeIcon('git-commit');

      const item = new IntentTreeItem(
        intent.label,
        vscode.TreeItemCollapsibleState.None,
        `${intent.scope} | ${intent.createdAt}${isCurrent ? ' (active)' : ''}`,
        icon,
        isCurrent ? 'intent-active' : 'intent-inactive'
      );

      item.intent = intent;

      // Clicking an inactive intent directly triggers switch with confirmation
      if (!isCurrent) {
        item.command = {
          command: 'amadeus-aidlc.switchIntentDirect',
          title: 'Switch to this intent',
          arguments: [intent],
        };
      } else {
        // Clicking the active intent shows status
        item.command = {
          command: 'amadeus-aidlc.showStatus',
          title: 'Show workflow status',
        };
      }

      item.tooltip = this.buildTooltip(intent, isCurrent);

      return item;
    });
  }

  private buildTooltip(intent: Intent, isCurrent: boolean): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${intent.label}**\n\n`);
    md.appendMarkdown(`**Scope:** ${intent.scope}\n\n`);
    md.appendMarkdown(`**Depth:** ${intent.depth}\n\n`);
    md.appendMarkdown(`**Created:** ${intent.createdAt}\n\n`);
    md.appendMarkdown(`**Space:** ${intent.space}\n\n`);
    if (isCurrent) {
      md.appendMarkdown(`---\n\n*This is the active intent.*`);
    } else {
      md.appendMarkdown(`---\n\n*Click to switch to this intent.*`);
    }
    return md;
  }
}

export class IntentTreeItem extends vscode.TreeItem {
  intent?: Intent;

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
