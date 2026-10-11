import * as vscode from 'vscode';
import * as path from 'path';
import { Shell } from './shell';
import { getDefaultVariant } from './variants';

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
 * Checks the Amadeus AIDLC repo for updates and handles pulling the latest.
 */
export class UpdateChecker {
  private cachedVersionInfo: VersionInfo | null = null;
  private lastChecked: number = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

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
    const config = vscode.workspace.getConfiguration('amadeus-aidlc');
    const repoUrl = config.get<string>('updateRepoUrl', '') || getDefaultVariant().repoUrl;

    this.outputChannel.appendLine(`Checking for updates from: ${repoUrl}`);

    // Get current installed version
    const currentVersion = await this.getCurrentVersion();

    // Get latest version + release details from repo
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
   * Pull the latest rules from the configured repo.
   */
  async pullLatest(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }

    const config = vscode.workspace.getConfiguration('amadeus-aidlc');
    const variant = getDefaultVariant();
    const repoUrl = config.get<string>('updateRepoUrl', '') || variant.repoUrl;

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
          // Always clean temp first
          await Shell.removeDir(tempDir);

          // Clone latest to temp
          progress.report({ message: 'Downloading latest version...', increment: 30 });
          this.outputChannel.appendLine(`Cloning ${repoUrl} (${branch}) to ${tempDir}`);

          await Shell.run(`git clone --depth 1 --branch ${branch} "${repoUrl}" "${tempDir}"`, {
            cwd: workspaceFolder.uri.fsPath,
            timeout: 120000,
          });

          // Copy updated files
          progress.report({ message: 'Installing updated rules...', increment: 30 });

          const distDir = path.join(tempDir, ...variant.distPath.split('/'));
          const kiroDir = path.join(workspaceFolder.uri.fsPath, '.kiro');
          const aidlcDir = path.join(workspaceFolder.uri.fsPath, 'aidlc');

          await Shell.copyDirContents(path.join(distDir, '.kiro'), kiroDir);
          await Shell.copyDirContents(path.join(distDir, 'aidlc'), aidlcDir);

          // Cleanup temp
          progress.report({ message: 'Cleaning up...', increment: 20 });
          await Shell.removeDir(tempDir);

          // Re-check version
          progress.report({ message: 'Verifying...', increment: 20 });
          this.cachedVersionInfo = null; // Force fresh check
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

  // --- Private ---

  private async getCurrentVersion(): Promise<string | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    // Try reading version from a known version file or package.json in .kiro/tools
    const versionFilePaths = [
      path.join(workspaceFolder.uri.fsPath, '.kiro', 'tools', 'data', 'version.json'),
      path.join(workspaceFolder.uri.fsPath, '.kiro', 'VERSION'),
      path.join(workspaceFolder.uri.fsPath, 'aidlc', 'VERSION'),
    ];

    for (const versionPath of versionFilePaths) {
      try {
        const uri = vscode.Uri.file(versionPath);
        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString('utf-8').trim();

        // Try parsing as JSON
        try {
          const parsed = JSON.parse(text);
          if (parsed.version) {
            return parsed.version;
          }
        } catch {
          // Plain text version
          if (text.match(/^\d+\.\d+\.\d+/)) {
            return text.split('\n')[0].trim();
          }
        }
      } catch {
        // File doesn't exist, try next
      }
    }

    // Fallback: try bun tool to get version
    try {
      const toolPath = path.join(workspaceFolder.uri.fsPath, '.kiro', 'tools', 'aidlc-utility.ts');
      const { stdout } = await Shell.run(`bun "${toolPath}" version`, {
        cwd: workspaceFolder.uri.fsPath,
        timeout: 10000,
      });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Tool not available
    }

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
        } catch {
          // Not JSON or no tag_name
        }
      }

      // Fallback: git ls-remote to check latest tag
      const { stdout } = await Shell.run(
        `git ls-remote --tags --sort=-v:refname "${repoUrl}" "v*"`,
        { timeout: 15000 }
      );
      const firstLine = stdout.split('\n')[0];
      const tagMatch = firstLine?.match(/refs\/tags\/v?([\d.]+)/);
      if (tagMatch) {
        return { version: tagMatch[1] };
      }
    } catch {
      // Network not available or auth needed
    }

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
