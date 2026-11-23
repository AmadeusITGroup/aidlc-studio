/**
 * Pure, dependency-free classifier for the installed `aidlc` binary. Given the
 * raw `aidlc --version` stdout and the resolved binary path, it decides which
 * variant (aws | amadeus) is installed and captures the numeric semver.
 *
 * No `vscode` import — like installCommands.ts, this is unit-testable in
 * isolation. The real runtime signals (exact `aidlc --version` output, the
 * Artifactory marker) are NOT yet confirmed; the two assumptions below are
 * isolated as single named constants so they are trivial to correct once a real
 * Amadeus machine provides the actual strings.
 */

/**
 * Pre-release tail shape appended after the numeric semver, e.g. the
 * `-1a.1.1.0` in `2.10.0-1a.1.1.0`. Matches a leading '-' followed by a dotted alphanumeric
 * pre-release tail, including embedded '-' separators so the whole tail is
 * captured. Only Amadeus builds carry such a tail, so it is used purely as an
 * Amadeus-family signal (NOT a release/pre-release distinction — the extension
 * treats every Amadeus build the same).
 */
export const PRERELEASE_TAIL_PATTERN = /-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)/;

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
  /** Numeric semver, e.g. "2.10.0", or null when none could be parsed. */
  version: string | null;
}

/**
 * Classify a variant from the raw `aidlc --version` stdout and the resolved
 * binary path.
 *
 * Rules:
 *  - An Amadeus/Artifactory marker in stdout OR the binary path  → id 'amadeus'.
 *  - A pre-release tail on the version string also implies the Amadeus family
 *    (only Amadeus builds carry one).
 *  - Otherwise (plain awslabs semver, no marker)  → id 'aws'.
 */
export function classifyVariant(
  versionStdout: string,
  binaryPath: string
): VariantClassification {
  const stdout = versionStdout ?? '';
  const semverMatch = stdout.match(SEMVER_PATTERN);
  const version = semverMatch ? semverMatch[1] : null;

  // A pre-release tail AFTER the numeric semver is an Amadeus-family signal
  // (so a date or unrelated hyphen earlier in the line can't masquerade as one).
  let hasPrereleaseTail = false;
  if (semverMatch && typeof semverMatch.index === 'number') {
    const afterSemver = stdout.slice(semverMatch.index + semverMatch[0].length);
    const tailMatch = afterSemver.match(PRERELEASE_TAIL_PATTERN);
    hasPrereleaseTail = !!tailMatch && tailMatch.index === 0;
  }

  const hasAmadeusMarker =
    AMADEUS_MARKER_PATTERN.test(stdout) || AMADEUS_MARKER_PATTERN.test(binaryPath ?? '');

  // A pre-release tail is only produced by Amadeus builds, so it also
  // identifies the Amadeus family even when no explicit marker is present.
  const variantId: 'aws' | 'amadeus' =
    hasAmadeusMarker || hasPrereleaseTail ? 'amadeus' : 'aws';

  return { variantId, version };
}
