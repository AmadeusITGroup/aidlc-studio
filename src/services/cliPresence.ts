import * as vscode from 'vscode';
import { Shell } from './shell';
import { aidlcBinaryCandidates } from './installCommands';
import { readAidlcInstall } from './aidlcInstallReader';
import { classifyVariant } from './variantDetector';

/**
 * Single source of truth for "is the `aidlc` CLI installed on THIS machine, and
 * if so which variant/version?". This is the pivot the CLI-first install/update
 * model turns on: every operation (setup, workspace update, doctor, version,
 * upgrade) first asks this detector whether a CLI already exists.
 *
 * MACHINE-scoped on purpose — it answers "is there an `aidlc` binary available",
 * NOT "is this workspace configured" (RuleLoader.isWorkspaceConfigured answers
 * that). The two are independent: a global CLI can exist with an empty project,
 * and a configured project's CLI can be missing from this process's PATH.
 *
 * Both AWS and Amadeus install a binary literally named `aidlc` to the SAME
 * location, so there is only ever ONE `aidlc` on a machine — they cannot
 * coexist as separate commands. That is why, when a CLI is present, the variant
 * must be DETECTED from on-disk metadata rather than asked for.
 *
 * READ-ONLY: this only probes for the binary and READS the installer's own
 * on-disk metadata. It never installs, configures, or mutates anything.
 *
 * Reuses the existing pieces verbatim — no duplication:
 *  - aidlcBinaryCandidates(): the known binary locations per OS.
 *  - readAidlcInstall(): authoritative on-disk variant/version.
 *  - classifyVariant(): parse `aidlc --version` stdout as a fallback signal.
 */
export interface CliPresence {
  /** True when an `aidlc` binary is resolvable on this machine. */
  present: boolean;
  /** Detected variant, or null when it could not be determined. */
  variantId: 'aws' | 'amadeus' | null;
  /** Full current version string, or null. */
  version: string | null;
  /**
   * How presence was established:
   *  - 'binary'   → a candidate binary path exists on disk.
   *  - 'metadata' → on-disk install metadata was found (binary may not be on
   *                 this process's PATH, e.g. the F5 host).
   *  - 'version'  → only the bare-PATH `aidlc --version` probe answered.
   *  - 'absent'   → no signal at all.
   */
  source: 'binary' | 'metadata' | 'version' | 'absent';
}

/** Absent sentinel, so callers don't construct the "nothing found" shape. */
export const CLI_ABSENT: CliPresence = {
  present: false,
  variantId: null,
  version: null,
  source: 'absent',
};

/**
 * Detect whether the `aidlc` CLI is present on this machine and, if so, which
 * variant/version. Never throws.
 *
 * Resolution order (first signal wins for presence; metadata is preferred for
 * the variant/version detail because it is authoritative and works even when
 * the binary isn't on PATH):
 *   1. A candidate binary path exists on disk  → present.
 *   2. On-disk install metadata (readAidlcInstall)  → present + authoritative
 *      variant/version.
 *   3. bare-PATH `aidlc --version` probe  → present + classified variant.
 *
 * When (1) establishes presence, we still consult (2) for the richer detail,
 * and fall back to (3) only when metadata is unavailable.
 */
export async function detectCliPresence(
  platform: NodeJS.Platform = process.platform,
  home: string = process.env.USERPROFILE ?? process.env.HOME ?? ''
): Promise<CliPresence> {
  // 1. Is a known binary present on disk?
  let binaryPath: string | null = null;
  for (const bin of aidlcBinaryCandidates(platform, home)) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(bin));
      binaryPath = bin;
      break;
    } catch {
      /* not at this location */
    }
  }

  // 2. Authoritative on-disk install metadata (variant/version). This keeps
  //    working even when the binary isn't on PATH, so it also ESTABLISHES
  //    presence on its own.
  const install = await readAidlcInstall(platform, home).catch(() => null);

  if (install) {
    return {
      present: true,
      variantId: install.variantId,
      version: install.currentVersion,
      // Prefer reporting 'binary' when we actually saw the file — it's the
      // strongest presence signal — else 'metadata'.
      source: binaryPath ? 'binary' : 'metadata',
    };
  }

  // 3. No metadata. If a binary file exists, probe its --version to classify.
  //    Otherwise fall back to a bare-PATH probe. Either answering = present.
  const probeCmd = binaryPath ? `"${binaryPath}" --version` : 'aidlc --version';
  try {
    const { stdout } = await Shell.run(probeCmd, { timeout: 10000 });
    const classified = classifyVariant(stdout, binaryPath ?? '');
    return {
      present: true,
      variantId: classified.variantId,
      version: classified.version,
      source: binaryPath ? 'binary' : 'version',
    };
  } catch {
    /* binary not runnable */
  }

  // A binary file existed but could not be run and had no metadata: still
  // present (we found the file), just without classified detail.
  if (binaryPath) {
    return { present: true, variantId: null, version: null, source: 'binary' };
  }

  return CLI_ABSENT;
}
