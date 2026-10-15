import * as vscode from 'vscode';
import * as path from 'path';
import { Shell } from './shell';
import { AidlcVariant, getDefaultVariant } from './variants';
import { aidlcBinaryCandidates } from './installCommands';

export interface VersionInfo {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
}

/**
 * Checks the installed AIDLC variant for updates and handles updating it.
 *
 * The active variant must be passed so version checks and updates target the
 * right repo/channel:
 *  - 'native-installer' variants (AWS)  → use `aidlc update` CLI command
 *  - 'repo-installer' / 'git-clone-copy' variants (Amadeus / custom)
 *      → git-clone the configured repo and copy files
 */
export class UpdateChecker {
  private cachedVersionInfo: VersionInfo | null = null;
  private lastChecked: number = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    /** The currently-installed variant. Defaults to the default variant when
     *  not yet set (before a workspace is configured). */
    private activeVariant: AidlcVariant = getDefaultVariant()
  ) { }

  /** Update the active variant when the user installs or switches. */
  setVariant(variant: AidlcVariant): void {
    this.activeVariant = variant;
    this.cachedVersionInfo = null; // stale for a different variant
  }

  /**
   * Get version info (cached if recent).
   */
  async getVersionInfo(): Promise<VersionInfo | null> {
    const now = Date.now();
    if (this.cachedVersionInfo && (now - this.lastChecked) < this.CACHE_TTL_MS) {
      return this.cachedVersionInfo;
    }

    try {
      const info = await this.checkForUpdates();
      this.cachedVersionInfo = info;
      this.lastChecked = now;
      return info;
    } catch {
      return this.cachedVersionInfo;
    }
  }

  /**
   * Force a fresh check, ignoring cache.
   */
  async checkForUpdates(): Promise<VersionInfo> {
    const variant = this.activeVariant;

    // For native-installer (AWS): ask the binary itself for its version and
    // compare against the GitHub releases API.
    if (variant.installMethod === 'native-installer') {
      return this.checkNativeInstallerVersion(variant);
    }

    // For repo-based variants: compare the local version file against the
    // latest GitHub/git tag on the configured repo.
    const config = vscode.workspace.getConfiguration('amadeus-aidlc');
    const repoUrl = config.get<string>('updateRepoUrl', '').trim() || variant.repoUrl;

    this.outputChannel.appendLine(`Checking for updates from: ${repoUrl}`);

    const currentVersion = await this.getCurrentVersionFromFile();
    const release = await this.getLatestRelease(repoUrl);
    const latestVersion = release?.version ?? null;

    const updateAvailable = latestVersion !== null
      && currentVersion !== null
      && latestVersion !== currentVersion;

    const info: VersionInfo = {
      currentVersion,
      latestVersion: latestVersion ?? 'unknown',
      updateAvailable,
      releaseUrl: release?.url ?? `${repoUrl}/releases/latest`,
      releaseName: release?.name,
      releaseNotes: release?.notes,
      publishedAt: release?.publishedAt,
    };

    this.cachedVersionInfo = info;
    this.lastChecked = Date.now();

    this.outputChannel.appendLine(
      `Version check: current=${currentVersion ?? 'unknown'}, latest=${latestVersion ?? 'unknown'}, update=${updateAvailable}`
    );

    return info;
  }

  /**
   * Update AIDLC to the latest release.
   * - Native-installer variants (AWS): delegates to `aidlc update`.
   * - Repo-based variants: git-clones and copies files.
   */
  async pullLatest(): Promise<boolean> {
    if (this.activeVariant.installMethod === 'native-installer') {
      return this.updateViaNativeCli();
    }
    return this.updateViaGitClone();
  }

  // --- Private: native-installer (AWS) path ---

  private async checkNativeInstallerVersion(variant: AidlcVariant): Promise<VersionInfo> {
    const repoUrl = variant.repoUrl;
    this.outputChannel.appendLine(`Checking for updates from: ${repoUrl}`);

    // Current version: ask the installed binary
    const currentVersion = await this.getCurrentVersionFromBinary();

    // Latest version: GitHub releases API
    const release = await this.getLatestRelease(repoUrl);
    const latestVersion = release?.version ?? null;

    const updateAvailable = latestVersion !== null
      && currentVersion !== null
      && latestVersion !== currentVersion;

    const info: VersionInfo = {
      currentVersion,
      latestVersion: latestVersion ?? 'unknown',
      updateAvailable,
      releaseUrl: release?.url ?? `${repoUrl}/releases/latest`,
      releaseName: release?.name,
      releaseNotes: release?.notes,
      publishedAt: release?.publishedAt,
    };

    this.cachedVersionInfo = info;
    this.lastChecked = Date.now();

    this.outputChannel.appendLine(
      `Version check: current=${currentVersion ?? 'unknown'}, latest=${latestVersion ?? 'unknown'}, update=${updateAvailable}`
    );

    return info;
  }

  private async updateViaNativeCli(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating AIDLC...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Running aidlc update...', increment: 20 });

        // Resolve the binary — prefer absolute path so a stale process PATH
        // doesn't cause a "not found" failure right after install.
        const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
        const candidates = aidlcBinaryCandidates(process.platform, home);
        let binExpr = 'aidlc';
        for (const bin of candidates) {
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(bin));
            binExpr = `"${bin}"`;
            break;
          } catch { /* not here */ }
        }

        this.outputChannel.appendLine(`Running: ${binExpr} update`);
        try {
          await Shell.runStreaming(`${binExpr} update`, this.outputChannel, {
            cwd: workspaceFolder.uri.fsPath,
            timeout: 180000,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`aidlc update failed: ${msg}`);
        }

        progress.report({ message: 'Verifying...', increment: 60 });
        this.cachedVersionInfo = null;
        await this.checkForUpdates();

        progress.report({ message: 'Done.', increment: 20 });
        this.outputChannel.appendLine('Update completed successfully.');
        return true;
      }
    );
  }

  // --- Private: repo-based (Amadeus / custom) path ---

  private async updateViaGitClone(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }

    const variant = this.activeVariant;
    const config = vscode.workspace.getConfiguration('amadeus-aidlc');
    const repoUrl = config.get<string>('updateRepoUrl', '').trim() || variant.repoUrl;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating AIDLC...',
        cancellable: false,
      },
      async (progress) => {
        const branch = variant.branch;
        const tempDir = path.join(workspaceFolder.uri.fsPath, '.aidlc-update-tmp');

        try {
          await Shell.removeDir(tempDir);

          progress.report({ message: 'Downloading latest version...', increment: 30 });
          this.outputChannel.appendLine(`Cloning ${repoUrl} (${branch}) to ${tempDir}`);

          await Shell.run(`git clone --depth 1 --branch ${branch} "${repoUrl}" "${tempDir}"`, {
            cwd: workspaceFolder.uri.fsPath,
            timeout: 120000,
          });

          progress.report({ message: 'Installing updated rules...', increment: 30 });

          const distDir = path.join(tempDir, ...variant.distPath.split('/'));
          const kiroDir = path.join(workspaceFolder.uri.fsPath, '.kiro');
          const aidlcDir = path.join(workspaceFolder.uri.fsPath, 'aidlc');

          await Shell.copyDirContents(path.join(distDir, '.kiro'), kiroDir);
          await Shell.copyDirContents(path.join(distDir, 'aidlc'), aidlcDir);

          progress.report({ message: 'Cleaning up...', increment: 20 });
          await Shell.removeDir(tempDir);

          progress.report({ message: 'Verifying...', increment: 20 });
          this.cachedVersionInfo = null;
          await this.checkForUpdates();

          this.outputChannel.appendLine('Update completed successfully.');
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.outputChannel.appendLine(`Update failed: ${message}`);
          await Shell.removeDir(tempDir);
          throw new Error(`Update failed: ${message}`);
        }
      }
    );
  }

  // --- Private: version detection ---

  /** Ask the installed aidlc binary for its version (native-installer path). */
  private async getCurrentVersionFromBinary(): Promise<string | null> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const candidates = aidlcBinaryCandidates(process.platform, home);

    for (const bin of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(bin));
        const { stdout } = await Shell.run(`"${bin}" --version`, { timeout: 10000 });
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        if (match) { return match[1]; }
      } catch { /* try next */ }
    }

    // Fallback: bare PATH
    try {
      const { stdout } = await Shell.run('aidlc --version', { timeout: 10000 });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      if (match) { return match[1]; }
    } catch { /* not on PATH */ }

    return null;
  }

  /** Read version from the workspace's version file (repo-based variants). */
  private async getCurrentVersionFromFile(): Promise<string | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return null; }

    const versionFilePaths = [
      path.join(workspaceFolder.uri.fsPath, '.kiro', 'tools', 'data', 'version.json'),
      path.join(workspaceFolder.uri.fsPath, '.kiro', 'VERSION'),
      path.join(workspaceFolder.uri.fsPath, 'aidlc', 'VERSION'),
    ];

    for (const versionPath of versionFilePaths) {
      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(versionPath));
        const text = Buffer.from(content).toString('utf-8').trim();
        try {
          const parsed = JSON.parse(text);
          if (parsed.version) { return parsed.version; }
        } catch {
          if (text.match(/^\d+\.\d+\.\d+/)) { return text.split('\n')[0].trim(); }
        }
      } catch { /* file doesn't exist */ }
    }

    // Fallback: bun tool
    try {
      const workspacePath = workspaceFolder.uri.fsPath;
      const toolPath = path.join(workspacePath, '.kiro', 'tools', 'aidlc-utility.ts');
      const { stdout } = await Shell.run(`bun "${toolPath}" version`, {
        cwd: workspacePath,
        timeout: 10000,
      });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      if (match) { return match[1]; }
    } catch { /* tool not available */ }

    return null;
  }

  private async getLatestRelease(repoUrl: string): Promise<{
    version: string;
    name?: string;
    notes?: string;
    url?: string;
    publishedAt?: string;
  } | null> {
    try {
      // Try GitHub API first
      const apiUrl = this.getGitHubApiUrl(repoUrl);
      if (apiUrl) {
        const { stdout } = await Shell.run(
          `curl -s -H "Accept: application/vnd.github.v3+json" "${apiUrl}/releases/latest"`,
          { timeout: 15000 }
        );
        try {
          const release = JSON.parse(stdout);
          if (release.tag_name) {
            return {
              version: release.tag_name.replace(/^v/, ''),
              name: release.name ?? release.tag_name,
              notes: typeof release.body === 'string' ? release.body : undefined,
              url: release.html_url,
              publishedAt: release.published_at,
            };
          }
        } catch { /* not JSON or no tag_name */ }
      }

      // Fallback: git ls-remote
      const { stdout } = await Shell.run(
        `git ls-remote --tags --sort=-v:refname "${repoUrl}" "v*"`,
        { timeout: 15000 }
      );
      const firstLine = stdout.split('\n')[0];
      const tagMatch = firstLine?.match(/refs\/tags\/v?([\d.]+)/);
      if (tagMatch) { return { version: tagMatch[1] }; }
    } catch { /* network unavailable or auth needed */ }

    return null;
  }

  private getGitHubApiUrl(repoUrl: string): string | null {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) {
      return `https://api.github.com/repos/${match[1]}/${match[2]}`;
    }
    return null;
  }
}
