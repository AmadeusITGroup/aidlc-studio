import * as vscode from 'vscode';
import { Shell } from './shell';
import { AidlcVariant, describeVariant, getDefaultVariant } from './variants';
import { aidlcBinaryCandidates } from './installCommands';
import { readAidlcInstall } from './aidlcInstallReader';
import { isPreviewVersion } from './variantDetector';
import { RuleLoader } from './ruleLoader';

export interface VersionInfo {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  /** Release channel of the active variant. */
  channel: 'release' | 'preview';
  /** Collapsed display id: 'aws' | 'amadeus' | 'amadeus-preview'. */
  variantDisplayId: 'aws' | 'amadeus' | 'amadeus-preview';
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
 *      → delegate to the SAME reinstall path setup uses
 *        (RuleLoader.installViaRepoInstaller): clone the repo, run the
 *        official installer script, with a dist-copy fallback.
 */
export class UpdateChecker {
  private cachedVersionInfo: VersionInfo | null = null;
  private lastChecked: number = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    /** The currently-installed variant. Defaults to the default variant when
     *  not yet set (before a workspace is configured). */
    private activeVariant: AidlcVariant = getDefaultVariant(),
    /**
     * Shared RuleLoader used to apply repo-based updates. The repo update path
     * reuses the installer this loader runs for setup/reinstall, so an update
     * is "basically a reinstall". Optional only so the version-check surface
     * can be constructed without it; pullLatest() for a repo-based variant
     * requires it.
     */
    private readonly ruleLoader?: RuleLoader
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

    // For repo-based variants (Amadeus / custom): resolve the latest ONLY from
    // the Artifactory feed, filtered to the active channel. Never fall back to
    // a GitHub release or `git ls-remote`.
    return this.checkAmadeusArtifactoryVersion(variant);
  }

  // --- Private: Amadeus Artifactory path ---

  /**
   * Resolve the Amadeus variant's current + latest version. Current version
   * comes from the on-disk install metadata (`amadeusVersion`, full string
   * incl. the preview suffix), falling back to a FULL-string `aidlc --version`
   * parse. Latest comes ONLY from the Artifactory feed, filtered to the active
   * channel; any failure degrades `latest` to 'unknown'. This path NEVER
   * consults GitHub releases or `git ls-remote`.
   */
  private async checkAmadeusArtifactoryVersion(variant: AidlcVariant): Promise<VersionInfo> {
    const channel = variant.channel;
    const displayId = describeVariant(variant);

    // Current version: prefer on-disk metadata, else the full --version token.
    const install = await readAidlcInstall().catch(() => null);
    let currentVersion = install?.currentVersion ?? null;
    if (!currentVersion) {
      currentVersion = await this.getFullCurrentVersionFromBinary();
    }

    // Feed base: on-disk settings `release-base-url` preferred over the
    // hardcoded constant.
    const feedBase = install?.feedUrl ?? variant.artifactory?.versionFeedUrl ?? null;

    let latestVersion = 'unknown';
    if (feedBase) {
      latestVersion = await this.resolveLatestFromFeed(feedBase, channel);
    } else {
      this.outputChannel.appendLine('No Artifactory feed base available; latest=unknown.');
    }

    const updateAvailable =
      latestVersion !== 'unknown' && currentVersion !== null && latestVersion !== currentVersion;

    const info: VersionInfo = {
      currentVersion,
      latestVersion,
      updateAvailable,
      channel,
      variantDisplayId: displayId,
      releaseUrl: feedBase ?? undefined,
    };

    this.cachedVersionInfo = info;
    this.lastChecked = Date.now();

    this.outputChannel.appendLine(
      `Version check (${displayId}): current=${currentVersion ?? 'unknown'}, latest=${latestVersion}, update=${updateAvailable}`
    );

    return info;
  }

  /**
   * Fetch the Artifactory version feed and pick the highest version on the
   * active channel. Returns 'unknown' on ANY failure (network error,
   * unparseable/HTML response, no matching tokens).
   */
  private async resolveLatestFromFeed(feedBase: string, channel: 'release' | 'preview'): Promise<string> {
    try {
      const { stdout } = await Shell.run(`curl -sSL "${feedBase}"`, { timeout: 15000 });
      const tokens = stdout
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => /^\d+\.\d+\.\d+/.test(t));

      const matching = tokens.filter((t) =>
        channel === 'preview' ? isPreviewVersion(t) : !isPreviewVersion(t)
      );
      if (matching.length === 0) { return 'unknown'; }

      return [...matching].sort((a, b) => compareFullVersion(b, a))[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.outputChannel.appendLine(`Artifactory feed lookup failed: ${msg}`);
      return 'unknown';
    }
  }

  /**
   * Update AIDLC to the latest release.
   * - Native-installer variants (AWS): delegates to `aidlc update`.
   * - Repo-based variants: delegates to the reinstall path
   *   (RuleLoader.installViaRepoInstaller) — "update is basically a reinstall".
   */
  async pullLatest(): Promise<boolean> {
    if (this.activeVariant.installMethod === 'native-installer') {
      return this.updateViaNativeCli();
    }
    return this.updateViaRepoInstaller();
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
      channel: variant.channel,
      variantDisplayId: describeVariant(variant),
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

  /**
   * Update a repo-based variant by reusing the SAME reinstall path setup uses.
   * Delegates to RuleLoader.installViaRepoInstaller(), which clones the
   * configured repo (throwing the typed RepoAccessError on auth/not-found),
   * runs the official installer script, and falls back to the legacy dist-copy
   * only when that script is absent. This replaces the former blind dist-copy
   * that assumed a `dist/<harness>/.kiro` layout the Amadeus repo does not have.
   */
  private async updateViaRepoInstaller(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }
    if (!this.ruleLoader) {
      throw new Error('Repo-based update requires a RuleLoader; none was provided.');
    }

    // Keep the loader's variant in lockstep with ours so it clones the correct
    // repo/branch/harness for whichever variant is active.
    this.ruleLoader.setVariant(this.activeVariant);

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating AIDLC...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Reinstalling latest version...', increment: 40 });
        this.outputChannel.appendLine(
          `Reinstalling ${this.activeVariant.label} from ${this.activeVariant.repoUrl} ` +
          `(${this.activeVariant.branch})`
        );

        // installViaRepoInstaller clones, runs the official installer (with a
        // dist-copy fallback), and cleans up its own temp clone. Any
        // RepoAccessError propagates so the caller can show the friendly
        // "you don't have access" message.
        await this.ruleLoader!.installViaRepoInstaller(workspaceFolder.uri);

        progress.report({ message: 'Verifying...', increment: 60 });
        this.cachedVersionInfo = null;
        await this.checkForUpdates();

        this.outputChannel.appendLine('Update completed successfully.');
        return true;
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

  /**
   * Ask the installed aidlc binary for its FULL version string (Amadeus path).
   * Unlike getCurrentVersionFromBinary (numeric semver only), this captures the
   * whole token after `aidlc `, including any `-preview...` / pre-release tail
   * (e.g. `2.10.0-1a.1.1.0-preview.3`). Tries known absolute paths, then bare
   * PATH.
   */
  private async getFullCurrentVersionFromBinary(): Promise<string | null> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const candidates = aidlcBinaryCandidates(process.platform, home);

    const parseFull = (stdout: string): string | null => {
      // Capture the numeric semver plus any contiguous pre-release/preview tail.
      const match = stdout.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
      return match ? match[1] : null;
    };

    for (const bin of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(bin));
        const { stdout } = await Shell.run(`"${bin}" --version`, { timeout: 10000 });
        const v = parseFull(stdout);
        if (v) { return v; }
      } catch { /* try next */ }
    }

    try {
      const { stdout } = await Shell.run('aidlc --version', { timeout: 10000 });
      const v = parseFull(stdout);
      if (v) { return v; }
    } catch { /* not on PATH */ }

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

/**
 * Compare two FULL version strings (numeric semver plus any pre-release /
 * preview tail). The numeric semver is compared first; ties fall back to a
 * lexicographic compare of the pre-release tail (a build WITH a tail sorts
 * below the same numeric version without one, matching semver precedence).
 */
function compareFullVersion(a: string, b: string): number {
  const semver = (v: string): number[] => {
    const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const tail = (v: string): string => {
    const m = v.match(/\d+\.\d+\.\d+(?:[-+]([0-9A-Za-z.-]+))?/);
    return m?.[1] ?? '';
  };

  const pa = semver(a);
  const pb = semver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) { return pa[i] - pb[i]; }
  }

  const ta = tail(a);
  const tb = tail(b);
  // No tail outranks a tail at the same numeric version (semver precedence).
  if (ta === '' && tb !== '') { return 1; }
  if (ta !== '' && tb === '') { return -1; }
  return ta.localeCompare(tb);
}
