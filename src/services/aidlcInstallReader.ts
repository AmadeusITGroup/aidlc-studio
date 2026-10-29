import * as vscode from 'vscode';
import * as path from 'path';
import { isPreviewVersion } from './variantDetector';

/**
 * Reads the authoritative AI-DLC install metadata the installer writes on
 * disk, under the user's install dir (`%LOCALAPPDATA%\aidlc` on Windows,
 * `~/.aidlc` on Unix). This is more reliable than parsing `aidlc --version`
 * stdout and keeps working even when the binary can't be executed (e.g. in the
 * F5 Extension Development Host where `aidlc` isn't on PATH).
 *
 * READ-ONLY: this only READS the installer's own files (install metadata,
 * NOT AI-DLC framework/workspace state) for detection. It never writes.
 *
 * CONFIRMED on a real Windows machine with a manual Amadeus PREVIEW install:
 *  - `%LOCALAPPDATA%\aidlc\aidlc.settings.json` carries the authoritative
 *    Artifactory `release-base-url` (ending in `/cli`).
 *  - `%LOCALAPPDATA%\aidlc\versions\<semver>\version.json` carries the full
 *    `amadeusVersion` (e.g. `2.10.0-1a.1.1.0-preview.3`). The presence of
 *    `amadeusVersion` marks the install as AMADEUS; a `-preview` token in it
 *    marks the PREVIEW channel.
 *
 * No `vscode` import is needed by the pure helpers below (they take raw file
 * text and a directory listing), so they stay unit-testable in isolation. The
 * single vscode-fs reader (`readAidlcInstall`) wires them to the filesystem.
 */

/** Settings file name under the install root. */
export const AIDLC_SETTINGS_FILE = 'aidlc.settings.json';
/** Per-version metadata directory under the install root. */
export const AIDLC_VERSIONS_DIR = 'versions';
/** Per-version metadata file name. */
export const AIDLC_VERSION_FILE = 'version.json';
/**
 * Authoritative pointer file at the install root naming the currently-active
 * version FOLDER (plain text, e.g. `2.10.0`). The installer writes this when it
 * switches the active install, so it — not the highest semver on disk — is the
 * source of truth for which version.json to read. Stale higher-version folders
 * from a previous channel can coexist under the shared install dir.
 */
export const AIDLC_ACTIVE_VERSION_FILE = 'active-version';

export interface AidlcInstallInfo {
  /**
   * Full current version string — `amadeusVersion` when present (e.g.
   * `2.10.0-1a.1.1.0-preview.3`), else the plain `version`, else null.
   */
  currentVersion: string | null;
  /** Variant classified from the on-disk metadata. */
  variantId: 'aws' | 'amadeus';
  /** Channel classified from the on-disk metadata. */
  channel: 'release' | 'preview';
  /**
   * Authoritative Artifactory feed base (`release-base-url`) from
   * aidlc.settings.json, or null when absent (AWS installs have none).
   */
  feedUrl: string | null;
}

/** Numeric semver (major.minor.patch) extractor. */
const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

/**
 * Resolve the AI-DLC install root for the given platform.
 * Windows: `%LOCALAPPDATA%\aidlc` (env first, `<home>\AppData\Local\aidlc`
 * fallback). Unix: `<home>/.aidlc`, mirroring the existing binary candidates.
 */
export function aidlcInstallRoot(
  platform: NodeJS.Platform,
  home: string,
  localAppData: string | undefined = process.env.LOCALAPPDATA
): string {
  if (platform === 'win32') {
    const base = localAppData ?? path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'aidlc');
  }
  return path.posix.join(home, '.aidlc');
}

/**
 * Parse the `release-base-url` out of aidlc.settings.json text. Returns the
 * URL (trimmed) or null when absent/unparseable. Never throws.
 */
export function parseSettingsFeedUrl(raw: string): string | null {
  if (!raw) { return null; }
  try {
    const parsed = JSON.parse(raw);
    const url = parsed?.['release-base-url'];
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Pick the highest semver directory name from a versions/ listing. Entries
 * that don't start with a numeric semver are ignored. Returns null for an
 * empty/invalid listing.
 */
export function pickHighestVersionDir(dirNames: string[]): string | null {
  const semverDirs = dirNames.filter((d) => SEMVER_PATTERN.test(d));
  if (semverDirs.length === 0) { return null; }
  return [...semverDirs].sort((a, b) => compareSemver(b, a))[0];
}

/**
 * Parse the `active-version` pointer file text into a version-folder name.
 * Trims surrounding whitespace/newlines and returns null for empty/absent
 * content. Never throws, so the folder-selection logic is testable without the
 * filesystem.
 */
export function parseActiveVersion(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') { return null; }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function compareSemver(a: string, b: string): number {
  const pa = (a.match(SEMVER_PATTERN) ?? ['0', '0', '0', '0']).slice(1).map(Number);
  const pb = (b.match(SEMVER_PATTERN) ?? ['0', '0', '0', '0']).slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) { return pa[i] - pb[i]; }
  }
  return a.localeCompare(b);
}

/**
 * Classify variant + channel + current version from a parsed version.json
 * object. The authoritative signals (confirmed on a real machine):
 *  - `amadeusVersion` present  → AMADEUS. Its value is the FULL current
 *    version; a `-preview` token (or any pre-release tail) in it  → preview.
 *  - else `version` present    → treat as current version; absent any Amadeus
 *    marker, classify as AWS/release.
 *
 * `hasFeedUrl` (an Artifactory release-base-url from settings) is an additional
 * authoritative Amadeus signal OR'd in, so a release-channel Amadeus install
 * (no preview token) is still classified as amadeus.
 */
export function classifyFromVersionJson(
  parsed: unknown,
  hasFeedUrl: boolean
): { currentVersion: string | null; variantId: 'aws' | 'amadeus'; channel: 'release' | 'preview' } {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const amadeusVersion = typeof obj.amadeusVersion === 'string' ? obj.amadeusVersion.trim() : '';
  const plainVersion = typeof obj.version === 'string' ? obj.version.trim() : '';

  if (amadeusVersion) {
    return {
      currentVersion: amadeusVersion,
      variantId: 'amadeus',
      channel: isPreviewVersion(amadeusVersion) ? 'preview' : 'release',
    };
  }

  // No amadeusVersion: the Artifactory feed URL still marks an Amadeus install.
  const variantId: 'aws' | 'amadeus' = hasFeedUrl ? 'amadeus' : 'aws';
  const channel: 'release' | 'preview' =
    plainVersion && isPreviewVersion(plainVersion) ? 'preview' : 'release';
  return { currentVersion: plainVersion || null, variantId, channel };
}

/**
 * Read and JSON-parse `versions/<dir>/version.json`. Returns the parsed object,
 * or null when the file is missing or malformed. Never throws.
 */
async function readVersionJson(versionsDir: string, dir: string): Promise<unknown> {
  try {
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(versionsDir, dir, AIDLC_VERSION_FILE))
    );
    try {
      return JSON.parse(Buffer.from(content).toString('utf-8'));
    } catch { /* malformed version.json */ }
  } catch { /* missing version.json */ }
  return null;
}

/**
 * Read the on-disk AI-DLC install metadata and classify it. Returns null when
 * no install metadata is found (neither settings nor any version.json), so the
 * caller can fall back to the `aidlc --version` stdout parse. Never throws.
 */
export async function readAidlcInstall(
  platform: NodeJS.Platform = process.platform,
  home: string = process.env.USERPROFILE ?? process.env.HOME ?? ''
): Promise<AidlcInstallInfo | null> {
  const root = aidlcInstallRoot(platform, home);

  // 1. Settings (authoritative Artifactory feed base).
  let feedUrl: string | null = null;
  try {
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(root, AIDLC_SETTINGS_FILE))
    );
    feedUrl = parseSettingsFeedUrl(Buffer.from(content).toString('utf-8'));
  } catch { /* no settings file */ }

  // 2. version.json of the ACTIVE install. The `active-version` pointer file is
  //    authoritative: it names the folder for the currently-active install, so
  //    a stale higher-semver folder from a previous channel can't win. Only
  //    when the pointer is absent, or its folder/version.json is missing, do we
  //    fall back to the highest semver folder on disk.
  const versionsDir = path.join(root, AIDLC_VERSIONS_DIR);
  let parsedVersionJson: unknown = null;

  // 2a. Authoritative pointer → versions/<active-version>/version.json.
  let activeVersion: string | null = null;
  try {
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(root, AIDLC_ACTIVE_VERSION_FILE))
    );
    activeVersion = parseActiveVersion(Buffer.from(content).toString('utf-8'));
  } catch { /* no active-version pointer */ }

  if (activeVersion) {
    parsedVersionJson = await readVersionJson(versionsDir, activeVersion);
  }

  // 2b. Fallback: highest semver folder (only when the pointer gave nothing).
  if (parsedVersionJson === null) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(versionsDir));
      const dirNames = entries
        .filter(([, type]) => (type & vscode.FileType.Directory) !== 0)
        .map(([name]) => name);
      const highest = pickHighestVersionDir(dirNames);
      if (highest) {
        parsedVersionJson = await readVersionJson(versionsDir, highest);
      }
    } catch { /* no versions dir */ }
  }

  // Nothing on disk → let the caller fall back to the binary --version parse.
  if (feedUrl === null && parsedVersionJson === null) {
    return null;
  }

  const classified = classifyFromVersionJson(parsedVersionJson, feedUrl !== null);
  return { ...classified, feedUrl };
}
