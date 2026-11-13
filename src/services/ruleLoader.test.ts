import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mutable test state the mocks read from ---
// Set of workspace-relative paths (joined with '/') that vscode.workspace.fs.stat resolves for.
let existingPaths: Set<string>;
// Map of workspaceState keys -> values.
let workspaceState: Map<string, unknown>;
// Function the Shell.run mock delegates to (lets each test drive binary output).
let shellRun: (command: string) => Promise<{ stdout: string; stderr: string }>;
// Map of absolute file path -> text content for the on-disk install reader.
let diskFiles: Map<string, string>;
// Map of absolute dir path -> entry names for readDirectory.
let diskDirs: Map<string, string[]>;

vi.mock('vscode', () => {
  const joinPath = (base: { path: string }, ...parts: string[]) => ({
    path: [base.path, ...parts].join('/'),
    fsPath: [base.path, ...parts].join('/'),
  });
  return {
    Uri: {
      joinPath,
      file: (p: string) => ({ path: p, fsPath: p }),
    },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      workspaceFolders: [{ uri: { path: '/ws', fsPath: '/ws' } }],
      getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }),
      fs: {
        stat: async (uri: { path: string }) => {
          // The binary candidates use absolute OS paths; the layout files use /ws/...
          const key = uri.path;
          if (existingPaths.has(key)) { return { type: 1 }; }
          throw new Error(`ENOENT: ${key}`);
        },
        readFile: async (uri: { path: string }) => {
          const content = diskFiles.get(uri.path);
          if (content === undefined) { throw new Error(`ENOENT: ${uri.path}`); }
          return Buffer.from(content, 'utf-8');
        },
        readDirectory: async (uri: { path: string }) => {
          const names = diskDirs.get(uri.path);
          if (names === undefined) { throw new Error(`ENOENT: ${uri.path}`); }
          return names.map((n) => [n, 2]);
        },
      },
    },
  };
});

vi.mock('./shell', () => ({
  Shell: {
    run: (command: string) => shellRun(command),
  },
}));

import { RuleLoader } from './ruleLoader';

function makeContext() {
  return {
    workspaceState: {
      get: (key: string) => workspaceState.get(key),
      update: (key: string, value: unknown) => { workspaceState.set(key, value); return Promise.resolve(); },
    },
  } as unknown as import('vscode').ExtensionContext;
}

beforeEach(() => {
  existingPaths = new Set();
  workspaceState = new Map();
  diskFiles = new Map();
  diskDirs = new Map();
  shellRun = async () => { throw new Error('no binary'); };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('isWorkspaceConfigured', () => {
  it('returns true when the clone-copy layout exists', async () => {
    existingPaths.add('/ws/.kiro/skills/aidlc/SKILL.md');
    existingPaths.add('/ws/aidlc/spaces/default/memory');
    const loader = new RuleLoader(makeContext());
    expect(await loader.isWorkspaceConfigured()).toBe(true);
  });

  it('returns FALSE when only a global binary exists but the workspace is empty', async () => {
    // Workspace-scoped: a machine-wide `aidlc` CLI must NOT make an empty
    // project report "configured" (that falsely showed Setup as Installed in
    // an empty folder). The global CLI is surfaced by the Installed CLI row.
    shellRun = async (cmd) =>
      cmd.includes('--version')
        ? { stdout: 'aidlc 2.9.1', stderr: '' }
        : Promise.reject(new Error('no'));
    const loader = new RuleLoader(makeContext());
    expect(await loader.isWorkspaceConfigured()).toBe(false);
  });

  it('returns false when the workspace layout is absent', async () => {
    const loader = new RuleLoader(makeContext());
    expect(await loader.isWorkspaceConfigured()).toBe(false);
  });

  it('returns false when only the skill file exists (partial layout)', async () => {
    existingPaths.add('/ws/.kiro/skills/aidlc/SKILL.md');
    const loader = new RuleLoader(makeContext());
    expect(await loader.isWorkspaceConfigured()).toBe(false);
  });
});

describe('restoreVariant', () => {
  it('classifies a binary-only Amadeus install (pre-release tail) as amadeus (not AWS)', async () => {
    // No persisted id, no aidlc-utility.ts; binary reports an Amadeus version
    // with a pre-release tail.
    shellRun = async (cmd) =>
      cmd.includes('--version')
        ? { stdout: 'aidlc 2.10.0-1a.1.0.0', stderr: '' }
        : Promise.reject(new Error('no'));
    const loader = new RuleLoader(makeContext());
    const variant = await loader.restoreVariant();
    expect(variant.id).toBe('amadeus');
    expect(workspaceState.get('aidlc.variantId')).toBe('amadeus');
  });

  it('defaults to AWS when the binary reports a plain awslabs semver', async () => {
    shellRun = async (cmd) =>
      cmd.includes('--version')
        ? { stdout: 'aidlc 2.9.1', stderr: '' }
        : Promise.reject(new Error('no'));
    const loader = new RuleLoader(makeContext());
    const variant = await loader.restoreVariant();
    expect(variant.id).toBe('aws');
  });

  it('restores a persisted amadeus variant', async () => {
    workspaceState.set('aidlc.variantId', 'amadeus');
    const loader = new RuleLoader(makeContext());
    const variant = await loader.restoreVariant();
    expect(variant.id).toBe('amadeus');
  });

  it('uses persisted state when there is no on-disk install metadata', async () => {
    // No disk files/dirs seeded → readAidlcInstall() returns null → fall back
    // to the persisted cache.
    workspaceState.set('aidlc.variantId', 'amadeus');
    const loader = new RuleLoader(makeContext());
    const variant = await loader.restoreVariant();
    expect(variant.id).toBe('amadeus');
  });

  it('falls back to the binary probe / aws default when nothing persisted and no on-disk metadata', async () => {
    // Nothing persisted, no on-disk metadata, binary reports a plain awslabs
    // semver → AWS default (unchanged behavior).
    shellRun = async (cmd) =>
      cmd.includes('--version')
        ? { stdout: 'aidlc 2.9.1', stderr: '' }
        : Promise.reject(new Error('no'));
    const loader = new RuleLoader(makeContext());
    const variant = await loader.restoreVariant();
    expect(variant.id).toBe('aws');
  });
});
