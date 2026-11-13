import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Virtual disk + shell the mocks read from ---
// Set of absolute paths that fs.stat resolves for (binary candidates live here).
let existingPaths: Set<string>;
// Map of absolute file path -> text content for readFile.
let diskFiles: Map<string, string>;
// Map of absolute dir path -> entry names for readDirectory.
let diskDirs: Map<string, string[]>;
// Function the Shell.run mock delegates to (drives `aidlc --version` output).
let shellRun: (command: string) => Promise<{ stdout: string; stderr: string }>;

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: {
    fs: {
      stat: async (uri: { fsPath: string }) => {
        if (existingPaths.has(uri.fsPath)) { return { type: 1 }; }
        throw new Error('ENOENT: ' + uri.fsPath);
      },
      readFile: async (uri: { fsPath: string }) => {
        const content = diskFiles.get(uri.fsPath);
        if (content === undefined) { throw new Error('ENOENT: ' + uri.fsPath); }
        return Buffer.from(content, 'utf-8');
      },
      readDirectory: async (uri: { fsPath: string }) => {
        const names = diskDirs.get(uri.fsPath);
        if (names === undefined) { throw new Error('ENOENT: ' + uri.fsPath); }
        return names.map((n) => [n, 2]);
      },
    },
  },
}));

vi.mock('./shell', () => ({
  Shell: { run: (command: string) => shellRun(command) },
}));

import { detectCliPresence } from './cliPresence';

const PLATFORM: NodeJS.Platform = 'linux';
const HOME = '/home/dev';
// aidlcBinaryCandidates(linux, HOME) uses path.posix internally, so the binary
// candidate path is posix-joined.
const BIN = path.posix.join(HOME, '.aidlc', 'bin', 'aidlc'); // first candidate
// readAidlcInstall(linux, HOME) builds the install root with path.posix, but
// then joins sub-paths with the HOST-NATIVE path.join. Key the virtual disk
// with the same host-native join so the seeded files resolve on any OS.
const ROOT = path.posix.join(HOME, '.aidlc'); // aidlcInstallRoot(linux, HOME)
const j = (...parts: string[]) => path.join(...parts);

beforeEach(() => {
  existingPaths = new Set();
  diskFiles = new Map();
  diskDirs = new Map();
  shellRun = async () => { throw new Error('no binary'); };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('detectCliPresence', () => {
  it('reports absent when nothing exists', async () => {
    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(false);
    expect(p.variantId).toBeNull();
    expect(p.source).toBe('absent');
  });

  it('detects AWS from a plain --version when only the binary file exists', async () => {
    existingPaths.add(BIN);
    shellRun = async (cmd) =>
      cmd.includes('--version')
        ? { stdout: 'aidlc 2.9.1', stderr: '' }
        : Promise.reject(new Error('no'));
    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(true);
    expect(p.variantId).toBe('aws');
    expect(p.version).toBe('2.9.1');
    expect(p.source).toBe('binary');
  });

  it('prefers on-disk amadeus metadata over the --version probe', async () => {
    // Binary file absent, but install metadata present → still present, and the
    // metadata is authoritative (works even when the binary is not runnable).
    diskFiles.set(
      j(ROOT, 'aidlc.settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        'release-base-url':
          'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli',
      })
    );
    diskDirs.set(j(ROOT, 'versions'), ['2.10.0']);
    diskFiles.set(
      j(ROOT, 'versions', '2.10.0', 'version.json'),
      JSON.stringify({ version: '2.10.0', amadeusVersion: '2.10.0-1a.1.1.0' })
    );

    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(true);
    expect(p.variantId).toBe('amadeus');
    expect(p.version).toBe('2.10.0-1a.1.1.0');
    expect(p.source).toBe('metadata');
  });

  it('reports source=binary when BOTH the binary file and metadata exist', async () => {
    existingPaths.add(BIN);
    diskFiles.set(
      j(ROOT, 'aidlc.settings.json'),
      JSON.stringify({ 'release-base-url': 'x/cli' })
    );
    diskDirs.set(j(ROOT, 'versions'), ['2.10.0']);
    diskFiles.set(
      j(ROOT, 'versions', '2.10.0', 'version.json'),
      JSON.stringify({ version: '2.10.0', amadeusVersion: '2.10.0' })
    );
    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(true);
    expect(p.variantId).toBe('amadeus');
    expect(p.source).toBe('binary');
  });

  it('is present but unclassified when the binary file exists yet cannot run and has no metadata', async () => {
    existingPaths.add(BIN);
    // shellRun rejects (binary not runnable), no metadata on disk.
    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(true);
    expect(p.variantId).toBeNull();
    expect(p.source).toBe('binary');
  });

  it('establishes presence from a bare-PATH --version when no file and no metadata', async () => {
    shellRun = async (cmd) =>
      cmd === 'aidlc --version'
        ? { stdout: 'aidlc 2.9.1', stderr: '' }
        : Promise.reject(new Error('no'));
    const p = await detectCliPresence(PLATFORM, HOME);
    expect(p.present).toBe(true);
    expect(p.variantId).toBe('aws');
    expect(p.source).toBe('version');
  });
});
