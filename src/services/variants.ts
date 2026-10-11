import * as vscode from 'vscode';

/**
 * Install method differs by variant:
 * - 'native-installer': download and run the release install.sh / install.ps1
 *   (AWS v2 — verified checksums, no git/bun needed, then `aidlc config --harness kiro-ide`)
 * - 'git-clone-copy': git clone the repo and copy dist/kiro-ide into the workspace
 *   (Amadeus fork and the legacy copy flow)
 */
export type InstallMethod = 'native-installer' | 'git-clone-copy';

export interface AidlcVariant {
  id: string;
  label: string;
  description: string;
  installMethod: InstallMethod;
  /** For native-installer: the install script URLs */
  installScriptUrl?: { unix: string; windows: string };
  /** For git-clone-copy: repo URL, branch, and dist path */
  repoUrl: string;
  branch: string;
  distPath: string;
}

export const AIDLC_VARIANTS: AidlcVariant[] = [
  {
    id: 'aws',
    label: 'AWS AI-DLC (open source)',
    description: 'Official open-source AI-DLC from awslabs — uses the native installer',
    installMethod: 'native-installer',
    installScriptUrl: {
      unix: 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh',
      windows: 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1',
    },
    repoUrl: 'https://github.com/awslabs/aidlc-workflows',
    branch: 'v2',
    distPath: 'dist/kiro-ide',
  },
  {
    id: 'amadeus',
    label: 'Amadeus AIDLC',
    description: "Amadeus's internal fork — cloned and copied (requires access)",
    installMethod: 'git-clone-copy',
    repoUrl: 'https://github.com/Amadeus-xDLC/amadeus-aidlc',
    branch: 'main',
    distPath: 'dist/kiro-ide',
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
      repoUrl: customSource,
    };
  }
  return variant;
}

export function getDefaultVariant(): AidlcVariant {
  return getVariant(DEFAULT_VARIANT_ID);
}
