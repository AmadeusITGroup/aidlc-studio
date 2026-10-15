import * as vscode from 'vscode';
import { SetupCommand } from './commands/setup';
import { StartWorkflowCommand } from './commands/startWorkflow';
import { ResumeWorkflowCommand } from './commands/resumeWorkflow';
import { SwitchIntentCommand } from './commands/switchIntent';
import { OpenReferenceCommand } from './commands/openReference';
import { DoctorCommand } from './commands/doctor';
import { UpdateCommand } from './commands/update';
import { ApproveCommand } from './commands/approve';
import { AidlcQuickCommand } from './commands/aidlcQuickCommand';
import { SystemProvider } from './views/systemProvider';
import { WorkflowProgressProvider } from './views/workflowProgressProvider';
import { StagesProvider } from './views/stagesProvider';
import { ArtifactsProvider } from './views/artifactsProvider';
import { IntentsProvider } from './views/intentsProvider';
import { ApprovalCodeLensProvider } from './providers/approvalCodeLensProvider';
import { StateManager } from './services/stateManager';
import { RuleLoader } from './services/ruleLoader';
import { BunInstaller } from './services/bunInstaller';
import { UpdateChecker } from './services/updateChecker';
import { Intent } from './types';

let stateManager: StateManager;

export function activate(context: vscode.ExtensionContext): void {
  try {
    activateInternal(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Surface a clear error instead of letting the extension host crash.
    // The most common cause in development is a stale host still holding the
    // previous registration (e.g. after changing the extension id) — a full
    // window reload clears it.
    vscode.window.showErrorMessage(
      `AIDLC Studio failed to activate: ${message}. Try reloading the window (Developer: Reload Window).`
    );
    console.error('AIDLC Studio activation error:', error);
  }
}

function activateInternal(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AIDLC Studio');
  outputChannel.appendLine('AIDLC Studio activating...');

  // Initialize services
  stateManager = new StateManager(context);
  const ruleLoader = new RuleLoader(context, outputChannel);
  const bunInstaller = new BunInstaller(outputChannel);

  // Restore the variant that was active in the previous session (or auto-detect
  // from workspace files). Must complete before version checks and loadStatus()
  // so all operations target the correct repo from the start.
  const updateChecker = new UpdateChecker(outputChannel, ruleLoader.variant);
  // Track whether the extension is still active when the async restore finishes.
  let extensionActive = true;
  context.subscriptions.push({ dispose: () => { extensionActive = false; } });
  const variantRestored = ruleLoader.restoreVariant().then((variant) => {
    if (!extensionActive) { return; }
    updateChecker.setVariant(variant);
    outputChannel.appendLine(`Active variant: ${variant.label} (${variant.installMethod})`);
  });

  // Initialize tree view providers
  const systemProvider = new SystemProvider(ruleLoader, updateChecker, bunInstaller);
  const workflowProgressProvider = new WorkflowProgressProvider(stateManager);
  const stagesProvider = new StagesProvider(stateManager);
  const artifactsProvider = new ArtifactsProvider(stateManager);
  const intentsProvider = new IntentsProvider(stateManager);

  // Initialize CodeLens provider for approval
  const approvalCodeLensProvider = new ApprovalCodeLensProvider(stateManager);

  // Register CodeLens provider for markdown files in aidlc/ directory
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { pattern: '**/aidlc/**/*.md' },
    approvalCodeLensProvider
  );

  // Register tree views
  const systemView = vscode.window.createTreeView('amadeus-aidlc.system', {
    treeDataProvider: systemProvider,
    showCollapseAll: false,
  });

  const progressView = vscode.window.createTreeView('amadeus-aidlc.workflowProgress', {
    treeDataProvider: workflowProgressProvider,
    showCollapseAll: false,
  });

  const stagesView = vscode.window.createTreeView('amadeus-aidlc.stages', {
    treeDataProvider: stagesProvider,
    showCollapseAll: true,
  });

  const artifactsView = vscode.window.createTreeView('amadeus-aidlc.artifacts', {
    treeDataProvider: artifactsProvider,
    showCollapseAll: true,
  });

  const intentsView = vscode.window.createTreeView('amadeus-aidlc.intents', {
    treeDataProvider: intentsProvider,
    showCollapseAll: false,
  });

  // Callback to refresh all views after state changes
  const refreshAll = () => {
    workflowProgressProvider.refresh();
    stagesProvider.refresh();
    artifactsProvider.refresh();
    intentsProvider.refresh();
    approvalCodeLensProvider.refresh();
  };

  // Callback that reloads system status from disk AND refreshes all views.
  // Used after setup/install/update so the System panel reflects reality.
  // Forces a fresh version check (bypasses cache) so the version is current.
  // Also syncs the active variant into updateChecker so version checks target
  // the correct repo/channel for whichever variant was just installed.
  const reloadStatusAndViews = async () => {
    updateChecker.setVariant(ruleLoader.variant);
    await systemProvider.loadStatus(true);
    refreshAll();
  };

  // Register commands
  const setupCmd = new SetupCommand(ruleLoader, outputChannel, reloadStatusAndViews);
  const doctorCmd = new DoctorCommand(outputChannel);
  const updateCmd = new UpdateCommand(updateChecker, outputChannel);
  const startCmd = new StartWorkflowCommand(stateManager, outputChannel);
  const resumeCmd = new ResumeWorkflowCommand(stateManager, outputChannel);
  const switchCmd = new SwitchIntentCommand(stateManager, outputChannel);
  const referenceCmd = new OpenReferenceCommand(context);
  const approveCmd = new ApproveCommand(stateManager, outputChannel, refreshAll);
  const quickCmd = new AidlcQuickCommand(outputChannel);

  context.subscriptions.push(
    // Core setup & diagnostics
    vscode.commands.registerCommand('amadeus-aidlc.setup', () => setupCmd.execute()),
    vscode.commands.registerCommand('amadeus-aidlc.doctor', () => doctorCmd.execute()),
    vscode.commands.registerCommand('amadeus-aidlc.doctorExport', () => doctorCmd.executeExport()),

    // bun install
    vscode.commands.registerCommand('amadeus-aidlc.installBun', async () => {
      await bunInstaller.install();
      await reloadStatusAndViews();
    }),

    // Update
    vscode.commands.registerCommand('amadeus-aidlc.checkForUpdates', () => updateCmd.checkForUpdates()),
    vscode.commands.registerCommand('amadeus-aidlc.updateRules', () => updateCmd.updateRules()),

    // Workflow lifecycle
    vscode.commands.registerCommand('amadeus-aidlc.startWorkflow', () => startCmd.execute()),
    vscode.commands.registerCommand('amadeus-aidlc.resumeWorkflow', () => resumeCmd.execute()),
    vscode.commands.registerCommand('amadeus-aidlc.showStatus', () => quickCmd.status()),

    // Approval actions
    vscode.commands.registerCommand('amadeus-aidlc.approveStage', (stageId?: string) => approveCmd.approveStage(stageId)),
    vscode.commands.registerCommand('amadeus-aidlc.requestChanges', (stageId?: string) => approveCmd.requestChanges(stageId)),
    vscode.commands.registerCommand('amadeus-aidlc.skipStage', (stageId?: string) => approveCmd.skipStage(stageId)),
    vscode.commands.registerCommand('amadeus-aidlc.reviewArtifact', (stageId?: string) => approveCmd.reviewArtifact(stageId)),

    // Analytics
    vscode.commands.registerCommand('amadeus-aidlc.openAnalytics', async () => {
      const { AnalyticsPanel } = await import('./views/analyticsPanel');
      AnalyticsPanel.show();
    }),
    vscode.commands.registerCommand('amadeus-aidlc.openIntentAnalytics', async (intentOrItem?: unknown) => {
      const { AnalyticsPanel } = await import('./views/analyticsPanel');
      // The argument may be an Intent object (from switchIntentDirect) or an IntentTreeItem
      let dirName: string | undefined;
      if (intentOrItem && typeof intentOrItem === 'object') {
        const obj = intentOrItem as Record<string, unknown>;
        // From IntentTreeItem with .intent property
        if (obj.intent && typeof obj.intent === 'object') {
          const intent = obj.intent as Record<string, unknown>;
          if (typeof intent.directory === 'string') {
            dirName = intent.directory.split('/').pop();
          }
        }
        // Direct Intent object
        else if (typeof obj.directory === 'string') {
          dirName = (obj.directory as string).split('/').pop();
        }
      }
      AnalyticsPanel.show(dirName);
    }),

    // Documentation
    vscode.commands.registerCommand('amadeus-aidlc.openDocs', async () => {
      const { DocsPanel } = await import('./views/docsPanel');
      DocsPanel.show();
    }),

    // Welcome
    vscode.commands.registerCommand('amadeus-aidlc.openWelcome', async () => {
      const { WelcomePanel } = await import('./views/welcomePanel');
      WelcomePanel.show(context);
    }),

    // Intent switching — direct click from tree (no QuickPick)
    vscode.commands.registerCommand('amadeus-aidlc.switchIntentDirect', async (intent: Intent) => {
      const confirm = await vscode.window.showInformationMessage(
        `Switch to "${intent.label}" (${intent.scope}, ${intent.createdAt})?`,
        'Switch',
        'Cancel'
      );
      if (confirm === 'Switch') {
        try {
          await stateManager.switchToIntent(intent);
          outputChannel.appendLine(`Switched to intent: ${intent.label}`);
          refreshAll();

          // Also refresh the analytics panel if it's open
          import('./views/analyticsPanel').then(({ AnalyticsPanel }) => {
            if (AnalyticsPanel.currentPanel) {
              AnalyticsPanel.currentPanel.refresh();
            }
          });

          // Copy the /aidlc intent command so user can also switch in chat
          const chatCmd = `/aidlc intent ${intent.label}`;
          await vscode.env.clipboard.writeText(chatCmd);

          vscode.window.showInformationMessage(
            `Switched to "${intent.label}". Copied "${chatCmd}" to clipboard — paste in Kiro chat to sync the chat session.`,
            'OK'
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          vscode.window.showErrorMessage(`Failed to switch intent: ${msg}`);
        }
      }
    }),

    // Intent switching — legacy command (from command palette)
    vscode.commands.registerCommand('amadeus-aidlc.switchIntent', () => switchCmd.execute()),

    // Navigation
    vscode.commands.registerCommand('amadeus-aidlc.jumpToStage', () => quickCmd.jumpToStage()),
    vscode.commands.registerCommand('amadeus-aidlc.jumpToPhase', () => quickCmd.jumpToPhase()),

    // Configuration
    vscode.commands.registerCommand('amadeus-aidlc.changeScope', () => quickCmd.changeScope()),
    vscode.commands.registerCommand('amadeus-aidlc.changeDepth', () => quickCmd.changeDepth()),
    vscode.commands.registerCommand('amadeus-aidlc.changeTestStrategy', () => quickCmd.changeTestStrategy()),

    // Advanced
    vscode.commands.registerCommand('amadeus-aidlc.compose', () => quickCmd.compose()),
    vscode.commands.registerCommand('amadeus-aidlc.switchSpace', () => quickCmd.switchSpace()),
    vscode.commands.registerCommand('amadeus-aidlc.knowledge', () => quickCmd.knowledge()),
    vscode.commands.registerCommand('amadeus-aidlc.pluginList', () => quickCmd.pluginList()),
    vscode.commands.registerCommand('amadeus-aidlc.version', () => quickCmd.version()),

    // Reference & refresh
    vscode.commands.registerCommand('amadeus-aidlc.openReference', () => referenceCmd.execute()),
    vscode.commands.registerCommand('amadeus-aidlc.refreshViews', () => {
      systemProvider.loadStatus();
      refreshAll();
    }),
    vscode.commands.registerCommand('amadeus-aidlc.copyAndContinue', () => startCmd.continueWorkflow()),

    // Views & providers
    systemView,
    progressView,
    stagesView,
    artifactsView,
    intentsView,
    codeLensDisposable,
    outputChannel,
  );

  // --- Startup logic ---

  // Load system status (setup, bun, version) — wait for variant to be restored
  // first so the version check targets the correct repo from the very first load.
  void variantRestored.then(() => systemProvider.loadStatus());

  // Auto-check for updates on startup (5s delay so activation stays snappy)
  const config = vscode.workspace.getConfiguration('amadeus-aidlc');
  if (config.get<boolean>('autoCheckUpdates', true)) {
    setTimeout(() => {
      updateChecker.getVersionInfo().then((info) => {
        if (info?.updateAvailable) {
          systemProvider.refresh();
          const detail = [
            `Current: ${info.currentVersion ?? '?'}`,
            `Latest: ${info.latestVersion}`,
            info.releaseName ? `\n${info.releaseName}` : '',
          ].filter(Boolean).join('\n');

          vscode.window.showInformationMessage(
            `AIDLC update available: ${info.currentVersion ?? '?'} → ${info.latestVersion}`,
            { detail },
            'Update Now',
            'View Details',
            'Later'
          ).then((action) => {
            if (action === 'Update Now') {
              vscode.commands.executeCommand('amadeus-aidlc.updateRules');
            } else if (action === 'View Details') {
              vscode.commands.executeCommand('amadeus-aidlc.checkForUpdates');
            }
          });
        }
      });
    }, 5000);
  }

  // Auto-detect setup
  if (config.get<boolean>('autoDetectSetup', true)) {
    checkSetupAndResume(ruleLoader, stateManager, approveCmd);
  }

  // Set initial context for approval menu visibility
  stateManager.getCurrentState().then((state) => {
    const hasAwaiting = state?.stages.some((s) => s.status === 'awaiting-approval') ?? false;
    vscode.commands.executeCommand('setContext', 'amadeus-aidlc.hasAwaitingApproval', hasAwaiting);
  });

  // Watch for state file changes to auto-refresh views.
  // The AWS native binary writes state atomically (temp-file + rename), which
  // fires onDidCreate rather than onDidChange for the first write in an intent.
  // Subscribe to both so views update regardless of write strategy.
  const stateWatcher = vscode.workspace.createFileSystemWatcher('**/aidlc/**/aidlc-state.*');
  const onStateChange = () => {
    outputChannel.appendLine('State file changed — refreshing views.');
    stateManager.invalidateCache();
    refreshAll();
  };
  stateWatcher.onDidChange(onStateChange);
  stateWatcher.onDidCreate(onStateChange);
  context.subscriptions.push(stateWatcher);

  // Also watch the active-intent pointer so switching intents (which rewrites
  // this file without touching aidlc-state.md) is picked up immediately.
  const intentPointerWatcher = vscode.workspace.createFileSystemWatcher(
    '**/aidlc/spaces/default/intents/active-intent'
  );
  intentPointerWatcher.onDidChange(onStateChange);
  intentPointerWatcher.onDidCreate(onStateChange);
  context.subscriptions.push(intentPointerWatcher);

  // Watch intents.json so the Intents panel updates when a new intent is created.
  const intentsJsonWatcher = vscode.workspace.createFileSystemWatcher(
    '**/aidlc/spaces/default/intents/intents.json'
  );
  intentsJsonWatcher.onDidChange(onStateChange);
  intentsJsonWatcher.onDidCreate(onStateChange);
  context.subscriptions.push(intentsJsonWatcher);

  outputChannel.appendLine('AIDLC Studio activated.');

  // Show welcome page on first install (or if setting is enabled)
  const showWelcome = config.get<boolean>('showWelcomeOnStartup', true);
  const hasSeenWelcome = context.globalState.get<boolean>('hasSeenWelcome', false);
  if (showWelcome && !hasSeenWelcome) {
    context.globalState.update('hasSeenWelcome', true);
    import('./views/welcomePanel').then(({ WelcomePanel }) => WelcomePanel.show(context));
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables in context.subscriptions
}

/**
 * Check if workspace is configured and offer resume if workflow is active.
 * Also auto-opens artifact if a stage is awaiting approval.
 */
async function checkSetupAndResume(
  ruleLoader: RuleLoader,
  stateManager: StateManager,
  approveCmd: ApproveCommand
): Promise<void> {
  const isConfigured = await ruleLoader.isWorkspaceConfigured();

  if (!isConfigured) {
    const action = await vscode.window.showInformationMessage(
      'AIDLC is not configured in this workspace. Set it up now?',
      'Set Up',
      'Not Now',
      "Don't Ask Again"
    );

    if (action === 'Set Up') {
      vscode.commands.executeCommand('amadeus-aidlc.setup');
    } else if (action === "Don't Ask Again") {
      const config = vscode.workspace.getConfiguration('amadeus-aidlc');
      await config.update('autoDetectSetup', false, vscode.ConfigurationTarget.Workspace);
    }
    return;
  }

  // Check for in-progress workflow
  const state = await stateManager.getCurrentState();
  if (!state || state.stagesCompleted >= state.stagesTotal) {
    return;
  }

  // Check if a stage is awaiting approval — auto-open the artifact
  const awaitingStage = state.stages.find((s) => s.status === 'awaiting-approval');
  if (awaitingStage) {
    vscode.commands.executeCommand('setContext', 'amadeus-aidlc.hasAwaitingApproval', true);

    const action = await vscode.window.showInformationMessage(
      `Stage ${awaitingStage.id} (${awaitingStage.name}) is awaiting your approval.`,
      'Review Now',
      'Later'
    );

    if (action === 'Review Now') {
      approveCmd.reviewArtifact(awaitingStage.id);
    }
    return;
  }

  // Otherwise just inform about in-progress workflow
  const phaseName = ['Initialization', 'Ideation', 'Inception', 'Construction', 'Operation'][state.currentPhase] ?? 'Unknown';
  const currentStage = state.stages.find((s) => s.id === state.currentStageId);

  const action = await vscode.window.showInformationMessage(
    `AIDLC workflow in progress: ${phaseName} > ${currentStage?.name ?? state.currentStageId} (${state.stagesCompleted}/${state.stagesTotal}).`,
    'Copy Continue Command',
    'Later'
  );

  if (action === 'Copy Continue Command') {
    const continueCmd = `/aidlc please continue the workflow for the "${state.intent.label}" intent${currentStage ? ` from stage ${currentStage.id} (${currentStage.name})` : ''}`;
    await vscode.env.clipboard.writeText(continueCmd);
    vscode.window.showInformationMessage('Copied to clipboard. Paste in Kiro chat to continue.');
  }
}
