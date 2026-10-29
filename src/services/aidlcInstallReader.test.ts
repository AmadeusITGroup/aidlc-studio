import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module imports `vscode` at the top for its fs reader. The pure helpers
// under test don't touch it, but `readAidlcInstall` does, so the mock exposes
// a controllable `workspace.fs` (reads are seeded per-test via a virtual tree).
const fsState: {
  files: Map<string, string>;
  dirs: Map<string, Array<[string, number]>>;
} = { files: new Map(), dirs: new Map() };

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: {
    fs: {
      readFile: async (uri: { fsPath: string }) => {
        const content = fsState.files.get(uri.fsPath);
        if (content === undefined) { throw new Error('ENOENT: ' + uri.fsPath); }
        return Buffer.from(content, 'utf-8');
      },
      readDirectory: async (uri: { fsPath: string }) => {
        const entries = fsState.dirs.get(uri.fsPath);
        if (entries === undefined) { throw new Error('ENOENT: ' + uri.fsPath); }
        return entries;
      },
    },
  },
}));

import {
  aidlcInstallRoot,
  classifyFromVersionJson,
  parseActiveVersion,
  parseSettingsFeedUrl,
  pickHighestVersionDir,
  readAidlcInstall,
} from './aidlcInstallReader';

beforeEach(() => {
  fsState.files.clear();
  fsState.dirs.clear();
});

describe('aidlcInstallRoot', () => {
  it('resolves %LOCALAPPDATA%\\aidlc on Windows', () => {
    expect(aidlcInstallRoot('win32', 'C:\\Users\\sns', 'C:\\Users\\sns\\AppData\\Local')).toBe(
      'C:\\Users\\sns\\AppData\\Local\\aidlc'
    );
  });

  it('falls back to <home>\\AppData\\Local\\aidlc when LOCALAPPDATA is unset', () => {
    expect(aidlcInstallRoot('win32', 'C:\\Users\\sns', undefined)).toBe(
      'C:\\Users\\sns\\AppData\\Local\\aidlc'
    );
  });

  it('resolves ~/.aidlc on Unix', () => {
    expect(aidlcInstallRoot('linux', '/home/u')).toBe('/home/u/.aidlc');
    expect(aidlcInstallRoot('darwin', '/Users/u')).toBe('/Users/u/.aidlc');
  });
});

describe('parseSettingsFeedUrl', () => {
  it('reads the real release-base-url from aidlc.settings.json', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      'release-base-url':
        'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli',
    });
    expect(parseSettingsFeedUrl(raw)).toBe(
      'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli'
    );
  });

  it('returns null for absent key or invalid json', () => {
    expect(parseSettingsFeedUrl('{}')).toBeNull();
    expect(parseSettingsFeedUrl('not json')).toBeNull();
    expect(parseSettingsFeedUrl('')).toBeNull();
  });
});

describe('pickHighestVersionDir', () => {
  it('picks the highest semver directory', () => {
    expect(pickHighestVersionDir(['2.9.0', '2.10.0', '2.10.1'])).toBe('2.10.1');
  });

  it('ignores non-semver entries', () => {
    expect(pickHighestVersionDir(['latest', '2.10.0', 'tmp'])).toBe('2.10.0');
  });

  it('returns null when no semver dir is present', () => {
    expect(pickHighestVersionDir(['latest', 'tmp'])).toBeNull();
    expect(pickHighestVersionDir([])).toBeNull();
  });
});

describe('classifyFromVersionJson', () => {
  it('classifies the real PREVIEW version.json as amadeus/preview with the full version', () => {
    const parsed = {
      schemaVersion: 1,
      version: '2.10.0',
      amadeusVersion: '2.10.0-1a.1.1.0-preview.3',
      date: '2026-10-23',
    };
    expect(classifyFromVersionJson(parsed, true)).toEqual({
      currentVersion: '2.10.0-1a.1.1.0-preview.3',
      variantId: 'amadeus',
      channel: 'preview',
    });
  });

  it('classifies an amadeusVersion with no preview token as amadeus/release', () => {
    expect(classifyFromVersionJson({ version: '2.10.0', amadeusVersion: '2.10.0' }, true)).toEqual({
      currentVersion: '2.10.0',
      variantId: 'amadeus',
      channel: 'release',
    });
  });

  it('classifies a plain version with a feed URL as amadeus (release)', () => {
    expect(classifyFromVersionJson({ version: '2.10.0' }, true)).toEqual({
      currentVersion: '2.10.0',
      variantId: 'amadeus',
      channel: 'release',
    });
  });

  it('classifies a plain version with no feed URL / no amadeus marker as aws', () => {
    expect(classifyFromVersionJson({ version: '2.10.0' }, false)).toEqual({
      currentVersion: '2.10.0',
      variantId: 'aws',
      channel: 'release',
    });
  });

  it('handles an empty/absent object', () => {
    expect(classifyFromVersionJson(null, false)).toEqual({
      currentVersion: null,
      variantId: 'aws',
      channel: 'release',
    });
  });
});

describe('parseActiveVersion', () => {
  it('trims surrounding whitespace/newlines', () => {
    expect(parseActiveVersion(' 2.10.0\n')).toBe('2.10.0');
    expect(parseActiveVersion('\r\n2.9.0\t')).toBe('2.9.0');
  });

  it('returns null for empty/whitespace-only/non-string input', () => {
    expect(parseActiveVersion('')).toBeNull();
    expect(parseActiveVersion('   \n')).toBeNull();
    expect(parseActiveVersion(null)).toBeNull();
    expect(parseActiveVersion(undefined)).toBeNull();
  });
});

describe('readAidlcInstall (active-version folder selection)', () => {
  // Resolved install root for the seeded virtual tree below. Subpaths are built
  // with `path.join` exactly as the source does, so the mock keys match the
  // host's native separator.
  const root = aidlcInstallRoot('linux', '/home/u');
  const versionsDir = path.join(root, 'versions');
  // RELEASE amadeus build: amadeusVersion carries NO preview token / pre-release
  // tail, so isPreviewVersion() is false → channel 'release'.
  const releaseJson = JSON.stringify({ version: '2.9.0', amadeusVersion: '2.9.0' });
  const previewJson = JSON.stringify({
    version: '2.10.0',
    amadeusVersion: '2.10.0-1a.1.1.0-preview.3',
  });
  const settings = JSON.stringify({ 'release-base-url': 'https://repo.example/cli' });

  function seedTwoChannelFolders(): void {
    // A higher-semver PREVIEW folder coexists with the active RELEASE folder —
    // the exact stale-folder trap from the bug report.
    fsState.dirs.set(versionsDir, [
      ['2.9.0', 2],
      ['2.10.0', 2],
    ]);
    fsState.files.set(path.join(versionsDir, '2.9.0', 'version.json'), releaseJson);
    fsState.files.set(path.join(versionsDir, '2.10.0', 'version.json'), previewJson);
    fsState.files.set(path.join(root, 'aidlc.settings.json'), settings);
  }

  it('(a) honors active-version pointing at the RELEASE folder over a higher PREVIEW folder', async () => {
    seedTwoChannelFolders();
    fsState.files.set(path.join(root, 'active-version'), '2.9.0\n');

    const info = await readAidlcInstall('linux', '/home/u');

    expect(info).toEqual({
      currentVersion: '2.9.0',
      variantId: 'amadeus',
      channel: 'release',
      feedUrl: 'https://repo.example/cli',
    });
  });

  it('(b) honors active-version pointing at the PREVIEW folder', async () => {
    seedTwoChannelFolders();
    fsState.files.set(path.join(root, 'active-version'), '2.10.0');

    const info = await readAidlcInstall('linux', '/home/u');

    expect(info?.channel).toBe('preview');
    expect(info?.currentVersion).toBe('2.10.0-1a.1.1.0-preview.3');
  });

  it('(c) falls back to highest semver when active-version is absent', async () => {
    seedTwoChannelFolders();
    // No active-version file seeded → highest (2.10.0 preview) wins, preserving
    // the prior behavior.
    const info = await readAidlcInstall('linux', '/home/u');

    expect(info?.channel).toBe('preview');
    expect(info?.currentVersion).toBe('2.10.0-1a.1.1.0-preview.3');
  });

  it('(d) falls back gracefully when active-version points at a missing version.json', async () => {
    seedTwoChannelFolders();
    // Pointer names a folder with no version.json on disk → fall back to the
    // highest semver folder instead of throwing.
    fsState.files.set(path.join(root, 'active-version'), '9.9.9');

    const info = await readAidlcInstall('linux', '/home/u');

    expect(info?.channel).toBe('preview');
    expect(info?.currentVersion).toBe('2.10.0-1a.1.1.0-preview.3');
  });
});
