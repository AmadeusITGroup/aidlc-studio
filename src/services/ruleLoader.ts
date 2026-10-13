import * as vscode from 'vscode';
import * as path from 'path';
import { Shell } from './shell';
import { AidlcVariant, getDefaultVariant, resolveHarness } from './variants';
import {
  aidlcBinaryCandidates,
  buildNativeInstallCommand,
  buildRepoInstallerCommand,
} from './installCommands';

export class RuleLoader {
  private clonedRepoPath: string | null = null;
  private activeVariant: AidlcVariant = getDefaultVariant();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel?: vscode.OutputChannel
  ) {}

  /**
   * Set the variant to install. Called by the Setup command after the user picks.
   */
  setVariant(variant: AidlcVariant): void {
    this.activeVariant = variant;
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
    await Shell.run(installCmd, { timeout: 180000, cwd: workspaceUri.fsPath });

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

    for (const bin of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(bin));
      } catch {
        continue; // not installed here — try next known location
      }
      try {
        await Shell.run(`"${bin}" config --harness ${harness}`, {
          timeout: 60000,
          cwd: workspaceUri.fsPath,
        });
        this.outputChannel?.appendLine(`Configured harness using ${bin}`);
        return;
      } catch {
        // exists but failed to run — try the next candidate / bare PATH
      }
    }

    // Secondary attempt: bare `aidlc` on PATH.
    try {
      await Shell.run(`aidlc config --harness ${harness}`, {
        timeout: 60000,
        cwd: workspaceUri.fsPath,
      });
      this.outputChannel?.appendLine('Configured harness using aidlc on PATH');
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.outputChannel?.appendLine(`aidlc config via PATH failed (${msg}).`);
    }

    throw new Error(
      `AIDLC installed but "aidlc config --harness ${harness}" could not run. ` +
      'Open a new terminal and run it manually in your project, then reload.'
    );
  }

  /**
   * Check if the workspace has a working AIDLC framework installed.
   * Looks for the skill file that makes /aidlc work.
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
        throw new Error(
          `Authentication failed for ${repoUrl}. You may need to sign in (SSO) or configure git credentials. Details: ${msg}`
        );
      }
      if (msg.match(/not found|Repository not found|does not exist/i)) {
        throw new Error(
          `Repository not found or inaccessible: ${repoUrl}. Check the URL in settings (amadeus-aidlc.rulesSource).`
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
      throw new Error(
        `${distRel}/ not found in the cloned repo. This variant may not ship a ` +
        `"${harness}" harness, or the repository structure may have changed.`
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
