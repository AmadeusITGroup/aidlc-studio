import * as vscode from 'vscode';

/**
 * Install method differs by variant. Each variant installs via its OWN
 * official installer, with no deviation:
 * - 'native-installer': run the AWS remote release installer one-liner
 *   (`irm <url> | iex` on Windows, `curl -fsSL <url> | sh` on Unix — verified
 *   checksums, no git/bun needed), then `aidlc config --harness <harness>`.
 * - 'repo-installer': clone the (SSO) repo and run the official one-click
 *   installer script shipped INSIDE the clone (scripts/install-aidlc.ps1 on
 *   Windows, scripts/install-aidlc.sh on Unix) with the workspace as target
 *   and the resolved harness (Amadeus fork).
 * - 'git-clone-copy': git clone the repo and copy dist/<harness>/ into the
 *   workspace (legacy manual-copy fallback and custom forks).
 * The harness is chosen by the host IDE and clamped to the variant's
 * supported set via resolveHarness() (see below).
 */
export type InstallMethod = 'native-installer' | 'repo-installer' | 'git-clone-copy';

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
    description: "Amadeus's internal fork — official one-click installer (requires access)",
    installMethod: 'repo-installer',
    doctorMode: 'bun-tool',
    repoUrl: 'https://github.com/Amadeus-xDLC/amadeus-aidlc',
    branch: 'main',
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
