import * as vscode from 'vscode';
import { UpdateChecker, VersionInfo } from '../services/updateChecker';
import { RuleLoader } from '../services/ruleLoader';
import { BunInstaller } from '../services/bunInstaller';

/**
 * System view — shows setup/health/bun/version status.
 * Every item is click-to-act:
 *   - Setup not done → click installs AIDLC
 *   - bun missing    → click installs bun
 *   - Health         → click runs /aidlc --doctor
 *   - Version        → click checks for updates; "Update Now" when available
 */
export class SystemProvider implements vscode.TreeDataProvider<SystemItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SystemItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private setupConfigured: boolean | null = null;
  private bunInstalled: boolean | null = null;
  private bunVersion: string | null = null;
  private versionInfo: VersionInfo | null = null;
  private reposManifestExists = false;

  constructor(
    private readonly ruleLoader: RuleLoader,
    private readonly updateChecker: UpdateChecker,
    private readonly bunInstaller: BunInstaller
  ) { }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Reload system status.
   * @param forceVersionCheck When true, bypasses the version cache and does a
   *   fresh check (used right after setup/update so the version reflects reality).
   */
  async loadStatus(forceVersionCheck = false): Promise<void> {
    // --- Phase 1: fast, local checks (filesystem + bun) ---
    // These must never block on network calls, so the System panel updates
    // immediately instead of sitting on "Checking..." while version lookups
    // (curl / git ls-remote) run in the background.
    this.setupConfigured = await this.ruleLoader.isWorkspaceConfigured();

    const bunCheck = await this.bunInstaller.check();
    this.bunInstalled = bunCheck.installed;
    this.bunVersion = bunCheck.version ?? null;

    // Setup is "done" only when both the framework and bun are present
    const setupDone = this.setupConfigured && this.bunInstalled;
    await vscode.commands.executeCommand('setContext', 'amadeus-aidlc.setupDone', setupDone);

    // Does the workspace already have a repos.json manifest? Used to render the
    // Workspace Setup row (which only appears once overall setup is done).
    this.reposManifestExists = await this.hasReposManifest();

    // Render the fast results right away.
    this.refresh();

    // --- Phase 2: slow, network-bound checks (fire-and-forget) ---
    // Run these without blocking loadStatus; refresh the view when each
    // resolves. Failures are swallowed so a network issue never hangs the UI.
    void this.loadVersionInfo(forceVersionCheck);
  }

  /**
   * Background version checks. Never throws; refreshes the view as results
   * arrive so the slow network lookups don't block the fast local status.
   */
  private async loadVersionInfo(forceVersionCheck: boolean): Promise<void> {
    // AIDLC framework version — only relevant when set up.
    if (this.setupConfigured) {
      try {
        this.versionInfo = forceVersionCheck
          ? await this.updateChecker.checkForUpdates()
          : await this.updateChecker.getVersionInfo();
      } catch {
        this.versionInfo = null;
      }
    } else {
      this.versionInfo = null;
    }
    this.refresh();
  }

  getTreeItem(element: SystemItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SystemItem): Promise<SystemItem[]> {
    if (element) {
      return [];
    }

    const items: SystemItem[] = [];

    items.push(this.buildSetupItem());
    items.push(this.buildBunItem());
    items.push(this.buildHealthItem());
    items.push(this.buildVersionItem());

    // Workspace Setup only appears once the entire setup is done
    // (framework + bun both present).
    if (this.setupConfigured && this.bunInstalled) {
      items.push(this.buildWorkspaceSetupItem());
    }

    items.push(this.buildAnalyticsItem());
    items.push(this.buildDocsItem());

    return items;
  }

  /** True when a repos.json manifest exists at the workspace root. */
  private async hasReposManifest(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return false;
    }
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'repos.json');
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  // --- Item builders ---

  private buildDocsItem(): SystemItem {
    const item = new SystemItem(
      'Documentation',
      'Extension guide & AIDLC reference',
      new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.blue')),
      'system-docs'
    );
    item.tooltip = new vscode.MarkdownString(
      '**Documentation**\n\nOpen the built-in guide covering:\n- Getting started with the extension\n- Sidebar views explained\n- All commands\n- AIDLC workflow overview & scopes\n- Quick reference & troubleshooting\n\n*Click to open.*'
    );
    item.command = { command: 'amadeus-aidlc.openDocs', title: 'Open Documentation' };
    return item;
  }

  private buildAnalyticsItem(): SystemItem {
    const item = new SystemItem(
      'Analytics',
      'View workflow analytics',
      new vscode.ThemeIcon('graph', new vscode.ThemeColor('charts.blue')),
      'system-analytics'
    );
    item.tooltip = new vscode.MarkdownString(
      '**Analytics Dashboard**\n\nOpen a detailed dashboard showing intent progress, stage breakdowns, artifact counts, and scope distribution.\n\n*Click to open.*'
    );
    item.command = { command: 'amadeus-aidlc.openAnalytics', title: 'Open Analytics' };
    return item;
  }

  private buildSetupItem(): SystemItem {
    if (this.setupConfigured === null) {
      const item = new SystemItem('Setup', 'Checking...', new vscode.ThemeIcon('loading~spin'), 'system-setup-loading');
      return item;
    }

    if (this.setupConfigured) {
      const item = new SystemItem(
        'Setup',
        'Installed',
        new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
        'system-setup-ok'
      );
      item.tooltip = new vscode.MarkdownString(
        '**AIDLC is installed.**\n\nThe framework (skills, tools, hooks, agents) is present in this workspace.\n\n`/aidlc` is available in Kiro chat.\n\n*Click to reinstall.*'
      );
      item.command = { command: 'amadeus-aidlc.setup', title: 'Reinstall AIDLC' };
      return item;
    }

    // Not configured — click sets up
    const item = new SystemItem(
      'Setup',
      'Not installed — click to set up',
      new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
      'system-setup-missing'
    );
    item.tooltip = new vscode.MarkdownString(
      '**AIDLC is not installed.**\n\nClick to install the AI-DLC framework:\n- Pick a variant (AWS open source by default)\n- Installs the framework into `.kiro/` and `aidlc/`\n- Runs `/aidlc --doctor` to verify\n\n*Click to start initial setup.*'
    );
    item.command = { command: 'amadeus-aidlc.setup', title: 'Set Up AIDLC' };
    return item;
  }

  private buildWorkspaceSetupItem(): SystemItem {
    if (this.reposManifestExists) {
      const item = new SystemItem(
        'Workspace Setup',
        'Repos configured — click to edit',
        new vscode.ThemeIcon('repo', new vscode.ThemeColor('testing.iconPassed')),
        'system-workspace-ok'
      );
      item.tooltip = new vscode.MarkdownString(
        '**Multi-repo workspace configured.**\n\nA `repos.json` manifest exists at the workspace root declaring the org and repos for this workspace.\n\n*Click to edit the manifest.*'
      );
      item.command = { command: 'amadeus-aidlc.workspaceSetup', title: 'Edit Workspace Setup' };
      return item;
    }

    const item = new SystemItem(
      'Workspace Setup',
      'Add repos — click to configure',
      new vscode.ThemeIcon('repo', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
      'system-workspace-missing'
    );
    item.tooltip = new vscode.MarkdownString(
      '**Set up a multi-repo workspace.**\n\nDeclare the GitHub org and the repositories that make up this workspace. This writes a `repos.json` manifest at the workspace root.\n\n*Click to open the form.*'
    );
    item.command = { command: 'amadeus-aidlc.workspaceSetup', title: 'Workspace Setup' };
    return item;
  }

  private buildBunItem(): SystemItem {
    if (this.bunInstalled === null) {
      return new SystemItem('bun', 'Checking...', new vscode.ThemeIcon('loading~spin'), 'system-bun-loading');
    }

    if (this.bunInstalled) {
      const item = new SystemItem(
        'bun',
        `v${this.bunVersion ?? 'installed'}`,
        new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
        'system-bun-ok'
      );
      item.tooltip = new vscode.MarkdownString(
        `**bun v${this.bunVersion ?? 'unknown'}**\n\nRequired runtime for AIDLC hooks and tools. Installed and on PATH.`
      );
      return item;
    }

    // Not installed — click installs
    const item = new SystemItem(
      'bun',
      'Not installed — click to install',
      new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
      'system-bun-missing'
    );
    item.tooltip = new vscode.MarkdownString(
      '**bun is not installed.**\n\nbun is the JavaScript runtime AIDLC uses for its hooks and deterministic tools.\n\n*Click to install bun.*'
    );
    item.command = { command: 'amadeus-aidlc.installBun', title: 'Install bun' };
    return item;
  }

  private buildHealthItem(): SystemItem {
    const healthy = this.setupConfigured && this.bunInstalled;

    if (healthy) {
      const item = new SystemItem(
        'Health',
        'Passing',
        new vscode.ThemeIcon('heart', new vscode.ThemeColor('testing.iconPassed')),
        'system-health-ok'
      );
      item.tooltip = new vscode.MarkdownString(
        '**Prerequisites met.**\n\n*Click to run the full `/aidlc --doctor` health check.*'
      );
      item.command = { command: 'amadeus-aidlc.doctor', title: 'Run Health Check' };
      return item;
    }

    const issues: string[] = [];
    if (!this.setupConfigured) { issues.push('AIDLC not installed'); }
    if (!this.bunInstalled) { issues.push('bun not installed'); }

    const item = new SystemItem(
      'Health',
      `${issues.length} issue(s) — click to check`,
      new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
      'system-health-failing'
    );
    item.tooltip = new vscode.MarkdownString(
      `**Issues found:**\n\n${issues.map((i) => `- ${i}`).join('\n')}\n\n*Click to run the full health check.*`
    );
    item.command = { command: 'amadeus-aidlc.doctor', title: 'Run Health Check' };
    return item;
  }

  private buildVersionItem(): SystemItem {
    // Setup not done — version is not applicable yet
    if (!this.setupConfigured) {
      const item = new SystemItem(
        'AIDLC Version',
        'Not available — set up first',
        new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed')),
        'system-version-na'
      );
      item.tooltip = new vscode.MarkdownString(
        '**Version unavailable.**\n\nAIDLC is not installed yet, so there is no installed version to report.\n\n*Set up AIDLC first (see the Setup row above).*'
      );
      item.command = { command: 'amadeus-aidlc.setup', title: 'Set Up AIDLC' };
      return item;
    }

    if (!this.versionInfo) {
      const item = new SystemItem(
        'AIDLC Version',
        'Click to check',
        new vscode.ThemeIcon('question'),
        'system-version-unknown'
      );
      item.tooltip = new vscode.MarkdownString('*Click to check for the latest AIDLC version.*');
      item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for Updates' };
      return item;
    }

    const { currentVersion, latestVersion, updateAvailable } = this.versionInfo;

    if (updateAvailable) {
      const item = new SystemItem(
        'Update Available',
        `${currentVersion ?? '?'} → ${latestVersion} — Update Now`,
        new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
        'system-update'
      );
      item.tooltip = new vscode.MarkdownString(
        `**Update available**\n\n- Current: \`${currentVersion ?? 'unknown'}\`\n- Latest: \`${latestVersion}\`\n\n*Click to update now.*`
      );
      item.command = { command: 'amadeus-aidlc.updateRules', title: 'Update AIDLC Rules' };
      return item;
    }

    // Could not determine the installed version — show Unknown with warning style
    if (!currentVersion) {
      const item = new SystemItem(
        'AIDLC Version',
        'Unknown — click to check',
        new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
        'system-version-unknown'
      );
      item.tooltip = new vscode.MarkdownString(
        `**Installed version unknown.**\n\nCould not read the installed AIDLC version from this workspace.${latestVersion !== 'unknown' ? `\n\nLatest available: \`${latestVersion}\`` : ''}\n\n*Click to re-check.*`
      );
      item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for Updates' };
      return item;
    }

    // On latest version
    const item = new SystemItem(
      'AIDLC Version',
      `${currentVersion} (latest)`,
      new vscode.ThemeIcon('verified-filled', new vscode.ThemeColor('testing.iconPassed')),
      'system-version-current'
    );
    item.tooltip = new vscode.MarkdownString(
      `**AIDLC v${currentVersion}**\n\nYou are on the latest version.\n\n*Click to re-check.*`
    );
    item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for Updates' };
    return item;
  }
}

export class SystemItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    contextValue: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = contextValue;
  }
}
