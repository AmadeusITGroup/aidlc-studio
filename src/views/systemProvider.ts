import * as vscode from 'vscode';
import { UpdateChecker, VersionInfo } from '../services/updateChecker';
import { RuleLoader } from '../services/ruleLoader';
import { BunInstaller } from '../services/bunInstaller';
import { GitInstaller } from '../services/gitInstaller';
import { readRepoAidlcVersion } from '../services/repoVersionReader';

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
  private gitInstalled: boolean | null = null;
  private gitVersion: string | null = null;
  private versionInfo: VersionInfo | null = null;
  private repoVersion: string | null = null;

  constructor(
    private readonly ruleLoader: RuleLoader,
    private readonly updateChecker: UpdateChecker,
    private readonly bunInstaller: BunInstaller,
    private readonly gitInstaller: GitInstaller
  ) {}

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

    // git is a fast LOCAL check — run it in the same fast/local phase as bun,
    // never the async network phase below.
    const gitCheck = await this.gitInstaller.check();
    this.gitInstalled = gitCheck.installed;
    this.gitVersion = gitCheck.version ?? null;

    // Setup is "done" only when the framework and bun are present
    const setupDone = this.setupConfigured && this.bunInstalled;
    await vscode.commands.executeCommand('setContext', 'amadeus-aidlc.setupDone', setupDone);

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
    // Row A — installed CLI version (variant + channel). MACHINE-scoped: always
    // probe for a globally-installed `aidlc` CLI, independent of whether THIS
    // workspace is configured. (Previously gated on setupConfigured, which made
    // the CLI row wrongly read "not installed" in an empty project even when a
    // global CLI was present.) The checker reads on-disk install metadata /
    // `aidlc --version` and resolves to null when no CLI exists.
    try {
      this.versionInfo = forceVersionCheck
        ? await this.updateChecker.checkForUpdates()
        : await this.updateChecker.getVersionInfo();
    } catch {
      this.versionInfo = null;
    }

    // Row B — per-repo framework-rules version from .kiro/tools/aidlc-version.ts.
    // Independent of the installed CLI; read as text (never executed). Swallow
    // failures → null (rendered as "Not configured").
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    this.repoVersion = workspaceUri ? await readRepoAidlcVersion(workspaceUri) : null;

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
    items.push(this.buildGitItem());
    items.push(this.buildHealthItem());
    items.push(this.buildVersionItem());
    items.push(this.buildRepoVersionItem());
    items.push(this.buildAnalyticsItem());
    items.push(this.buildDocsItem());

    return items;
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

  private buildGitItem(): SystemItem {
    if (this.gitInstalled === null) {
      return new SystemItem('Git', 'Checking...', new vscode.ThemeIcon('loading~spin'), 'system-git-loading');
    }

    if (this.gitInstalled) {
      const item = new SystemItem(
        'Git',
        `v${this.gitVersion ?? 'installed'}`,
        new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
        'system-git-ok'
      );
      item.tooltip = new vscode.MarkdownString(
        `**Git v${this.gitVersion ?? 'unknown'}**\n\nUsed to check variant access (\`git ls-remote\`) and clone custom forks. Installed and on PATH.`
      );
      return item;
    }

    // Not installed — click installs
    const item = new SystemItem(
      'Git',
      'Not installed — click to install',
      new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
      'system-git-missing'
    );
    item.tooltip = new vscode.MarkdownString(
      '**Git is not installed.**\n\nGit is used to check whether you have access to a variant (`git ls-remote`) and to clone custom forks.\n\n*Click to install Git.*'
    );
    item.command = { command: 'amadeus-aidlc.installGit', title: 'Install Git' };
    return item;
  }

  private buildHealthItem(): SystemItem {
    // Health gates on the framework + bun only. Git is purely informational
    // (its own row) and must not affect Health pass/fail.
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

  /**
   * Render a variant display id as a human label, e.g. "AWS" or "Amadeus".
   * Shared by both the installed-CLI row and the AIDLC Framework (repo) row so
   * the two read identically.
   */
  private variantLabel(variantDisplayId: VersionInfo['variantDisplayId']): string {
    switch (variantDisplayId) {
      case 'amadeus': return 'Amadeus';
      case 'aws':
      default: return 'AWS';
    }
  }

  // Row A — Installed CLI (global aidlc binary): variant + channel + version.
  // This is MACHINE-scoped and independent of whether THIS workspace is
  // configured (the Setup row above answers that). A globally-installed CLI
  // must show here even in an empty/unconfigured project, so this row is driven
  // purely by `versionInfo` (from UpdateChecker / on-disk install metadata),
  // never gated on `setupConfigured`.
  private buildVersionItem(): SystemItem {
    if (!this.versionInfo) {
      const item = new SystemItem(
        'Installed CLI',
        'Click to check',
        new vscode.ThemeIcon('question'),
        'system-version-unknown'
      );
      item.tooltip = new vscode.MarkdownString(
        '**Installed CLI**\n\nThe globally-installed `aidlc` CLI variant, channel, and version.\n\n*Click to check for a CLI update (`aidlc update --check`).*'
      );
      item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for CLI Updates' };
      return item;
    }

    const { currentVersion, latestVersion, updateAvailable, variantDisplayId, cliAbsent } = this.versionInfo;
    const variant = this.variantLabel(this.versionInfo.variantDisplayId);

    // No CLI installed → nothing to update, no latest shown (by design). Click
    // routes to Setup to install the CLI first.
    if (cliAbsent) {
      const item = new SystemItem(
        'Installed CLI',
        'Not installed — install the CLI first',
        new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
        'system-version-absent'
      );
      item.tooltip = new vscode.MarkdownString(
        '**No `aidlc` CLI installed.**\n\nThere is no machine-wide `aidlc` CLI, so there is nothing to update and no latest version to show.\n\n*Click to run Setup and install the CLI.*'
      );
      item.command = { command: 'amadeus-aidlc.setup', title: 'Set Up AIDLC' };
      return item;
    }

    if (updateAvailable) {
      const item = new SystemItem(
        'CLI Update Available',
        `${variant} ${currentVersion ?? '?'} → ${latestVersion} — Update CLI`,
        new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
        'system-update'
      );
      item.tooltip = new vscode.MarkdownString(
        `**CLI update available** (${variantDisplayId})\n\n- Current: \`${currentVersion ?? 'unknown'}\`\n- Latest: \`${latestVersion}\`\n\n*Click to upgrade the \`aidlc\` CLI (\`aidlc update\`). Then refresh the workspace via the AIDLC Framework row below.*`
      );
      item.command = { command: 'amadeus-aidlc.updateCli', title: 'Update AIDLC CLI' };
      return item;
    }

    // Could not determine the installed version — show Unknown with warning style
    if (!currentVersion) {
      const item = new SystemItem(
        'Installed CLI',
        'Version unknown — click to re-check',
        new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground')),
        'system-version-unknown'
      );
      item.tooltip = new vscode.MarkdownString(
        `**Installed CLI version unknown.**\n\nCould not read the installed \`aidlc\` CLI version.${latestVersion !== 'unknown' ? `\n\nLatest available: \`${latestVersion}\`` : ''}\n\n*Click to re-check (\`aidlc update --check\`).*`
      );
      item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for CLI Updates' };
      return item;
    }

    // On latest version
    const item = new SystemItem(
      'Installed CLI',
      `${variant} ${currentVersion}`,
      new vscode.ThemeIcon('verified-filled', new vscode.ThemeColor('testing.iconPassed')),
      'system-version-current'
    );
    item.tooltip = new vscode.MarkdownString(
      `**Installed CLI: ${variant} \`${currentVersion}\`**\n\nThe globally-installed \`aidlc\` CLI.${latestVersion !== 'unknown' ? ` You are on the latest version.` : ''}\n\n*Click to re-check for a CLI update.*`
    );
    item.command = { command: 'amadeus-aidlc.checkForUpdates', title: 'Check for CLI Updates' };
    return item;
  }

  // Row B — AIDLC Framework: per-repo AIDLC framework-rules version read from
  // .kiro/tools/aidlc-version.ts (the AIDLC_VERSION constant). This answers a
  // different question from the installed CLI and can legitimately differ.
  private buildRepoVersionItem(): SystemItem {
    if (this.repoVersion) {
      const item = new SystemItem(
        'AIDLC Framework',
        this.repoVersion,
        new vscode.ThemeIcon('tag', new vscode.ThemeColor('charts.blue')),
        'system-repo-version'
      );
      item.tooltip = new vscode.MarkdownString(
        `**AIDLC Framework: \`${this.repoVersion}\`**\n\nThe AIDLC framework-rules version configured in this repo (\`AIDLC_VERSION\` in \`.kiro/tools/aidlc-version.ts\`).\n\nThis is the version of the rules in this project — distinct from the installed CLI above. The two can legitimately differ.\n\n*Click to refresh this workspace against the installed CLI (\`aidlc config\`).*`
      );
      item.command = { command: 'amadeus-aidlc.updateWorkspace', title: 'Refresh Workspace' };
      return item;
    }

    const item = new SystemItem(
      'AIDLC Framework',
      'Not configured',
      new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground')),
      'system-repo-version-na'
    );
    item.tooltip = new vscode.MarkdownString(
      '**No repo framework-rules version.**\n\nThis repo has no readable `.kiro/tools/aidlc-version.ts` (`AIDLC_VERSION` constant). This is distinct from the installed CLI above.\n\n*Click to configure this workspace with the installed CLI (`aidlc config`).*'
    );
    item.command = { command: 'amadeus-aidlc.updateWorkspace', title: 'Refresh Workspace' };
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
