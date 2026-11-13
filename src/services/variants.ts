import * as vscode from 'vscode';

/**
 * Install method differs by variant. Each variant installs via its OWN
 * official installer, with no deviation:
 * - 'native-installer': run the AWS remote release installer one-liner
 *   (`irm <url> | iex` on Windows, `curl -fsSL <url> | sh` on Unix — verified
 *   checksums, no git/bun needed), then `aidlc config --harness <harness>`.
 * - 'amadeus-cli': Amadeus 2.10+ CLI-driven model. Run the Amadeus machine
 *   installer (install-aidlc.ps1 -SkipCredentials) to install the `aidlc` CLI
 *   only, then `aidlc config --harness <harness>` to configure the project —
 *   the same CLI shape AWS uses, differing only in how the machine installer
 *   is obtained (SSO/Artifactory). Replaces the old 'repo-installer' path,
 *   which assumed the retired 2.5 dist/<harness>/ repo layout.
 * - 'repo-installer': LEGACY (2.5). Clone the repo and run the shipped
 *   one-click installer with -Target/-Harness, falling back to copying
 *   dist/<harness>/. Retained ONLY for completeness; no catalog variant uses
 *   it on 2.10+.
 * - 'git-clone-copy': git clone the repo and copy dist/<harness>/ into the
 *   workspace (legacy manual-copy fallback and custom forks).
 * The harness is chosen by the host IDE and clamped to the variant's
 * supported set via resolveHarness() (see below).
 */
export type InstallMethod =
  | 'native-installer'
  | 'amadeus-cli'
  | 'repo-installer'
  | 'git-clone-copy';

/**
 * Which doctor command verifies this variant's install, per each variant's
 * official README:
 * - 'native': `aidlc doctor` (AWS native binary install).
 * - 'bun-tool': `bun .kiro/tools/aidlc-utility.ts doctor` (Amadeus / custom
 *   clone layouts, which ship the Bun tool and have no `aidlc` binary).
 * Derived from the variant directly so it stays correct independent of
 * installMethod.
 */
export type DoctorMode = 'native' | 'bun-tool';

/**
 * AI-DLC harness names. A harness is the IDE/agent integration the framework
 * is projected into. The two upstreams differ in what they support:
 * - AWS (awslabs/aidlc-workflows): claude, kiro, kiro-ide, codex, cursor,
 *   opencode, copilot. We use kiro-ide (Kiro) and copilot (VS Code).
 * - Amadeus (Amadeus-xDLC/amadeus-aidlc): Kiro only — kiro-ide and kiro
 *   (Kiro CLI). VS Code / copilot is on its roadmap, not available today.
 */
export type AidlcHarness = 'kiro-ide' | 'kiro' | 'copilot';

export interface AidlcVariant {
  id: string;
  label: string;
  description: string;
  installMethod: InstallMethod;
  /** Which doctor command verifies this variant's install. */
  doctorMode: DoctorMode;
  /** For native-installer: the install script URLs */
  installScriptUrl?: { unix: string; windows: string };
  /** For git-clone-copy: repo URL, branch, and dist path base */
  repoUrl: string;
  branch: string;
  distPath: string;
  /**
   * Harnesses this variant actually ships. The first entry is the default
   * fallback when the host IDE's harness isn't supported by the variant.
   */
  supportedHarnesses: AidlcHarness[];
}

export const AIDLC_VARIANTS: AidlcVariant[] = [
  {
    id: 'aws',
    label: 'AWS AI-DLC (open source)',
    description: 'Official open-source AI-DLC from awslabs — uses the native installer',
    installMethod: 'native-installer',
    doctorMode: 'native',
    installScriptUrl: {
      unix: 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh',
      windows: 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1',
    },
    repoUrl: 'https://github.com/awslabs/aidlc-workflows',
    branch: 'v2',
    distPath: 'dist/kiro-ide',
    // AWS ships a VS Code (copilot) harness in addition to Kiro.
    supportedHarnesses: ['kiro-ide', 'copilot'],
  },
  {
    id: 'amadeus',
    label: 'Amadeus AIDLC',
    description: "Amadeus's internal fork — official CLI installer (requires access)",
    // ASSUMPTION pending confirmation on a real Amadeus 2.10+ machine: the
    // Amadeus 2.10+ model is CLI-driven (machine installer -> `aidlc config`)
    // like AWS, NOT the retired 2.5 clone-and-copy-dist flow. Reverting this to
    // 'repo-installer' restores the legacy behavior if that turns out wrong.
    installMethod: 'amadeus-cli',
    // ASSUMPTION pending confirmation on a real Amadeus 2.10+ machine: 2.10+
    // Amadeus ships the `aidlc` binary (so `aidlc doctor` exists), making the
    // native doctor correct. If Amadeus has no `aidlc` binary, revert to
    // 'bun-tool'.
    doctorMode: 'native',
    // ASSUMPTION pending confirmation on a real Amadeus 2.10+ machine: the
    // machine installer `install-aidlc.ps1 -SkipCredentials` location. This is
    // the ONLY uncertain source value; whether it is remote-pipeable (like
    // AWS) or must be obtained via an SSO clone first is NOT verified. The
    // placeholder below is the installer's expected published location —
    // correct it here (and only here) against a real machine. Both unix/windows
    // point at the same script base since the installer is a single artifact.
    installScriptUrl: {
      unix:
        'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli/install-aidlc.sh',
      windows:
        'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli/install-aidlc.ps1',
    },
    repoUrl: 'https://github.com/Amadeus-xDLC/amadeus-aidlc',
    branch: 'main',
    // DEAD under the CLI model: 2.10+ Amadeus ships no dist/ folder. Kept only
    // to satisfy the shared AidlcVariant shape; the 'amadeus-cli' path never
    // reads it. (It is still live for the custom 'git-clone-copy' fork path.)
    distPath: 'dist/kiro-ide',
    // Amadeus is Kiro-only today (kiro-ide + Kiro CLI). No VS Code harness.
    supportedHarnesses: ['kiro-ide', 'kiro'],
  },
];

export const DEFAULT_VARIANT_ID = 'aws';

/**
 * Get a variant by id, applying a custom rulesSource URL override if set.
 * A custom URL forces the git-clone-copy method.
 */
export function getVariant(variantId: string): AidlcVariant {
  const variant = AIDLC_VARIANTS.find((v) => v.id === variantId) ?? AIDLC_VARIANTS[0];
  const customSource = vscode.workspace
    .getConfiguration('amadeus-aidlc')
    .get<string>('rulesSource', '')
    .trim();

  if (customSource && customSource.startsWith('http')) {
    return {
      ...variant,
      id: 'custom',
      label: 'Custom',
      installMethod: 'git-clone-copy',
      doctorMode: 'bun-tool',
      repoUrl: customSource,
      // A custom fork is assumed to follow the Amadeus-style Kiro layout.
      supportedHarnesses: ['kiro-ide', 'kiro'],
    };
  }
  return variant;
}

/**
 * Collapse a variant's id into one of the two display states the UI and
 * version checks share:
 *  - `aws`     → AWS (or default) variant.
 *  - `amadeus` → Amadeus (or custom) variant.
 *
 * Pure: a single source of truth for the display id, used by both
 * UpdateChecker (VersionInfo.variantDisplayId) and SystemProvider.
 */
export function describeVariant(
  variant: Pick<AidlcVariant, 'id'>
): 'aws' | 'amadeus' {
  if (variant.id === 'aws' || variant.id === DEFAULT_VARIANT_ID) {
    return 'aws';
  }
  return 'amadeus';
}

export function getDefaultVariant(): AidlcVariant {
  return getVariant(DEFAULT_VARIANT_ID);
}

/**
 * The harness that matches the host IDE this extension is running in:
 * Kiro IDE -> "kiro-ide", VS Code (and any other host) -> "copilot".
 *
 * NOTE: this is the one place the extension intentionally inspects the host
 * IDE. It is a functional requirement (the correct harness runtime differs by
 * IDE), not cosmetic branding — no user-facing text names the IDE.
 */
export function detectHostHarness(appName: string = vscode.env.appName): AidlcHarness {
  // vscode.env.appName is "Kiro" in Kiro IDE and "Visual Studio Code"
  // (or "Visual Studio Code - Insiders") in VS Code.
  return /kiro/i.test(appName) ? 'kiro-ide' : 'copilot';
}

/**
 * Resolve the harness to actually install for a given variant and host.
 * Uses the host's harness when the variant supports it; otherwise falls back
 * to the variant's default (first supported) harness. This keeps us honest:
 * e.g. Amadeus is Kiro-only, so selecting it in VS Code installs kiro-ide
 * rather than attempting a non-existent copilot harness.
 *
 * Returns the resolved harness plus whether a fallback occurred, so callers
 * can inform the user.
 */
export function resolveHarness(
  variant: AidlcVariant,
  appName: string = vscode.env.appName
): { harness: AidlcHarness; fellBack: boolean } {
  const host = detectHostHarness(appName);
  if (variant.supportedHarnesses.includes(host)) {
    return { harness: host, fellBack: false };
  }
  return { harness: variant.supportedHarnesses[0], fellBack: true };
}
