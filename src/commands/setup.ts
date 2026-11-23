import * as vscode from 'vscode';
import { RuleLoader, RepoAccessError } from '../services/ruleLoader';
import { BunInstaller } from '../services/bunInstaller';
import { VariantAccessChecker, isAccessGated } from '../services/variantAccessChecker';
import { AidlcCli } from '../services/aidlcCli';
import { AIDLC_VARIANTS, AidlcVariant, getVariant } from '../services/variants';
import { amadeusInstallNextSteps, amadeusManualInstallHint } from '../services/installCommands';
import { detectCliPresence } from '../services/cliPresence';

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

      // CLI-FIRST decision point. Both AWS and Amadeus install a binary named
      // `aidlc` to the SAME machine location — there is only ever ONE `aidlc`
      // on PATH — so when a CLI is already present we DETECT its variant from
      // on-disk metadata and configure this project with it, instead of asking
      // "AWS or Amadeus?". The variant picker appears ONLY when no CLI exists
      // and we must bootstrap one.
      const presence = await detectCliPresence();

      // false = setup did not configure this project (Amadeus installer
      // launched in a terminal, or an Amadeus failure already reported).
      const configuredNow = presence.present
        ? await this.executeWithPresentCli(workspaceFolder.uri, presence.variantId)
        : await this.executeWithBootstrap(workspaceFolder.uri);

      if (!configuredNow) {
        await this.onStatusChange();
        return;
      }

      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('=== Setup Complete ===');
      this.outputChannel.appendLine('');
      this.outputChannel.appendLine('Next steps:');
      this.outputChannel.appendLine('  0. Start a NEW chat session so the agent picks up the new files');
      this.outputChannel.appendLine('  1. In Kiro chat, type: /aidlc --doctor   (verify setup)');
      this.outputChannel.appendLine('  2. Then type: /aidlc <description>       (start a workflow)');
      this.outputChannel.appendLine('');

      vscode.window.showInformationMessage(
        'AIDLC installed. Start a new chat session, then type "/aidlc --doctor" in Kiro chat to verify, then "/aidlc [description]" to start.',
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

  /**
   * CLI PRESENT path: detect the variant from on-disk metadata, configure THIS
   * workspace with the installed CLI (`aidlc config`), then run doctor. NO
   * repo clone, NO dist copy, NO installer run — the CLI already exists.
   *
   * On failure, AWS FALLS BACK to the full install path (installMethod switch).
   * Amadeus has NO clone/dist fallback (2.10+ ships no dist/): the failure is
   * logged loudly and reported with the official installer command.
   * Returns false when the project was NOT configured (Amadeus failure).
   */
  private async executeWithPresentCli(
    workspaceUri: vscode.Uri,
    detectedVariantId: 'aws' | 'amadeus' | null
  ): Promise<boolean> {
    // Detect-don't-ask: resolve the variant from what's installed. When
    // detection couldn't classify, fall back to the default (AWS) variant —
    // the config step is variant-agnostic beyond harness resolution.
    const variant = getVariant(detectedVariantId ?? 'aws');
    this.ruleLoader.setVariant(variant);
    this.outputChannel.appendLine(
      `Detected installed aidlc CLI: ${variant.label}. Configuring this workspace (no reinstall).`
    );

    const state = { configured: true };
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Configuring workspace with ${variant.label} CLI`,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: 'Running aidlc config...', increment: 40 });
          await this.ruleLoader.configureWorkspaceForVariant(workspaceUri, variant);

          progress.report({ message: 'Updating .gitignore...', increment: 10 });
          await this.ruleLoader.updateGitignore(workspaceUri);

          progress.report({ message: 'Running aidlc doctor...', increment: 50 });
          await this.runDoctor(workspaceUri);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (variant.installMethod === 'amadeus-cli') {
            state.configured = false;
            this.reportAmadeusFailure(
              variant,
              'Configuring this project with the installed `aidlc` CLI (`aidlc config`)',
              msg
            );
            return;
          }
          this.outputChannel.appendLine(
            `[AIDLC fallback] CLI-first setup was attempted (a present \`aidlc\` CLI was detected ` +
            `and \`aidlc config\` was run), but it FAILED: ${msg}. ` +
            'Now falling back to the LEGACY repo-clone/dist-copy install path.'
          );
          await this.installViaFallback(workspaceUri, variant, progress);
        }
      }
    );
    return state.configured;
  }

  /**
   * CLI ABSENT path: show the AWS/Amadeus picker.
   *  - AWS: bootstrap via the public one-liner, then `aidlc config` + doctor;
   *    on bootstrap failure, FALL BACK to the repo-clone/dist-copy path.
   *  - Amadeus: access pre-check, then launch the OFFICIAL machine installer
   *    in an interactive terminal (README section 1) and stop. The installer
   *    provides Git and Bun, so Studio installs nothing first. The user re-runs
   *    Setup afterwards to configure the project. Returns false in that case.
   *
   * Preserves the session ordering: access pre-check BEFORE prerequisites, and
   * a graceful skip when the probe tool is absent (VariantAccessChecker returns
   * accessible with the GIT_UNAVAILABLE_SKIP sentinel).
   */
  private async executeWithBootstrap(workspaceUri: vscode.Uri): Promise<boolean> {
    const picked = await vscode.window.showQuickPick(
      AIDLC_VARIANTS.map((v) => ({
        label: v.label,
        detail: v.repoUrl,
        id: v.id,
      })),
      {
        title: 'No aidlc CLI found — which AI-DLC version do you want to install?',
        placeHolder: 'Select a variant (AWS open source is recommended for most users)',
      }
    );

    if (!picked) {
      return true; // User cancelled (unchanged behavior: falls through to the caller)
    }

    const variant = getVariant(picked.id);
    this.ruleLoader.setVariant(variant);
    this.outputChannel.appendLine(`Selected variant: ${variant.label} (${variant.repoUrl})`);

    const state = { installerLaunched: false, amadeusFailed: false };
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Setting up ${variant.label}`,
        cancellable: true,
      },
      async (progress, token) => {
        // Step 1: access pre-check (before prerequisites). git is NOT a setup
        // prerequisite — the check USES git only if present; a missing git
        // silently skips and we fall through to the real install-time check.
        if (isAccessGated(variant)) {
          progress.report({ message: 'Step 1/3: Checking access...', increment: 10 });
          const access = await new VariantAccessChecker(this.outputChannel).check(variant);
          if (!access.accessible) {
            throw new RepoAccessError(
              access.reason ?? `No access to ${variant.label}.`,
              variant.label,
              variant.repoUrl
            );
          }
          if (token.isCancellationRequested) { return; }
        }

        // Amadeus: the official installer provides Git and Bun, so do NOT
        // install bun first. Launch it interactively and stop; do not wait.
        if (variant.installMethod === 'amadeus-cli') {
          progress.report({ message: 'Step 2/3: Launching the official installer...', increment: 60 });
          try {
            this.ruleLoader.launchAmadeusInstaller();
            state.installerLaunched = true;
          } catch (e) {
            state.amadeusFailed = true;
            this.reportAmadeusFailure(
              variant,
              'Launching the official Amadeus installer terminal',
              e instanceof Error ? e.message : String(e)
            );
          }
          return;
        }

        // Step 2: Prerequisite — ensure bun (the only setup prerequisite).
        progress.report({ message: 'Step 2/3: Checking bun...', increment: 10 });
        const bunReady = await this.ensureBun();
        if (!bunReady) {
          throw new Error(
            'bun is required for AIDLC. Install manually: https://bun.sh/docs/installation'
          );
        }
        if (token.isCancellationRequested) { return; }

        // Step 3: Bootstrap the CLI, then configure. CLI-first: AWS one-liner /
        // Amadeus machine installer both install the `aidlc` CLI and then run
        // `aidlc config`. On bootstrap failure, fall back to clone/dist.
        try {
          progress.report({ message: 'Step 3/3: Installing the aidlc CLI...', increment: 50 });
          await this.bootstrapCli(workspaceUri, variant);
          if (token.isCancellationRequested) { return; }

          progress.report({ message: 'Updating .gitignore...', increment: 5 });
          await this.ruleLoader.updateGitignore(workspaceUri);

          progress.report({ message: 'Running aidlc doctor...', increment: 25 });
          await this.runDoctor(workspaceUri);
        } catch (e) {
          // A RepoAccessError is an access problem, not a path failure — let it
          // propagate to the friendly "no access" handler rather than clone.
          if (e instanceof RepoAccessError) { throw e; }
          const msg = e instanceof Error ? e.message : String(e);
          this.outputChannel.appendLine(
            `[AIDLC fallback] CLI-first setup was attempted (no CLI was present, so the CLI ` +
            `bootstrap installer was run), but it FAILED: ${msg}. ` +
            'Now falling back to the LEGACY repo-clone/dist-copy install path.'
          );
          await this.installViaFallback(workspaceUri, variant, progress);
        }
      }
    );

    if (state.installerLaunched) {
      this.outputChannel.appendLine('');
      this.outputChannel.appendLine(
        'Amadeus installer launched. Finish it in the "AIDLC Installer" terminal, then run Setup again.'
      );
      vscode.window.showInformationMessage(
        amadeusInstallNextSteps(process.platform),
        'Run Setup Again'
      ).then((action) => {
        if (action === 'Run Setup Again') {
          vscode.commands.executeCommand('amadeus-aidlc.setup');
        }
      });
      return false;
    }
    return !state.amadeusFailed;
  }

  /**
   * Amadeus has no clone/dist fallback (2.10+ ships no dist/; the legacy 2.5
   * installer is a different mode Studio does not drive). Log loudly what was
   * attempted and the underlying error, and show the exact official command
   * for this OS plus a button to open it in the installer terminal.
   */
  private reportAmadeusFailure(variant: AidlcVariant, attempted: string, error: string): void {
    const hint = variant.installScriptUrl
      ? amadeusManualInstallHint(process.platform, variant.installScriptUrl)
      : '';
    this.outputChannel.appendLine(
      `[AIDLC Amadeus] ${attempted} FAILED: ${error}. ` +
      'There is no clone/dist-copy fallback for Amadeus AI-DLC 2.10+. ' + hint
    );
    vscode.window.showErrorMessage(
      `Amadeus AI-DLC setup failed: ${error} ${hint}`,
      'Open Installer Terminal'
    ).then((action) => {
      if (action === 'Open Installer Terminal') {
        try {
          this.ruleLoader.launchAmadeusInstaller();
        } catch (e) {
          this.outputChannel.appendLine(
            `[AIDLC Amadeus] Could not open the installer terminal: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    });
  }

  /**
   * Bootstrap the `aidlc` CLI for AWS via its official native one-liner, which
   * is followed by `aidlc config`. (Amadeus never reaches here: its installer
   * is launched in a terminal by executeWithBootstrap.) A custom
   * 'git-clone-copy' fork has no CLI to bootstrap, so it uses the clone-copy
   * path directly.
   */
  private async bootstrapCli(workspaceUri: vscode.Uri, variant: AidlcVariant): Promise<void> {
    switch (variant.installMethod) {
      case 'native-installer':
        await this.ruleLoader.installViaNativeInstaller(workspaceUri);
        break;
      default:
        // 'repo-installer' (legacy) and 'git-clone-copy' (custom fork) have no
        // CLI to bootstrap; go straight to the clone-based install.
        await this.installViaFallback(workspaceUri, variant);
        break;
    }
  }

  /**
   * LAYERED FALLBACK for AWS and the explicit custom 'git-clone-copy' fork: the
   * repo-clone + official-installer-script + dist-copy path. NEVER used for the
   * Amadeus 2.10+ variant ('amadeus-cli'), which has no dist/ to copy.
   */
  private async installViaFallback(
    workspaceUri: vscode.Uri,
    variant: AidlcVariant,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    if (variant.installMethod === 'amadeus-cli') {
      throw new Error('No clone/dist-copy fallback exists for Amadeus AI-DLC 2.10+.');
    }
    this.outputChannel.appendLine(
      `[AIDLC fallback] Entering the LEGACY repo-clone/dist-copy install path for ` +
      `${variant.label} (installMethod=${variant.installMethod}). The CLI-first path ` +
      'is preferred; an installed `aidlc` CLI avoids this legacy path entirely.'
    );
    switch (variant.installMethod) {
      case 'native-installer':
        progress?.report({ message: 'Fallback: running official installer...' });
        await this.ruleLoader.installViaNativeInstaller(workspaceUri);
        break;
      case 'repo-installer':
        progress?.report({ message: 'Fallback: cloning and running the official installer...' });
        await this.ruleLoader.installViaRepoInstaller(workspaceUri);
        break;
      default: // 'git-clone-copy' (custom / legacy manual copy)
        progress?.report({ message: 'Fallback: cloning AIDLC repo...' });
        await this.ruleLoader.cloneAidlcRepo();
        progress?.report({ message: 'Fallback: installing framework into workspace...' });
        await this.ruleLoader.installFramework(workspaceUri);
        break;
    }

    // Keep the shared post-install steps consistent with the primary path.
    await this.ruleLoader.updateGitignore(workspaceUri);
    await this.runDoctor(workspaceUri);
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

    let result = await cli.doctor(mode);

    // README step 2: when doctor says aidlc resolves only through the
    // interactive PATH, `aidlc config runtime` is the official fix (the rc-file
    // writer is only its fallback). Re-run doctor to confirm.
    if (await this.ruleLoader.fixHookShellPath(workspaceUri, result.raw)) {
      this.outputChannel.appendLine('--- AI-DLC doctor (after PATH fix) ---');
      result = await cli.doctor(mode);
    }

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
