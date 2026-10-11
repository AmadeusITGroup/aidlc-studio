import * as vscode from 'vscode';
import { AidlcCli } from '../services/aidlcCli';
import { STAGE_DEFINITIONS } from '../services/stageDefinitions';

/**
 * Handles /aidlc commands that map to quick-pick interactions
 * followed by CLI tool invocations.
 */
export class AidlcQuickCommand {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  private getCli(): AidlcCli | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return null;
    }
    return new AidlcCli(this.outputChannel, workspaceFolder.uri);
  }

  /**
   * /aidlc --status
   */
  async status(): Promise<void> {
    const cli = this.getCli();
    if (!cli) { return; }

    const result = await cli.status();
    if (result.success) {
      // Show in a virtual markdown document
      const doc = await vscode.workspace.openTextDocument({
        content: result.stdout,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } else {
      vscode.window.showInformationMessage('No active AIDLC workflow.');
    }
  }

  /**
   * /aidlc --stage <slug>
   */
  async jumpToStage(): Promise<void> {
    const stageItems: vscode.QuickPickItem[] = STAGE_DEFINITIONS.map((s) => ({
      label: `${s.id} ${s.name}`,
      description: s.leadAgent,
      detail: `Phase ${s.phase}`,
    }));

    const selected = await vscode.window.showQuickPick(stageItems, {
      title: '/aidlc --stage — Jump to Stage',
      placeHolder: 'Select a stage to jump to',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) { return; }

    // Extract stage slug from selection
    const stageId = selected.label.split(' ')[0];
    const slug = this.stageIdToSlug(stageId);

    this.outputChannel.appendLine(`Jumping to stage: ${slug}`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc --stage ${slug}`
    );
  }

  /**
   * /aidlc --phase <name>
   */
  async jumpToPhase(): Promise<void> {
    const phases: vscode.QuickPickItem[] = [
      { label: 'ideation', description: 'Phase 1 — Capture intent, feasibility, scope' },
      { label: 'inception', description: 'Phase 2 — Requirements, design, architecture' },
      { label: 'construction', description: 'Phase 3 — Build, test, validate' },
      { label: 'operation', description: 'Phase 4 — Deploy, monitor, optimize' },
    ];

    const selected = await vscode.window.showQuickPick(phases, {
      title: '/aidlc --phase — Jump to Phase',
      placeHolder: 'Select a phase',
    });

    if (!selected) { return; }

    this.outputChannel.appendLine(`Jumping to phase: ${selected.label}`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc --phase ${selected.label}`
    );
  }

  /**
   * /aidlc --scope <name>
   */
  async changeScope(): Promise<void> {
    const scopeItems: vscode.QuickPickItem[] = [
      { label: 'enterprise', description: 'Large-scale, multi-team systems (33 stages)' },
      { label: 'feature', description: 'New feature in existing codebase (~25 stages)' },
      { label: 'mvp', description: 'Minimum viable product (~18 stages)' },
      { label: 'poc', description: 'Proof of concept (~12 stages)' },
      { label: 'bugfix', description: 'Fix a known defect (~10 stages)' },
      { label: 'refactor', description: 'Code improvement (~12 stages)' },
      { label: 'spike', description: 'Research/exploration (~8 stages)' },
      { label: 'infra', description: 'Infrastructure work' },
      { label: 'security-patch', description: 'Security fix' },
      { label: 'classic', description: 'Classic three-phase workflow' },
      { label: 'express', description: 'Quick task, minimal ceremony (~5 stages)' },
    ];

    const selected = await vscode.window.showQuickPick(scopeItems, {
      title: '/aidlc --scope — Change Scope',
      placeHolder: 'Select a new scope',
    });

    if (!selected) { return; }

    this.outputChannel.appendLine(`Scope change requested: ${selected.label}`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc --scope ${selected.label}`
    );
  }

  /**
   * /aidlc --depth <level>
   */
  async changeDepth(): Promise<void> {
    const depthItems: vscode.QuickPickItem[] = [
      { label: 'minimal', description: 'Less documentation, faster stages' },
      { label: 'standard', description: 'Balanced rigor and speed (recommended)' },
      { label: 'comprehensive', description: 'Extra analysis, more artifacts, stricter gates' },
    ];

    const selected = await vscode.window.showQuickPick(depthItems, {
      title: '/aidlc --depth — Change Depth',
      placeHolder: 'Select depth level',
    });

    if (!selected) { return; }

    this.outputChannel.appendLine(`Depth change requested: ${selected.label}`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc --depth ${selected.label}`
    );
  }

  /**
   * /aidlc --test-strategy <level>
   */
  async changeTestStrategy(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
      { label: 'minimal', description: 'Nyquist: 1 test/requirement, happy-path, unit only (~5-15 total)' },
      { label: 'standard', description: '5-8 tests/component, unit + integration' },
      { label: 'comprehensive', description: '10-15 tests/component, all test types' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: '/aidlc --test-strategy — Change Test Strategy',
      placeHolder: 'Select test strategy',
    });

    if (!selected) { return; }

    this.outputChannel.appendLine(`Test strategy change requested: ${selected.label}`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc --test-strategy ${selected.label}`
    );
  }

  /**
   * /aidlc compose
   */
  async compose(): Promise<void> {
    const task = await vscode.window.showInputBox({
      title: '/aidlc compose — Adaptive Composer',
      prompt: 'Describe the task for the composer to build a tailored execution plan',
      placeHolder: 'e.g., "harden the deployment pipeline and add observability"',
      ignoreFocusOut: true,
    });

    if (!task) { return; }

    this.outputChannel.appendLine(`Compose requested: "${task}"`);
    vscode.window.showInformationMessage(
      `Use in Kiro chat: /aidlc compose "${task}"`
    );
  }

  /**
   * /aidlc space
   */
  async switchSpace(): Promise<void> {
    const cli = this.getCli();
    if (!cli) { return; }

    const actions: vscode.QuickPickItem[] = [
      { label: 'List Spaces', description: 'Show all available spaces' },
      { label: 'Switch Space', description: 'Switch to a different space' },
      { label: 'Create Space', description: 'Create a new team space' },
    ];

    const action = await vscode.window.showQuickPick(actions, {
      title: '/aidlc space — Space Management',
      placeHolder: 'What would you like to do?',
    });

    if (!action) { return; }

    if (action.label === 'List Spaces') {
      const result = await cli.spaceList();
      if (result.success) {
        const doc = await vscode.workspace.openTextDocument({
          content: result.stdout,
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    } else if (action.label === 'Create Space') {
      const name = await vscode.window.showInputBox({
        title: 'Create Space',
        prompt: 'Enter a name for the new space',
        placeHolder: 'my-team',
      });
      if (name) {
        const result = await cli.spaceCreate(name);
        if (result.success) {
          vscode.window.showInformationMessage(`Space "${name}" created.`);
        } else {
          vscode.window.showErrorMessage(`Failed to create space: ${result.stderr}`);
        }
      }
    } else {
      vscode.window.showInformationMessage(
        'Use in Kiro chat: /aidlc space <name>'
      );
    }
  }

  /**
   * /aidlc knowledge
   */
  async knowledge(): Promise<void> {
    const actions: vscode.QuickPickItem[] = [
      { label: 'onboard', description: 'Index new documents' },
      { label: 'sync', description: 'Reconcile catalog with disk' },
      { label: 'list', description: 'Show all indexed documents' },
      { label: 'show', description: 'View a specific document record' },
      { label: 'associate', description: 'Scope a document to an intent' },
      { label: 'dissociate', description: 'Remove intent scoping' },
      { label: 'summarize', description: 'Persist an LLM-authored summary' },
    ];

    const action = await vscode.window.showQuickPick(actions, {
      title: '/aidlc knowledge — Document Management',
      placeHolder: 'Select a knowledge command',
    });

    if (!action) { return; }

    if (action.label === 'onboard') {
      const files = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        title: 'Select documents to onboard',
        filters: {
          'Documents': ['pdf', 'docx', 'md', 'txt'],
          'All Files': ['*'],
        },
      });

      if (files && files.length > 0) {
        this.outputChannel.appendLine(`Onboarding ${files.length} document(s)...`);
        vscode.window.showInformationMessage(
          `Use in Kiro chat: /aidlc knowledge onboard [path]`
        );
      }
    } else if (action.label === 'list') {
      const cli = this.getCli();
      if (cli) {
        const result = await cli.knowledgeList();
        if (result.success) {
          const doc = await vscode.workspace.openTextDocument({
            content: result.stdout,
            language: 'json',
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      }
    } else {
      vscode.window.showInformationMessage(
        `Use in Kiro chat: /aidlc knowledge ${action.label}`
      );
    }
  }

  /**
   * /aidlc plugin list
   */
  async pluginList(): Promise<void> {
    const cli = this.getCli();
    if (!cli) { return; }

    const result = await cli.pluginList();
    if (result.success) {
      this.outputChannel.show(true);
      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('=== /aidlc plugin list ===');
      this.outputChannel.appendLine(result.stdout);
    } else {
      vscode.window.showInformationMessage('No plugins configured.');
    }
  }

  /**
   * /aidlc --version
   */
  async version(): Promise<void> {
    const cli = this.getCli();
    if (!cli) { return; }

    const ver = await cli.version();
    vscode.window.showInformationMessage(`AIDLC: ${ver}`);
    this.outputChannel.appendLine(`Framework version: ${ver}`);
  }

  // --- Helpers ---

  private stageIdToSlug(id: string): string {
    const stage = STAGE_DEFINITIONS.find((s) => s.id === id);
    if (!stage) { return id; }
    return stage.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}
