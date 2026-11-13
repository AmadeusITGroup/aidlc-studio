import * as vscode from 'vscode';
import { Shell } from './shell';
import { AidlcVariant, describeVariant, getDefaultVariant } from './variants';
import { aidlcBinaryCandidates } from './installCommands';
import { readAidlcInstall } from './aidlcInstallReader';
import { detectCliPresence } from './cliPresence';
import { readRepoAidlcVersion } from './repoVersionReader';
import { RuleLoader } from './ruleLoader';

export interface VersionInfo {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  /** Collapsed display id: 'aws' | 'amadeus'. */
  variantDisplayId: 'aws' | 'amadeus';
  /**
   * True when NO `aidlc` CLI is installed on this machine. In that state there
   * is nothing to update and no latest-version to show — the "Installed CLI"
   * row renders "not installed — install the CLI first" and NO network/feed
   * lookup is attempted (the user's explicit choice).
   */
  cliAbsent?: boolean;
}

/**
 * State of THIS workspace's framework rules relative to the installed CLI —
 * the "is a workspace refresh applicable/needed?" check for the WORKSPACE
 * update operation (distinct from the CLI-update version check above).
 *
 * This deliberately does NOT invent a version number it can't read. A refresh
 * is "applicable" when the workspace is configured AND a CLI is present (so
 * `aidlc config` can run); when BOTH the workspace framework version and the
 * installed CLI version are known AND differ, that delta is surfaced, but a
 * refresh is never gated on a delta — re-running `aidlc config` is always a
 * valid "refresh this workspace against the installed CLI" action.
 */
export interface WorkspaceUpdateState {
  /** True when THIS workspace has the AIDLC framework installed. */
  configured: boolean;
  /** True when an `aidlc` CLI is present on this machine. */
  cliPresent: boolean;
  /** Workspace framework-rules version (.kiro/tools/aidlc-version.ts), or null. */
  workspaceVersion: string | null;
  /** Installed CLI version, or null when it could not be read. */
  cliVersion: string | null;
  /**
   * True only when BOTH versions are known AND differ. Surfaced for display;
   * NOT a precondition for refreshing.
   */
  versionDiffers: boolean;
  /**
   * True when a workspace refresh (`aidlc config`) can run: configured AND a
   * CLI is present. The WORKSPACE row/flow uses this to decide whether to
   * offer the refresh.
   */
  refreshApplicable: boolean;
}

/**
 * Checks the installed AIDLC CLI for updates and handles updating it.
 *
 * FULLY CLI-FIRST. The update is performed BY the `aidlc` CLI (`aidlc update`),
 * so the "is an update available?" answer is sourced FROM the CLI too, via
 * `aidlc update --check`, for BOTH variants. There is no Artifactory-feed
 * scrape and no GitHub-releases lookup — those manual checks were removed.
 *
 *  - CLI PRESENT  → `aidlc update --check` answers update-available / latest;
 *    the current version still comes from on-disk metadata / `aidlc --version`.
 *  - CLI ABSENT   → nothing to update; the check returns a `cliAbsent` marker
 *    and NO latest-version (no network/feed/GitHub lookup is attempted).
 *
 * APPLYING an update is still CLI-first (`aidlc update`), with the legacy
 * repo-clone/dist-copy reinstall kept ONLY as the apply fallback for the
 * custom 'git-clone-copy'/'repo-installer' variants or when a CLI apply fails.
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

  /** The currently-active variant (read-only). */
  get variant(): AidlcVariant {
    return this.activeVariant;
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
   * Force a fresh CLI-update check, ignoring cache.
   *
   * FULLY CLI-FIRST (no feed/GitHub fallback):
   *  - CLI PRESENT → `aidlc update --check` is the SOLE source of the
   *    update-available / latest-version answer. The current version still
   *    comes from on-disk metadata / `aidlc --version`.
   *  - CLI ABSENT  → nothing to update; return a `cliAbsent` VersionInfo with
   *    no latest-version. No network/feed/GitHub lookup is attempted.
   */
  async checkForUpdates(): Promise<VersionInfo> {
    const variant = this.activeVariant;

    const presence = await detectCliPresence().catch(() => null);
    if (!presence?.present) {
      // No CLI on this machine → nothing to update, and (by the user's choice)
      // no latest-version shown. Never attempt a network/feed/GitHub lookup.
      this.outputChannel.appendLine(
        'CLI update check: no `aidlc` CLI installed — nothing to update, no latest shown.'
      );
      const info: VersionInfo = {
        currentVersion: null,
        latestVersion: 'unknown',
        updateAvailable: false,
        variantDisplayId: describeVariant(variant),
        cliAbsent: true,
      };
      this.cachedVersionInfo = info;
      this.lastChecked = Date.now();
      return info;
    }

    // CLI present → the CLI's own update check is the only source of truth.
    return this.checkViaCliUpdateCheck(variant);
  }

  /**
   * CLI-sourced update-availability check: run `<aidlc> update --check` and
   * parse its output TOLERANTLY. This is the ONLY update-availability source
   * when a CLI is present — there is no feed/GitHub fallback.
   *
   * The CURRENT version comes from on-disk metadata / `aidlc --version`; only
   * the LATEST / update-available signal is taken from the CLI. If `aidlc
   * update --check` ERRORS, latest degrades to 'unknown' and updateAvailable to
   * false (we do NOT silently scrape a feed/GitHub — there is none anymore).
   */
  private async checkViaCliUpdateCheck(variant: AidlcVariant): Promise<VersionInfo> {
    const binExpr = await this.resolveAidlcBinaryExpr();

    // Current version first (independent of the --check result).
    const install = await readAidlcInstall().catch(() => null);
    const currentVersion =
      install?.currentVersion ?? (await this.getFullCurrentVersionFromBinary());

    let raw: string | null = null;
    try {
      const res = await Shell.run(`${binExpr} update --check`, { timeout: 30000 });
      raw = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The CLI check itself errored — surface it, treat latest as unknown.
      // Do NOT fall back to a feed/GitHub scrape (removed by design).
      this.outputChannel.appendLine(
        `Update source: CLI \`aidlc update --check\` ERRORED: ${msg}. Latest=unknown (no fallback).`
      );
      const info: VersionInfo = {
        currentVersion,
        latestVersion: 'unknown',
        updateAvailable: false,
        variantDisplayId: describeVariant(variant),
      };
      this.cachedVersionInfo = info;
      this.lastChecked = Date.now();
      return info;
    }

    // ASSUMPTION pending confirmation on a real machine: exact `aidlc update
    // --check` output format (SSO-gated, could not be read). Parsing is
    // isolated in parseCliUpdateCheck below; correct it there once captured.
    this.outputChannel.appendLine(
      `Update source: CLI \`aidlc update --check\` raw output: ${raw.trim() || '(empty)'}`
    );
    const parsed = parseCliUpdateCheck(raw);

    // Decide update-available: prefer the CLI's explicit signal; when the CLI
    // only gave a latest token, compare it against current by PRECEDENCE.
    let updateAvailable: boolean;
    if (parsed.updateAvailable !== null) {
      updateAvailable = parsed.updateAvailable;
    } else if (
      parsed.latestVersion !== null &&
      currentVersion !== null &&
      isComparableVersion(currentVersion)
    ) {
      updateAvailable = compareFullVersion(parsed.latestVersion, currentVersion) > 0;
    } else {
      updateAvailable = false;
    }

    const latestVersion =
      parsed.latestVersion ?? (updateAvailable ? 'available' : currentVersion ?? 'unknown');

    const info: VersionInfo = {
      currentVersion,
      latestVersion,
      updateAvailable,
      variantDisplayId: describeVariant(variant),
    };

    this.cachedVersionInfo = info;
    this.lastChecked = Date.now();

    this.outputChannel.appendLine(
      `CLI update check: current=${currentVersion ?? 'unknown'}, ` +
      `latest=${latestVersion}, update=${updateAvailable}`
    );

    return info;
  }

  /**
   * Resolve the `aidlc` binary to an executable expression: prefer a known
   * absolute install path (quoted) so a stale process PATH doesn't cause a
   * "not found", else bare `aidlc`. Shared by the CLI update-check and the
   * CLI upgrade.
   */
  private async resolveAidlcBinaryExpr(): Promise<string> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    for (const bin of aidlcBinaryCandidates(process.platform, home)) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(bin));
        return `"${bin}"`;
      } catch { /* not here */ }
    }
    return 'aidlc';
  }

  /**
   * CLI-UPDATE availability check. The "is a NEWER `aidlc` CLI available?"
   * question, sourced entirely from `aidlc update --check` (see
   * checkForUpdates). Named so the two user-facing operations read clearly:
   * this one drives the CLI-update flow / "Installed CLI" row.
   */
  async checkCliUpdate(): Promise<VersionInfo> {
    return this.checkForUpdates();
  }

  /**
   * WORKSPACE-UPDATE applicability check. Reports whether re-applying the
   * installed CLI's framework into THIS project (`aidlc config`) can run, and
   * surfaces a version delta ONLY when both sides are honestly known. Unlike
   * checkCliUpdate this never consults a release channel — the "latest" a
   * workspace can be refreshed to is whatever the installed CLI writes, which
   * we can't read without running it, so we do NOT invent a target version.
   *
   * Never throws; a probe failure degrades the relevant field to null/false.
   */
  async checkWorkspaceState(): Promise<WorkspaceUpdateState> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

    const configured = workspaceUri ? await this.isWorkspaceConfigured(workspaceUri) : false;
    const workspaceVersion = workspaceUri ? await readRepoAidlcVersion(workspaceUri) : null;

    const presence = await detectCliPresence().catch(() => null);
    const cliPresent = presence?.present ?? false;
    const cliVersion = presence?.version ?? null;

    const versionDiffers =
      workspaceVersion !== null && cliVersion !== null && workspaceVersion !== cliVersion;

    const refreshApplicable = configured && cliPresent;

    this.outputChannel.appendLine(
      `Workspace state: configured=${configured}, cliPresent=${cliPresent}, ` +
      `workspaceVersion=${workspaceVersion ?? 'unknown'}, cliVersion=${cliVersion ?? 'unknown'}, ` +
      `refreshApplicable=${refreshApplicable}`
    );

    return { configured, cliPresent, workspaceVersion, cliVersion, versionDiffers, refreshApplicable };
  }

  /**
   * Workspace-configured probe used by checkWorkspaceState. Mirrors
   * RuleLoader.isWorkspaceConfigured (the `/aidlc` skill + the workspace shell
   * memory dir) so the version surface can answer "is this project set up?"
   * without needing a RuleLoader for the read-only check. Never throws.
   */
  private async isWorkspaceConfigured(workspaceUri: vscode.Uri): Promise<boolean> {
    const skillUri = vscode.Uri.joinPath(workspaceUri, '.kiro', 'skills', 'aidlc', 'SKILL.md');
    const shellUri = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'memory');
    try {
      await vscode.workspace.fs.stat(skillUri);
      await vscode.workspace.fs.stat(shellUri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update AIDLC to the latest release — CLI-FIRST (FUSED legacy primitive:
   * CLI upgrade + workspace refresh in one call).
   *
   * When the `aidlc` CLI is present, `aidlc update` upgrades the CLI, then
   * `aidlc config` refreshes THIS workspace's rules. If the CLI apply FAILS,
   * fall back LOUDLY to the repo-clone/dist-copy reinstall (which also stays
   * the primary APPLY path for the legacy/custom 'git-clone-copy' variant).
   *
   * The two user-facing operations prefer the SPLIT primitives:
   * updateCliBinary() for the CLI-only upgrade, and
   * RuleLoader.configureWorkspaceForVariant() for the workspace refresh. This
   * stays so the fused behavior remains available and tested.
   */
  async pullLatest(): Promise<boolean> {
    // The explicit custom/legacy clone-copy fork always reinstalls from a
    // clone — there is no `aidlc update` for it.
    const method = this.activeVariant.installMethod;
    if (method === 'git-clone-copy' || method === 'repo-installer') {
      return this.updateViaRepoInstaller();
    }

    // CLI-first for AWS ('native-installer') and Amadeus ('amadeus-cli'): if a
    // CLI is present, `aidlc update` + `aidlc config`. On failure, fall back to
    // the clone/dist path.
    const presence = await detectCliPresence();
    if (presence.present) {
      try {
        return await this.updateViaNativeCli(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // LOUD fallback: CLI-first was attempted; say exactly why it's falling
        // back and that it's now trying the legacy clone/dist path.
        this.outputChannel.appendLine(
          `[AIDLC fallback] CLI-first update was attempted but FAILED: ${msg}. ` +
          `Falling back to the legacy repo-clone/dist-copy update path.`
        );
        return this.updateViaRepoInstaller();
      }
    }

    // No CLI present at all: nothing to `aidlc update`. Reinstall from the repo.
    this.outputChannel.appendLine(
      '[AIDLC fallback] CLI-first update was attempted but NO `aidlc` CLI is present on this machine. ' +
      'Falling back to the legacy repo-clone/dist-copy update path.'
    );
    return this.updateViaRepoInstaller();
  }

  /**
   * UPDATE CLI primitive (split operation 1): upgrade ONLY the machine-wide
   * `aidlc` binary via `aidlc update`. Does NOT touch THIS workspace's rules —
   * that is the separate WORKSPACE update operation
   * (RuleLoader.configureWorkspaceForVariant). This is the CLI-upgrade path the
   * "Installed CLI" row drives.
   *
   * CLI-first for AWS ('native-installer') and Amadeus ('amadeus-cli'): if a
   * CLI is present, run `aidlc update`. For the legacy/custom
   * 'git-clone-copy'/'repo-installer' variants (which have no `aidlc update`),
   * or when a CLI-first attempt fails, FALL BACK LOUDLY to the repo-clone/
   * dist-copy reinstall path.
   */
  async updateCliBinary(): Promise<boolean> {
    const method = this.activeVariant.installMethod;
    if (method === 'git-clone-copy' || method === 'repo-installer') {
      this.outputChannel.appendLine(
        `[AIDLC fallback] Variant "${this.activeVariant.label}" (${method}) has no ` +
        '`aidlc update` command; using the repo-clone/dist-copy reinstall path for the CLI update.'
      );
      return this.updateViaRepoInstaller();
    }

    const presence = await detectCliPresence();
    if (presence.present) {
      try {
        return await this.updateViaNativeCli(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.outputChannel.appendLine(
          `[AIDLC fallback] CLI-first \`aidlc update\` was attempted but FAILED: ${msg}. ` +
          `Falling back to the legacy repo-clone/dist-copy reinstall path.`
        );
        return this.updateViaRepoInstaller();
      }
    }

    this.outputChannel.appendLine(
      '[AIDLC fallback] CLI update was requested but NO `aidlc` CLI is present on this machine. ' +
      'Falling back to the legacy repo-clone/dist-copy reinstall path.'
    );
    return this.updateViaRepoInstaller();
  }

  /**
   * Run `aidlc update` to upgrade the CLI binary. When `refreshWorkspace` is
   * true (the fused pullLatest path), also re-run `aidlc config` to refresh
   * THIS workspace against the just-upgraded CLI. When false (the split
   * updateCliBinary path), the workspace refresh is left to the separate
   * WORKSPACE update operation.
   */
  private async updateViaNativeCli(refreshWorkspace: boolean): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating AIDLC CLI...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Running aidlc update...', increment: 20 });

        const binExpr = await this.resolveAidlcBinaryExpr();

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

        // FUSED path only: refresh THIS workspace's rules against the
        // just-upgraded CLI via `aidlc config`. Best-effort: a refresh failure
        // must not undo a successful CLI upgrade, so it's logged, not thrown.
        // The SPLIT CLI-update path skips this — the WORKSPACE update operation
        // owns the refresh.
        if (refreshWorkspace && this.ruleLoader) {
          progress.report({ message: 'Refreshing workspace (aidlc config)...', increment: 30 });
          try {
            await this.ruleLoader.configureWorkspaceForVariant(
              workspaceFolder.uri,
              this.activeVariant
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.outputChannel.appendLine(
              `Workspace refresh (aidlc config) reported: ${msg} — CLI upgrade still succeeded.`
            );
          }
        }

        progress.report({ message: 'Verifying...', increment: 30 });
        this.cachedVersionInfo = null;
        await this.checkForUpdates();

        progress.report({ message: 'Done.', increment: 20 });
        this.outputChannel.appendLine('Update completed successfully.');
        return true;
      }
    );
  }

  // --- Private: repo-based (Amadeus / custom) APPLY fallback ---

  /**
   * Apply an update by reusing the SAME reinstall path setup uses. Delegates to
   * RuleLoader.installViaRepoInstaller(), which clones the configured repo
   * (throwing the typed RepoAccessError on auth/not-found), runs the official
   * installer script, and falls back to the legacy dist-copy only when that
   * script is absent. This is the APPLY fallback for the custom
   * 'git-clone-copy'/'repo-installer' variants and when a CLI apply fails — it
   * is NOT a version-CHECK path.
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
          `[AIDLC legacy path] Reinstalling ${this.activeVariant.label} via repo-clone/dist-copy ` +
          `from ${this.activeVariant.repoUrl} (${this.activeVariant.branch}). ` +
          'An installed `aidlc` CLI would use the faster CLI-first update instead.'
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

  // --- Private: current-version detection (unchanged source) ---

  /**
   * Ask the installed aidlc binary for its FULL version string. Captures the
   * whole token after `aidlc `, including any pre-release tail (e.g.
   * `2.10.0-1a.1.1.0`). Tries known absolute paths, then bare PATH. This is the
   * CURRENT-version source (used alongside on-disk metadata); it is NOT a
   * latest-version lookup.
   */
  private async getFullCurrentVersionFromBinary(): Promise<string | null> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const candidates = aidlcBinaryCandidates(process.platform, home);

    const parseFull = (stdout: string): string | null => {
      // Capture the numeric semver plus any contiguous pre-release/build tail.
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
}

/**
 * Result of tolerantly parsing `aidlc update --check` stdout.
 *  - updateAvailable: true/false when an explicit signal was found, else null.
 *  - latestVersion:   a semver token (incl. pre-release tail) when present.
 *  - raw:             the raw output, for diagnostics.
 */
export interface CliUpdateCheckResult {
  updateAvailable: boolean | null;
  latestVersion: string | null;
  raw: string;
}

/**
 * Tolerant parser for `aidlc update --check` output.
 *
 * ASSUMPTION pending confirmation on a real machine: the exact `aidlc update
 * --check` output format is NOT known (the Amadeus CLI is SSO-gated and its
 * output could not be read). This parser is therefore deliberately permissive
 * and signal-based rather than format-locked; correct it here once a real
 * machine's output is captured. It looks for:
 *   - an explicit "up to date / no update / latest" signal  → updateAvailable=false
 *   - an explicit "update available / newer / can be updated" signal
 *       → updateAvailable=true
 *   - any semver token (with optional pre-release/build tail) → latestVersion
 * When neither signal nor a version token is present, returns all-null (the
 * caller then reports latest=unknown without a false prompt).
 */
export function parseCliUpdateCheck(raw: string): CliUpdateCheckResult {
  const text = raw ?? '';
  const lower = text.toLowerCase();

  // Explicit "no update" phrasings first (so "no update available" isn't read
  // as "update available").
  const upToDate =
    /\bup[- ]to[- ]date\b/.test(lower) ||
    /\bno\s+(?:updates?|newer\s+version)\b/.test(lower) ||
    /\balready\s+(?:on\s+)?(?:the\s+)?latest\b/.test(lower) ||
    /\byou(?:'re| are)\s+on\s+the\s+latest\b/.test(lower);

  // "update available" phrasings (only counted when not already up-to-date).
  const updateAvail =
    /\bupdate\s+available\b/.test(lower) ||
    /\bnewer\s+version\s+(?:is\s+)?available\b/.test(lower) ||
    /\ban?\s+update\s+(?:is\s+)?available\b/.test(lower) ||
    /\bcan\s+be\s+updated\b/.test(lower) ||
    /\bupdating\s+from\b.*\bto\b/.test(lower);

  // Parse a semver token (numeric core + optional pre-release/build tail). When
  // the output expresses an upgrade (`<from> -> <to>` or `from X to Y`), the
  // LATEST is the TARGET (right-hand) version, so prefer a token following an
  // arrow / "to". Otherwise take the first semver token seen.
  const semver = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;
  const arrowMatch = text.match(
    new RegExp(`(?:->|→|\\bto\\b)\\s*v?(${semver.source})`, 'i')
  );
  const firstMatch = text.match(new RegExp(`(${semver.source})`));
  const latestVersion = arrowMatch ? arrowMatch[1] : firstMatch ? firstMatch[1] : null;

  let updateAvailable: boolean | null = null;
  if (upToDate) {
    updateAvailable = false;
  } else if (updateAvail) {
    updateAvailable = true;
  }

  return { updateAvailable, latestVersion, raw: text };
}

/**
 * True when a version string contains a parseable numeric semver core
 * (`<major>.<minor>.<patch>`) that compareFullVersion can order. Used to gate
 * the "update available" decision when the CLI gave a latest token but no
 * explicit signal: an unparseable current version must NOT produce a false
 * prompt.
 */
function isComparableVersion(v: string): boolean {
  return /\d+\.\d+\.\d+/.test(v);
}

/**
 * Compare two FULL version strings (numeric semver plus any pre-release tail).
 * The numeric semver is compared first; ties fall back to a
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
