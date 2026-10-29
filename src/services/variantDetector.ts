/**
 * Pure, dependency-free classifier for the installed `aidlc` binary. Given the
 * raw `aidlc --version` stdout and the resolved binary path, it decides which
 * variant (aws | amadeus) and channel (release | preview) is installed, and
 * captures the numeric semver AND any pre-release/preview suffix separately.
 *
 * No `vscode` import — like installCommands.ts, this is unit-testable in
 * isolation. The real runtime signals (exact `aidlc --version` output, the
 * Artifactory marker) are NOT yet confirmed; the two assumptions below are
 * isolated as single named constants so they are trivial to correct once a real
 * Amadeus machine provides the actual strings.
 */

/**
 * Pre-release / preview suffix shape appended after the numeric semver, e.g.
 * the `-1a.1.1.0-preview.3` in `2.10.0-1a.1.1.0-preview.3` (CONFIRMED from a
 * real Amadeus PREVIEW install) or the `-1a.1.0.0` in `2.10.0-1a.1.0.0`.
 * Matches a leading '-' followed by a dotted alphanumeric pre-release tail,
 * including embedded '-' separators so the whole tail is captured.
 */
export const PREVIEW_SUFFIX_PATTERN = /-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)/;

/**
 * Explicit preview-channel token. CONFIRMED: a real Amadeus preview build
 * string is `2.10.0-1a.1.1.0-preview.3`, whose pre-release tail contains a
 * literal `preview` segment. A version is the preview channel when its
 * pre-release tail contains this token.
 */
export const PREVIEW_CHANNEL_PATTERN = /-preview\b/i;

/**
 * True when a version string belongs to the PREVIEW channel. Robust to the
 * two observed shapes: an explicit `-preview` segment (e.g.
 * `2.10.0-1a.1.1.0-preview.3`) OR any pre-release tail after the numeric
 * semver (older `-1a.1.0.0` builds). A plain release semver (`2.10.0`) is not
 * preview.
 */
export function isPreviewVersion(version: string): boolean {
  const v = version ?? '';
  if (PREVIEW_CHANNEL_PATTERN.test(v)) { return true; }
  const semver = v.match(SEMVER_PATTERN);
  if (!semver || typeof semver.index !== 'number') { return false; }
  const after = v.slice(semver.index + semver[0].length);
  const m = after.match(PREVIEW_SUFFIX_PATTERN);
  return !!m && m.index === 0;
}

/**
 * Marker used to tell an Amadeus install apart from an AWS install from the
 * `--version` stdout or the resolved binary path.
 * // ASSUMPTION pending real `aidlc --version` output and binary path — adjust once confirmed
 * Working guess: the version output or binary path names amadeus / artifactory
 * (case-insensitive). If `--version` alone proves unreliable on a real machine,
 * add an on-disk Artifactory marker-file check keyed off AMADEUS_MARKER_FILE
 * below and OR it into classifyVariant's caller (ruleLoader probe).
 */
export const AMADEUS_MARKER_PATTERN = /amadeus|artifactory/i;

/**
 * Optional on-disk marker the Amadeus Artifactory installer is assumed to drop,
 * relative to the user's aidlc install dir. Centralized here so a real receipt
 * path can be slotted in later without touching detection logic.
 * // ASSUMPTION pending confirmed on-disk Artifactory marker file (if any)
 */
export const AMADEUS_MARKER_FILE = '.aidlc/amadeus.json';

/** Numeric semver (major.minor.patch) extractor. */
const SEMVER_PATTERN = /(\d+\.\d+\.\d+)/;

export interface VariantClassification {
  variantId: 'aws' | 'amadeus';
  channel: 'release' | 'preview';
  /** Numeric semver, e.g. "2.10.0", or null when none could be parsed. */
  version: string | null;
  /** Pre-release/preview suffix, e.g. "1a.1.0.0", or null when none present. */
  versionSuffix: string | null;
}

/**
 * Classify a variant from the raw `aidlc --version` stdout and the resolved
 * binary path.
 *
 * Rules:
 *  - A preview suffix on the version string  → channel 'preview'.
 *  - An Amadeus/Artifactory marker in stdout OR the binary path  → id 'amadeus'.
 *  - A preview suffix also implies the Amadeus family (only Amadeus previews).
 *  - Otherwise (plain awslabs semver, no marker)  → id 'aws', channel 'release'.
 */
export function classifyVariant(
  versionStdout: string,
  binaryPath: string
): VariantClassification {
  const stdout = versionStdout ?? '';
  const semverMatch = stdout.match(SEMVER_PATTERN);
  const version = semverMatch ? semverMatch[1] : null;

  // Capture the preview suffix only from the text AFTER the numeric semver, so
  // a date or unrelated hyphen earlier in the line can't masquerade as one.
  let versionSuffix: string | null = null;
  if (semverMatch && typeof semverMatch.index === 'number') {
    const afterSemver = stdout.slice(semverMatch.index + semverMatch[0].length);
    const suffixMatch = afterSemver.match(PREVIEW_SUFFIX_PATTERN);
    if (suffixMatch && suffixMatch.index === 0) {
      versionSuffix = suffixMatch[1];
    }
  }

  // Channel is preview when the raw string carries an explicit `-preview`
  // token or any pre-release tail after the numeric semver.
  const isPreview = isPreviewVersion(stdout);
  const hasPreviewSuffix = versionSuffix !== null || isPreview;
  const hasAmadeusMarker =
    AMADEUS_MARKER_PATTERN.test(stdout) || AMADEUS_MARKER_PATTERN.test(binaryPath ?? '');

  const channel: 'release' | 'preview' = isPreview ? 'preview' : 'release';
  // A preview suffix is only produced by Amadeus builds, so it also identifies
  // the Amadeus family even when no explicit marker is present.
  const variantId: 'aws' | 'amadeus' =
    hasAmadeusMarker || hasPreviewSuffix ? 'amadeus' : 'aws';

  return { variantId, channel, version, versionSuffix };
}
