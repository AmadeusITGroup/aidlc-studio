import * as vscode from 'vscode';
import * as path from 'path';
import { Shell } from './shell';
import { AidlcVariant, getDefaultVariant, getVariant, resolveHarness } from './variants';
import {
  aidlcBinaryCandidates,
  buildAmadeusMachineSetupCommand,
  buildNativeInstallCommand,
  buildRepoInstallerCommand,
} from './installCommands';
import { readAidlcInstall } from './aidlcInstallReader';
import { classifyVariant } from './variantDetector';
import {
  applyPathExport,
  buildPathExportBlock,
  nonInteractiveShellEnvFiles,
} from './pathExport';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Thrown when a variant's repository can't be reached because the user lacks
 * access (private/SSO repo, failed auth, or repo-not-found). Carries the
 * variant label and repo URL so callers can show a friendly, variant-aware
 * message ("you don't have access to this version") instead of raw git output.
 */
export class RepoAccessError extends Error {
  constructor(
    message: string,
    readonly variantLabel: string,
    readonly repoUrl: string
  ) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

export class RuleLoader {
  private clonedRepoPath: string | null = null;
  private activeVariant: AidlcVariant = getDefaultVariant();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel?: vscode.OutputChannel
  ) { }

  /**
   * Set the variant to install. Called by the Setup command after the user picks.
   * Persists the choice to workspaceState so it survives extension restarts.
   *
   * NOTE: for 'custom' variants (rulesSource override), we persist the base
   * variant id ('aws') rather than 'custom', because 'custom' is not a real
   * AIDLC_VARIANTS entry and getVariant('custom') would fall back to aws anyway.
   * The rulesSource setting itself is the durable override — it is re-applied
   * by getVariant() on every activation.
   */
  setVariant(variant: AidlcVariant): void {
    this.activeVariant = variant;
    // Persist the underlying id; 'custom' is a transient overlay, not a stored id.
    const persistId = variant.id === 'custom' ? 'aws' : variant.id;
    this.context.workspaceState.update('aidlc.variantId', persistId);
  }

  /**
   * Restore the variant on extension activation so version checks, updates, and
   * doctor commands all target the right repo for an already-configured
   * workspace.
   *
   * Strategy (in priority order):
   *  1. AUTHORITATIVE — on-disk install metadata (`readAidlcInstall()`): the
   *     installer's own `aidlc.settings.json` / `versions/<ver>/version.json`
   *     carry the real variant and keep working even when the `aidlc` binary
   *     can't be executed (e.g. the F5 host). This OVERRIDES a stale persisted
   *     value and reconciles the cache so it self-heals.
   *  2. Persisted variant id in workspaceState (set by setVariant()).
   *  3. File heuristic: `.kiro/tools/aidlc-utility.ts` present → Amadeus;
   *     AWS native does not ship this file.
   *  4. Binary `--version` probe: classify the stdout (amadeus vs a plain
   *     awslabs semver → AWS).
   *  5. Default AWS (no persistence).
   *
   * Returns the resolved variant so callers (extension.ts) can sync it into
   * other services (e.g. UpdateChecker) immediately.
   */
  async restoreVariant(): Promise<AidlcVariant> {
    // 1. AUTHORITATIVE: on-disk install metadata.
    const install = await readAidlcInstall();
    if (install) {
      this.setResolved(install.variantId, 'on-disk install metadata');
      return this.activeVariant;
    }

    // 2. Persisted id.
    const persistedId = this.context.workspaceState.get<string>('aidlc.variantId');
    if (persistedId) {
      this.activeVariant = getVariant(persistedId);
      this.outputChannel?.appendLine(
        `Variant resolved from persisted workspaceState: ${persistedId}`
      );
      return this.activeVariant;
    }

    // 3. File heuristic: the bun tool entry point marks an Amadeus/custom clone.
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const bunToolUri = vscode.Uri.joinPath(
        workspaceFolder.uri, '.kiro', 'tools', 'aidlc-utility.ts'
      );
      try {
        await vscode.workspace.fs.stat(bunToolUri);
        this.setResolved('amadeus', 'workspace file heuristic (aidlc-utility.ts)');
        return this.activeVariant;
      } catch { /* not found — not an Amadeus clone, fall through */ }
    }

    // 4. Binary `--version` probe (bare PATH).
    try {
      const { stdout } = await Shell.run('aidlc --version', { timeout: 10000 });
      const classified = classifyVariant(stdout, '');
      if (classified.variantId === 'amadeus') {
        this.setResolved('amadeus', 'binary --version probe');
        return this.activeVariant;
      }
      // Plain awslabs semver → AWS default (no persistence).
      this.outputChannel?.appendLine('Variant resolved to AWS from binary --version probe');
    } catch { /* binary not runnable */ }

    // 5. Default: AWS (or unconfigured workspace). No persistence.
    this.outputChannel?.appendLine('Variant resolved to AWS default (no signal matched)');
    return this.activeVariant; // already getDefaultVariant() (aws)
  }

  /**
   * Apply a resolved variant id: stamp the active variant, reconcile the
   * persisted cache, and log which signal won.
   */
  private setResolved(
    variantId: 'aws' | 'amadeus',
    signal: string
  ): void {
    this.activeVariant = getVariant(variantId);
    this.context.workspaceState.update('aidlc.variantId', variantId);
    this.outputChannel?.appendLine(
      `Variant resolved from ${signal}: ${variantId}`
    );
  }

  get variant(): AidlcVariant {
    return this.activeVariant;
  }

  /**
   * Install the AWS variant using its official native release installer.
   * Issues the upstream one-liner directly (no temp-file download/run dance):
   * Windows `irm <url> | iex`, Unix `curl -fsSL <url> | sh`. Then runs
   * `aidlc config --harness <harness>` where the harness is chosen by the host
   * IDE (kiro-ide in Kiro, copilot in VS Code). The installed runtime needs
   * neither git nor bun.
   */
  async installViaNativeInstaller(workspaceUri: vscode.Uri): Promise<void> {
    const variant = this.activeVariant;
    if (!variant.installScriptUrl) {
      throw new Error(`Variant ${variant.label} has no install script configured.`);
    }

    const scriptUrl = process.platform === 'win32'
      ? variant.installScriptUrl.windows
      : variant.installScriptUrl.unix;

    const installCmd = buildNativeInstallCommand(process.platform, scriptUrl);
    this.outputChannel?.appendLine(`Running official native installer: ${installCmd}`);
    if (this.outputChannel) {
      await Shell.runStreaming(installCmd, this.outputChannel, {
        timeout: 180000,
        cwd: workspaceUri.fsPath,
      });
    } else {
      await Shell.run(installCmd, { timeout: 180000, cwd: workspaceUri.fsPath });
    }

    // Configure the single harness that matches the host IDE, clamped to what
    // this variant actually ships.
    const { harness, fellBack } = resolveHarness(variant);
    if (fellBack) {
      this.outputChannel?.appendLine(
        `Note: ${variant.label} does not provide a harness for this IDE; installing "${harness}" instead.`
      );
    }
    this.outputChannel?.appendLine(`Configuring harness (aidlc config --harness ${harness})...`);
    await this.runAidlcConfig(workspaceUri, harness);

    // Make the freshly-installed aidlc CLI reachable from Kiro's
    // non-interactive hook shells (Mac/Unix). No-op on Windows.
    this.ensureAidlcOnPath();
  }

  /**
   * Install the Amadeus variant using the 2.10+ CLI-driven model, which mirrors
   * the AWS native path: run the machine installer to put the `aidlc` CLI on
   * the machine (no project touched), then `aidlc config --harness <harness>`
   * to configure the project. This replaces the old clone-and-copy-dist flow,
   * which assumed the retired 2.5 `dist/<harness>/` layout the 2.10+ repo no
   * longer ships.
   *
   * The ONLY uncertain, SSO-gated value is the machine-installer invocation,
   * isolated behind buildAmadeusMachineSetupCommand (install-aidlc.ps1
   * -SkipCredentials). The project-config step reuses runAidlcConfig verbatim.
   *
   * ASSUMPTION pending confirmation on a real Amadeus 2.10+ machine: the
   * machine installer is remote-pipeable from variant.installScriptUrl (as AWS
   * is). If it turns out it must be obtained via an SSO clone first, change the
   * command source here — fetch/clone, then point the builder at the local
   * script path — while keeping runAidlcConfig below unchanged.
   */
  async installViaAmadeusCli(workspaceUri: vscode.Uri): Promise<void> {
    const variant = this.activeVariant;
    if (!variant.installScriptUrl) {
      throw new Error(`Variant ${variant.label} has no install script configured.`);
    }

    const scriptPathOrUrl = process.platform === 'win32'
      ? variant.installScriptUrl.windows
      : variant.installScriptUrl.unix;

    // The single, correctable Amadeus machine-setup command (see
    // buildAmadeusMachineSetupCommand for the isolated assumptions).
    const installCmd = buildAmadeusMachineSetupCommand(process.platform, scriptPathOrUrl);
    this.outputChannel?.appendLine(`Running Amadeus machine installer: ${installCmd}`);
    if (this.outputChannel) {
      await Shell.runStreaming(installCmd, this.outputChannel, {
        timeout: 180000,
        cwd: workspaceUri.fsPath,
      });
    } else {
      await Shell.run(installCmd, { timeout: 180000, cwd: workspaceUri.fsPath });
    }

    // Configure the single harness that matches the host IDE, clamped to what
    // this variant actually ships. Reuses runAidlcConfig verbatim (same as AWS).
    const { harness, fellBack } = resolveHarness(variant);
    if (fellBack) {
      this.outputChannel?.appendLine(
        `Note: ${variant.label} does not provide a harness for this IDE; installing "${harness}" instead.`
      );
    }
    this.outputChannel?.appendLine(`Configuring harness (aidlc config --harness ${harness})...`);
    await this.runAidlcConfig(workspaceUri, harness);

    // Make the freshly-installed aidlc CLI reachable from Kiro's
    // non-interactive hook shells (Mac/Unix). No-op on Windows.
    this.ensureAidlcOnPath();
  }

  /**
   * Ensure the freshly-installed `aidlc` CLI is on PATH for Kiro's
   * NON-INTERACTIVE hook shells. Mirrors BunInstaller.ensureBunOnPath: on
   * Mac/Linux the CLI installs to a user bin dir (e.g. ~/.local/bin or
   * ~/.aidlc/bin) that only the INTERACTIVE login PATH carries, so Kiro's
   * hook shells can't find it (doctor warns "aidlc is interactive-only").
   *
   * - Unix: append an export block to ~/.zshenv (zsh) and ~/.bashrc (bash),
   *   guarded by a unique marker so it's written only once; also update
   *   process.env.PATH for the current session. The bin dir chosen is
   *   whichever of the known candidate dirs actually exists (preferring
   *   ~/.local/bin, then ~/.aidlc/bin). NOTE: /etc/paths.d would be the
   *   system-wide alternative the doctor suggests, but it needs sudo, so the
   *   rc-file approach (same as bun) is the permission-safe equivalent.
   * - Windows: no-op — the native installer updates the user PATH via the
   *   registry (same as bun).
   *
   * Returns true if a config file was written/updated.
   */
  private ensureAidlcOnPath(): boolean {
    if (process.platform === 'win32') {
      this.outputChannel?.appendLine(
        'Windows: the aidlc installer updates the user PATH (registry). Reload to pick it up.'
      );
      return false;
    }

    const home = os.homedir();
    // Prefer ~/.local/bin, then ~/.aidlc/bin — the Mac/Unix CLI install dirs.
    const candidateBinDirs = [
      path.posix.join(home, '.local', 'bin'),
      path.posix.join(home, '.aidlc', 'bin'),
    ];
    const binDir = candidateBinDirs.find((dir) => fs.existsSync(path.join(dir, 'aidlc')))
      ?? candidateBinDirs.find((dir) => fs.existsSync(dir))
      ?? candidateBinDirs[0];

    const marker = 'AIDLC Studio — aidlc on PATH';
    const exportBlock = buildPathExportBlock(marker, binDir);

    const wrote = applyPathExport(
      nonInteractiveShellEnvFiles(home),
      exportBlock,
      marker,
      (m) => this.outputChannel?.appendLine(m)
    );

    // Also update the current process PATH so it works this session.
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;

    return wrote;
  }

  /**
   * CLI-FIRST workspace configuration. When the `aidlc` CLI is already present
   * on the machine, configuring THIS project is just `aidlc config --harness
   * <h> --yes` — no clone, no dist-copy, no installer run. The harness is
   * resolved from the given variant (host IDE clamped to what the variant
   * ships), and the call reuses runAidlcConfig verbatim (absolute-path binary
   * resolution + config-conflict handling).
   *
   * Used by both setup (CLI-present branch) and workspace update. Throws on
   * failure so the caller can fall back to the clone/dist path.
   */
  async configureWorkspaceForVariant(
    workspaceUri: vscode.Uri,
    variant: AidlcVariant
  ): Promise<void> {
    const { harness, fellBack } = resolveHarness(variant);
    if (fellBack) {
      this.outputChannel?.appendLine(
        `Note: ${variant.label} does not provide a harness for this IDE; configuring "${harness}" instead.`
      );
    }
    this.outputChannel?.appendLine(
      `Configuring workspace with the installed aidlc CLI (aidlc config --harness ${harness})...`
    );
    await this.runAidlcConfig(workspaceUri, harness);
    // Keep the freshly-configured CLI reachable from Kiro's non-interactive
    // hook shells (Mac/Unix). No-op on Windows.
    this.ensureAidlcOnPath();
  }

  /**
   * Run `aidlc config --harness <harness>`. The freshly-installed binary is
   * usually not yet on this process's PATH, so resolve it by its known install
   * location FIRST (absolute path), falling back to a bare-PATH `aidlc` only as
   * a secondary attempt. If nothing works, surface a clear manual-step error.
   */
  private async runAidlcConfig(workspaceUri: vscode.Uri, harness: string): Promise<void> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const candidates = aidlcBinaryCandidates(process.platform, home);

    // Try each known absolute path first, then fall back to bare PATH.
    const binsToTry: string[] = [];
    for (const bin of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(bin));
        binsToTry.push(`"${bin}"`);
      } catch {
        // not at this location — skip
      }
    }
    binsToTry.push('aidlc'); // bare PATH attempt last

    for (const binExpr of binsToTry) {
      try {
        if (this.outputChannel) {
          await Shell.runStreaming(`${binExpr} config --harness ${harness} --yes`, this.outputChannel, {
            timeout: 60000,
            cwd: workspaceUri.fsPath,
          });
        } else {
          await Shell.run(`${binExpr} config --harness ${harness} --yes`, {
            timeout: 60000,
            cwd: workspaceUri.fsPath,
          });
        }
        this.outputChannel?.appendLine(`Configured harness using ${binExpr}`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.outputChannel?.appendLine(`aidlc config failed with ${binExpr}: ${msg}`);

        // Exit code 4 = config conflict (e.g. existing AGENTS.md the installer
        // can't categorise). Surface a clear, actionable message instead of
        // silently trying the next candidate — all candidates will hit the same
        // conflict.
        if (msg.includes('config conflict') || msg.includes('legacy root integration')) {
          throw new Error(
            'aidlc config detected a conflict with an existing AGENTS.md file. ' +
            'This happens when the workspace already has an AGENTS.md that is not managed by AIDLC. ' +
            'To fix: open a terminal in your project and run:\n' +
            '  aidlc config --dry-run --verbose   (to preview)\n' +
            `  aidlc config --harness ${harness} --yes   (to apply)\n` +
            'You may need to move or merge your existing AGENTS.md first.'
          );
        }
      }
    }

    throw new Error(
      `AIDLC installed but "aidlc config --harness ${harness}" could not run. ` +
      'Open a new terminal in your project and run it manually:\n' +
      `  aidlc config --harness ${harness} --yes`
    );
  }

  /**
   * Check whether the AIDLC framework is installed in THIS workspace.
   *
   * This is workspace-scoped on purpose: it answers "is this project set up?",
   * NOT "is an `aidlc` CLI available on this machine?". A globally-installed
   * CLI with an empty/unconfigured project folder must report `false` so the
   * Setup row offers setup rather than falsely showing "Installed". The
   * machine-wide CLI presence/version is surfaced separately by the
   * "Installed CLI" row (see UpdateChecker / aidlcInstallReader), so we do NOT
   * OR it in here.
   *
   * Configured == the framework files a real install writes into the project:
   * the `/aidlc` skill plus the workspace shell memory dir. Both are produced
   * by every supported install path (native `aidlc config`, the Amadeus CLI
   * path, and the custom clone-copy), so requiring both is a reliable signal.
   */
  async isWorkspaceConfigured(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return false;
    }

    const skillUri = vscode.Uri.joinPath(
      workspaceFolder.uri, '.kiro', 'skills', 'aidlc', 'SKILL.md'
    );
    const shellUri = vscode.Uri.joinPath(
      workspaceFolder.uri, 'aidlc', 'spaces', 'default', 'memory'
    );
    try {
      await vscode.workspace.fs.stat(skillUri);
      await vscode.workspace.fs.stat(shellUri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Step 2: Clone the Amadeus AIDLC repository to a temp location.
   * Always removes any stale temp clone first so a re-run never fails on
   * "destination path already exists".
   */
  async cloneAidlcRepo(): Promise<void> {
    const variant = this.activeVariant;
    const repoUrl = variant.repoUrl;
    const branch = variant.branch;
    this.outputChannel?.appendLine(`Using AIDLC variant: ${variant.label} (${repoUrl} @ ${branch})`);

    const tempBase = path.join(
      process.env.TEMP ?? process.env.TMPDIR ?? '/tmp',
      'amadeus-aidlc-setup'
    );

    // Always clean the temp dir first (fixes "already exists and is not empty")
    await Shell.removeDir(tempBase);

    // Clone
    const cloneCmd = `git clone --depth 1 --branch ${branch} "${repoUrl}" "${tempBase}"`;
    try {
      await Shell.run(cloneCmd, { timeout: 120000 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      // Clean up partial clone
      await Shell.removeDir(tempBase);

      if (msg.match(/Authentication|403|401|could not read Username|terminal prompts disabled/i)) {
        throw new RepoAccessError(
          `Authentication failed for ${repoUrl}. You may need to sign in (SSO) or configure git credentials. Details: ${msg}`,
          variant.label,
          repoUrl
        );
      }
      if (msg.match(/not found|Repository not found|does not exist/i)) {
        throw new RepoAccessError(
          `Repository not found or inaccessible: ${repoUrl}. Check the URL in settings (amadeus-aidlc.rulesSource).`,
          variant.label,
          repoUrl
        );
      }
      throw new Error(`Failed to clone ${repoUrl}: ${msg}`);
    }

    this.clonedRepoPath = tempBase;
  }

  /**
   * Install the Amadeus variant using its OFFICIAL one-click installer.
   * Clones the (SSO) repo via cloneAidlcRepo() — reusing its auth-failure /
   * not-found error handling and temp-dir cleanup — then runs the shipped
   * scripts/install-aidlc.ps1 (Windows) / scripts/install-aidlc.sh (Unix) with
   * the workspace as target and the resolved harness. If the installer script
   * is absent, or the invocation fails in a way indicating a missing/unsupported
   * script, falls back to the legacy manual-copy path (installFramework) so
   * install still succeeds. Always cleans up the temp clone.
   */
  async installViaRepoInstaller(workspaceUri: vscode.Uri): Promise<void> {
    const variant = this.activeVariant;
    await this.cloneAidlcRepo();

    const clonePath = this.clonedRepoPath;
    if (!clonePath) {
      throw new Error('Repository not cloned. Run cloneAidlcRepo() first.');
    }

    const scriptDir = path.join(clonePath, 'scripts');
    const scriptName = process.platform === 'win32' ? 'install-aidlc.ps1' : 'install-aidlc.sh';
    const scriptPath = path.join(scriptDir, scriptName);

    let scriptPresent = true;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(scriptPath));
    } catch {
      scriptPresent = false;
    }

    if (scriptPresent) {
      const { harness, fellBack } = resolveHarness(variant);
      if (fellBack) {
        this.outputChannel?.appendLine(
          `Note: ${variant.label} does not provide a harness for this IDE; installing "${harness}" instead.`
        );
      }
      const installCmd = buildRepoInstallerCommand(
        process.platform,
        scriptDir,
        workspaceUri.fsPath,
        harness
      );
      try {
        this.outputChannel?.appendLine(`Using official one-click installer: ${installCmd}`);
        await Shell.run(installCmd, { timeout: 600000, cwd: workspaceUri.fsPath });
        await Shell.removeDir(clonePath);
        this.clonedRepoPath = null;
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.outputChannel?.appendLine(
          `Official installer failed (${msg}) — falling back to manual copy.`
        );
        // Fall through to the manual-copy path; clone is still available.
      }
    } else {
      this.outputChannel?.appendLine('Installer script not found — falling back to manual copy.');
    }

    // Fallback: legacy manual-copy. installFramework cleans up the clone itself.
    await this.installFramework(workspaceUri);
  }

  /**
   * Step 3: Copy the harness-specific dist/<harness>/ into the workspace.
   * This is the Amadeus/custom (git-clone-copy) path, which matches the
   * Amadeus README's manual install steps exactly:
   *   mkdir -p your-project/.kiro your-project/aidlc
   *   cp -R dist/<harness>/.kiro/. your-project/.kiro/
   *   cp -R dist/<harness>/aidlc/. your-project/aidlc/
   *   cp dist/<harness>/AGENTS.md your-project/AGENTS.md
   * The harness is resolved by resolveHarness(): the host IDE's harness clamped
   * to what the variant ships. Amadeus is Kiro-only (kiro-ide / kiro), so in
   * VS Code it falls back to kiro-ide — there is no copilot harness to copy.
   */
  async installFramework(workspaceUri: vscode.Uri): Promise<void> {
    if (!this.clonedRepoPath) {
      throw new Error('Repository not cloned. Run cloneAidlcRepo() first.');
    }

    const variant = this.activeVariant;
    // Derive the dist subfolder from the host IDE's harness, clamped to what
    // this variant ships (e.g. Amadeus is Kiro-only, so VS Code falls back to
    // kiro-ide rather than a non-existent dist/copilot). variant.distPath
    // (e.g. "dist/kiro-ide") provides the base dir; we swap the leaf.
    const { harness, fellBack } = resolveHarness(variant);
    if (fellBack) {
      this.outputChannel?.appendLine(
        `Note: ${variant.label} does not provide a harness for this IDE; installing "${harness}" instead.`
      );
    }
    const distBase = path.dirname(variant.distPath); // "dist"
    const distRel = `${distBase}/${harness}`;
    const distDir = path.join(this.clonedRepoPath, ...distRel.split('/'));
    const workspacePath = workspaceUri.fsPath;
    this.outputChannel?.appendLine(`Installing harness "${harness}" from ${distRel}/`);

    // Verify the dist dir exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(distDir));
    } catch {
      await Shell.removeDir(this.clonedRepoPath);
      this.clonedRepoPath = null;
      // This is the LEGACY clone/dist fallback failing on a 2.10+ repo that no
      // longer ships a `dist/<harness>/` tree. Guide the user to the preferred
      // CLI-first path rather than leaving a bare "not found" message.
      this.outputChannel?.appendLine(
        `[AIDLC fallback] The legacy clone/dist path could not find ${distRel}/ in the cloned repo. ` +
        'Modern AI-DLC (2.10+) installs via the `aidlc` CLI and no longer ships this dist layout.'
      );
      throw new Error(
        `${distRel}/ not found in the cloned repo. Modern AI-DLC (2.10+) no longer ships a ` +
        `"dist/${harness}" layout — it installs via the \`aidlc\` CLI instead. ` +
        'Install the `aidlc` CLI (it is detected automatically and avoids this legacy clone/dist path ' +
        'entirely), then re-run setup. This variant may also simply not ship a ' +
        `"${harness}" harness, or its repository structure may have changed.`
      );
    }

    const kiroDir = path.join(workspacePath, '.kiro');
    const aidlcDir = path.join(workspacePath, 'aidlc');

    // Ensure target dirs exist
    await Shell.ensureDir(kiroDir);
    await Shell.ensureDir(aidlcDir);

    // Copy .kiro/ contents
    await Shell.copyDirContents(path.join(distDir, '.kiro'), kiroDir);

    // Copy aidlc/ contents (workspace shell)
    await Shell.copyDirContents(path.join(distDir, 'aidlc'), aidlcDir);

    // Copy AGENTS.md (merge if exists)
    await this.installAgentsFile(distDir, workspacePath);

    // Cleanup temp clone
    await Shell.removeDir(this.clonedRepoPath);
    this.clonedRepoPath = null;
  }

  private async installAgentsFile(distDir: string, workspacePath: string): Promise<void> {
    const sourceAgents = path.join(distDir, 'AGENTS.md');
    const targetAgents = path.join(workspacePath, 'AGENTS.md');

    // Check if source exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(sourceAgents));
    } catch {
      return; // No AGENTS.md in dist — skip
    }

    // Check if target exists (merge scenario)
    try {
      const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(targetAgents));
      const existingText = Buffer.from(existing).toString('utf-8');

      if (existingText.includes('AI-DLC') || existingText.includes('AIDLC')) {
        return; // Already has AIDLC content — leave as-is
      }

      // Merge: append AIDLC content to existing
      const newContent = await vscode.workspace.fs.readFile(vscode.Uri.file(sourceAgents));
      const newText = Buffer.from(newContent).toString('utf-8');
      const merged = existingText.trimEnd() + '\n\n' + newText;
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetAgents), Buffer.from(merged, 'utf-8'));
    } catch {
      // Target doesn't exist — just copy
      await Shell.copyFile(sourceAgents, targetAgents);
    }
  }

  /**
   * Step 4: Add aidlc/ to .gitignore.
   */
  async updateGitignore(workspaceUri: vscode.Uri): Promise<void> {
    const gitignoreUri = vscode.Uri.joinPath(workspaceUri, '.gitignore');
    const entry = '\n# Amadeus AIDLC working directory\naidlc/\n';

    try {
      const existing = await vscode.workspace.fs.readFile(gitignoreUri);
      const content = Buffer.from(existing).toString('utf-8');
      if (!content.includes('aidlc/')) {
        const updated = content + entry;
        await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(updated, 'utf-8'));
      }
    } catch {
      await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(entry.trim() + '\n', 'utf-8'));
    }
  }

  /**
   * Verify the installation is complete.
   */
  async verify(workspaceUri: vscode.Uri): Promise<{ valid: boolean; missing: string[] }> {
    const requiredPaths = [
      '.kiro/skills/aidlc/SKILL.md',
      '.kiro/tools/aidlc-utility.ts',
      '.kiro/hooks',
      '.kiro/agents',
      'aidlc/spaces/default/memory',
      'AGENTS.md',
    ];

    const missing: string[] = [];

    for (const p of requiredPaths) {
      const uri = vscode.Uri.joinPath(workspaceUri, p);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        missing.push(p);
      }
    }

    return { valid: missing.length === 0, missing };
  }
}
