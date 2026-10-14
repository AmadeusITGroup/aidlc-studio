import * as vscode from 'vscode';
import { RuleLoader, RepoAccessError } from '../services/ruleLoader';
import { BunInstaller } from '../services/bunInstaller';
import { AidlcCli } from '../services/aidlcCli';
import { AIDLC_VARIANTS, getVariant } from '../services/variants';

export class SetupCommand {
  constructor(
    private readonly ruleLoader: RuleLoader,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onStatusChange: () => Promise<void>
  ) {}

  async execute(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('=== AIDLC Studio Setup ===');
    this.outputChannel.appendLine(`Target workspace: ${workspaceFolder.uri.fsPath}`);

    try {
      // Check if already configured
      const isConfigured = await this.ruleLoader.isWorkspaceConfigured();
      if (isConfigured) {
        const choice = await vscode.window.showWarningMessage(
          'AIDLC is already installed in this workspace. What would you like to do?',
          'Reinstall (overwrite)',
          'Run Doctor Only',
          'Cancel'
        );
        if (choice === 'Run Doctor Only') {
          await this.runDoctor(workspaceFolder.uri);
          return;
        }
        if (choice !== 'Reinstall (overwrite)') {
          return;
        }
      }

      // Ask which AIDLC variant to install
      const picked = await vscode.window.showQuickPick(
        AIDLC_VARIANTS.map((v) => ({
          label: v.label,
          detail: v.repoUrl,
          id: v.id,
        })),
        {
          title: 'Which AI-DLC version do you want to install?',
          placeHolder: 'Select a variant (AWS open source is recommended for most users)',
        }
      );

      if (!picked) {
        return; // User cancelled
      }

      const variant = getVariant(picked.id);
      this.ruleLoader.setVariant(variant);
      this.outputChannel.appendLine(`Selected variant: ${variant.label} (${variant.repoUrl})`);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Setting up ${variant.label}`,
          cancellable: true,
        },
        async (progress, token) => {
          // Step 1: Ensure bun is installed
          progress.report({ message: 'Step 1/5: Checking bun...', increment: 5 });
          const bunReady = await this.ensureBun();
          if (!bunReady) {
            throw new Error(
              'bun is required for AIDLC. Install manually: https://bun.sh/docs/installation'
            );
          }
          if (token.isCancellationRequested) { return; }

          // Step 2+3: Install the framework via the variant's OFFICIAL method.
          switch (variant.installMethod) {
            case 'native-installer':
              progress.report({ message: 'Step 2/4: Running official installer...', increment: 50 });
              await this.ruleLoader.installViaNativeInstaller(workspaceFolder.uri);
              break;
            case 'repo-installer':
              progress.report({ message: 'Step 2/4: Running official installer...', increment: 50 });
              await this.ruleLoader.installViaRepoInstaller(workspaceFolder.uri);
              break;
            default: // 'git-clone-copy' (custom / legacy manual copy)
              progress.report({ message: 'Step 2/4: Cloning AIDLC repo...', increment: 20 });
              await this.ruleLoader.cloneAidlcRepo();
              if (token.isCancellationRequested) { return; }

              progress.report({ message: 'Step 3/4: Installing framework into workspace...', increment: 30 });
              await this.ruleLoader.installFramework(workspaceFolder.uri);
              break;
          }
          if (token.isCancellationRequested) { return; }

          // Step 4: Update .gitignore
          progress.report({ message: 'Updating .gitignore...', increment: 10 });
          await this.ruleLoader.updateGitignore(workspaceFolder.uri);

          // Step 5: Run /aidlc --doctor to verify
          progress.report({ message: 'Running /aidlc --doctor...', increment: 30 });
          await this.runDoctor(workspaceFolder.uri);
        }
      );

      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('=== Setup Complete ===');
      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('Next steps:');
      this.outputChannel.appendLine('  1. In Kiro chat, type: /aidlc --doctor   (verify setup)');
      this.outputChannel.appendLine('  2. Then type: /aidlc <description>       (start a workflow)');
      this.outputChannel.appendLine('');

      vscode.window.showInformationMessage(
        'AIDLC installed. Type "/aidlc --doctor" in Kiro chat to verify, then "/aidlc [description]" to start.',
        'Copy /aidlc --doctor'
      ).then((action) => {
        if (action === 'Copy /aidlc --doctor') {
          vscode.env.clipboard.writeText('/aidlc --doctor');
          vscode.window.showInformationMessage('Copied to clipboard. Paste in Kiro chat.');
        }
      });

      // Reload status from disk and refresh all views (awaited so the
      // System panel reflects the newly installed framework immediately)
      await this.onStatusChange();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // No access to a private/SSO variant repo (e.g. a public user picking the
      // Amadeus internal fork). Show a clear "you don't have access" message
      // instead of raw git output, and log the technical detail for debugging.
      if (error instanceof RepoAccessError) {
        this.outputChannel.appendLine(`\nSetup failed: ${message}`);
        vscode.window.showErrorMessage(
          `You don't have access to "${error.variantLabel}". This version is restricted — ` +
          `make sure you're on the required network and signed in, or choose the open-source version instead.`
        );
        await this.onStatusChange();
        return;
      }

      this.outputChannel.appendLine(`\nSetup failed: ${message}`);
      vscode.window.showErrorMessage(`AIDLC setup failed: ${message}`);
      // Still refresh so any partial state is reflected
      await this.onStatusChange();
    }
  }

  private async ensureBun(): Promise<boolean> {
    const bunInstaller = new BunInstaller(this.outputChannel);
    const check = await bunInstaller.check();

    if (check.installed) {
      this.outputChannel.appendLine(`✓ bun v${check.version} found`);
      return true;
    }

    this.outputChannel.appendLine('✗ bun not found — installing...');
    return bunInstaller.install();
  }

  private async runDoctor(workspaceUri: vscode.Uri): Promise<void> {
    const cli = new AidlcCli(this.outputChannel, workspaceUri);

    // Run the doctor command that matches how this variant installs, derived
    // directly from the variant's doctorMode:
    //  - 'native' (AWS) -> `aidlc doctor`
    //  - 'bun-tool' (Amadeus/custom) -> `bun .kiro/tools/aidlc-utility.ts doctor`
    const mode = this.ruleLoader.variant.doctorMode;

    this.outputChannel.appendLine('');
    this.outputChannel.appendLine('--- AI-DLC doctor ---');

    const result = await cli.doctor(mode);

    if (result.passed) {
      const passCount = result.checks.filter((c) => c.passed).length;
      this.outputChannel.appendLine(`\n✓ All checks passed (${passCount} total)`);
    } else {
      this.outputChannel.appendLine(`\n✗ ${result.failures.length} failure(s):`);
      for (const f of result.failures) {
        this.outputChannel.appendLine(`  ✗ ${f}`);
      }
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          this.outputChannel.appendLine(`  ⚠ ${w}`);
        }
      }
    }
  }
}
