import * as vscode from 'vscode';
import * as path from 'path';
import { Shell } from './shell';
import { AidlcVariant, getDefaultVariant } from './variants';

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
   * Install the AWS variant using its native release installer.
   * Downloads install.sh / install.ps1, runs it, then `aidlc config --harness kiro-ide`.
   * The installed runtime needs neither git nor bun.
   */
  async installViaNativeInstaller(workspaceUri: vscode.Uri): Promise<void> {
    const variant = this.activeVariant;
    if (!variant.installScriptUrl) {
      throw new Error(`Variant ${variant.label} has no install script configured.`);
    }

    const isWindows = process.platform === 'win32';
    const scriptUrl = isWindows ? variant.installScriptUrl.windows : variant.installScriptUrl.unix;
    const tmpBase = path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'aidlc-native-install');

    await Shell.removeDir(tmpBase);
    await Shell.ensureDir(tmpBase);

    const scriptName = isWindows ? 'install.ps1' : 'install.sh';
    const scriptPath = path.join(tmpBase, scriptName);

    this.outputChannel?.appendLine(`Downloading installer: ${scriptUrl}`);
    await Shell.run(`curl -fsSL "${scriptUrl}" -o "${scriptPath}"`, { timeout: 60000 });

    this.outputChannel?.appendLine('Running native installer...');
    if (isWindows) {
      await Shell.run(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { timeout: 180000, cwd: workspaceUri.fsPath }
      );
    } else {
      await Shell.run(`sh "${scriptPath}"`, { timeout: 180000, cwd: workspaceUri.fsPath });
    }

    await Shell.removeDir(tmpBase);

    // Project the Kiro IDE shell into this workspace.
    // The installer puts an `aidlc` binary on PATH; use it to configure the harness.
    this.outputChannel?.appendLine('Configuring harness (aidlc config --harness kiro-ide)...');
    try {
      await Shell.run('aidlc config --harness kiro-ide', {
        timeout: 60000,
        cwd: workspaceUri.fsPath,
      });
    } catch (e) {
      // The binary may not be on PATH in this process yet — try common locations
      const msg = e instanceof Error ? e.message : String(e);
      this.outputChannel?.appendLine(`aidlc config via PATH failed (${msg}); trying known locations...`);
      await this.runAidlcConfigFallback(workspaceUri);
    }
  }

  private async runAidlcConfigFallback(workspaceUri: vscode.Uri): Promise<void> {
    const isWindows = process.platform === 'win32';
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const candidates = isWindows
      ? [path.join(home, '.aidlc', 'bin', 'aidlc.exe'), path.join(home, 'AppData', 'Local', 'aidlc', 'aidlc.exe')]
      : [path.join(home, '.aidlc', 'bin', 'aidlc'), path.join(home, '.local', 'bin', 'aidlc'), '/usr/local/bin/aidlc'];

    for (const bin of candidates) {
      try {
        await Shell.run(`"${bin}" config --harness kiro-ide`, {
          timeout: 60000,
          cwd: workspaceUri.fsPath,
        });
        this.outputChannel?.appendLine(`Configured harness using ${bin}`);
        return;
      } catch {
        // try next
      }
    }
    throw new Error(
      'AIDLC installed but "aidlc config --harness kiro-ide" could not run. ' +
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
   * Step 3: Copy dist/kiro-ide/ into the workspace.
   *   mkdir -p your-project/.kiro your-project/aidlc
   *   cp -R dist/kiro-ide/.kiro/. your-project/.kiro/
   *   cp -R dist/kiro-ide/aidlc/. your-project/aidlc/
   *   cp dist/kiro-ide/AGENTS.md your-project/AGENTS.md
   */
  async installFramework(workspaceUri: vscode.Uri): Promise<void> {
    if (!this.clonedRepoPath) {
      throw new Error('Repository not cloned. Run cloneAidlcRepo() first.');
    }

    const variant = this.activeVariant;
    const distDir = path.join(this.clonedRepoPath, ...variant.distPath.split('/'));
    const workspacePath = workspaceUri.fsPath;

    // Verify the dist dir exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(distDir));
    } catch {
      await Shell.removeDir(this.clonedRepoPath);
      this.clonedRepoPath = null;
      throw new Error(
        `${variant.distPath}/ not found in the cloned repo. The repository structure may have changed.`
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
