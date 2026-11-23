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
// Terminals created through vscode.window.createTerminal.
const terminals: { opts: { name: string; shellPath: string }; sent: string[]; shown: boolean }[] = [];

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
    env: { appName: 'Kiro' },
    window: {
      createTerminal: (opts: { name: string; shellPath: string }) => {
        terminals.push({ opts, sent: [], shown: false });
        const t = terminals[terminals.length - 1];
        return { show: () => { t.shown = true; }, sendText: (s: string) => { t.sent.push(s); } };
      },
    },
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
import { getVariant } from './variants';

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
  terminals.length = 0;
  shellRun = async () => { throw new Error('no binary'); };
});

/** Run `fn` with process.platform forced to `platform` (restored afterwards). */
async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T> | T): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    if (original) { Object.defineProperty(process, 'platform', original); }
  }
}

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

describe('launchAmadeusInstaller (README section 1, interactive terminal)', () => {
  const winCmd =
    '$f = Join-Path $env:TEMP "install-aidlc.ps1"; ' +
    'curl.exe -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.ps1 -o $f; ' +
    'powershell -ExecutionPolicy Bypass -File $f; Remove-Item $f';

  it('Windows: opens PowerShell and sends the exact download-then-run command, without child_process', async () => {
    const calls: string[] = [];
    shellRun = async (c) => { calls.push(c); return { stdout: '', stderr: '' }; };
    const loader = new RuleLoader(makeContext());
    loader.setVariant(getVariant('amadeus'));
    await withPlatform('win32', () => { loader.launchAmadeusInstaller(); });
    expect(terminals).toHaveLength(1);
    expect(terminals[0].opts).toEqual({ name: 'AIDLC Installer', shellPath: 'powershell.exe' });
    expect(terminals[0].shown).toBe(true);
    expect(terminals[0].sent).toEqual([winCmd]);
    expect(calls).toEqual([]); // never awaited / never run through Shell
  });

  it('macOS and Linux: opens bash and sends bash <(curl -fsSL <sh-url>)', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      terminals.length = 0;
      const loader = new RuleLoader(makeContext());
      loader.setVariant(getVariant('amadeus'));
      await withPlatform(platform, () => { loader.launchAmadeusInstaller(); });
      expect(terminals[0].opts).toEqual({ name: 'AIDLC Installer', shellPath: '/bin/bash' });
      expect(terminals[0].sent).toEqual([
        'bash <(curl -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.sh)',
      ]);
    }
  });
});

describe('fixHookShellPath (`aidlc config runtime` is the official fix)', () => {
  const ws = { path: '/ws', fsPath: '/ws' } as unknown as import('vscode').Uri;

  it('does nothing when doctor does not report an interactive-only PATH', async () => {
    const seen: string[] = [];
    shellRun = async (c) => { seen.push(c); return { stdout: '', stderr: '' }; };
    const loader = new RuleLoader(makeContext());
    expect(await loader.fixHookShellPath(ws, '✓ all good')).toBe(false);
    expect(await loader.fixHookShellPath(ws, undefined)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('runs `aidlc config runtime` when doctor reports it, and asks for a re-check', async () => {
    const seen: string[] = [];
    shellRun = async (c) => { seen.push(c); return { stdout: 'ok', stderr: '' }; };
    const loader = new RuleLoader(makeContext());
    expect(await loader.fixHookShellPath(ws, '⚠ aidlc is interactive-only')).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/aidlc"? config runtime$/);
  });

  it('on failure falls back to the rc-file writer (a no-op on Windows)', async () => {
    shellRun = async () => { throw new Error('config runtime unsupported'); };
    const loader = new RuleLoader(makeContext());
    // Windows is forced so the fallback never touches real rc files.
    const result = await withPlatform('win32', () =>
      loader.fixHookShellPath(ws, 'aidlc resolves only through the interactive PATH')
    );
    expect(result).toBe(false);
  });
});

describe('workspace update (README: aidlc config --dry-run, then aidlc config)', () => {
  const ws = { path: '/ws', fsPath: '/ws' } as unknown as import('vscode').Uri;

  it('preview runs `config --dry-run` and flags conflicts', async () => {
    const seen: string[] = [];
    shellRun = async (c) => {
      seen.push(c);
      return { stdout: '1 file would change\n1 conflict: .kiro/agents/x.md (edited locally)', stderr: '' };
    };
    const loader = new RuleLoader(makeContext());
    const res = await loader.previewWorkspaceUpdate(ws);
    expect(seen[0]).toMatch(/config --dry-run$/);
    expect(res.conflict).toBe(true);
    expect(res.output).toContain('1 file would change');
  });

  it('apply runs `config --yes` with no --harness for an already-configured project', async () => {
    const seen: string[] = [];
    shellRun = async (c) => { seen.push(c); return { stdout: 'done', stderr: '' }; };
    const loader = new RuleLoader(makeContext());
    await loader.applyWorkspaceUpdate(ws, getVariant('amadeus'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/config --yes$/);
    expect(seen[0]).not.toContain('--harness');
  });

  it('apply falls back to the resolved harness when the CLI rejects the bare form', async () => {
    const seen: string[] = [];
    shellRun = async (c) => {
      seen.push(c);
      if (/config --yes$/.test(c)) { throw new Error('missing required option --harness'); }
      return { stdout: 'done', stderr: '' };
    };
    const loader = new RuleLoader(makeContext());
    await loader.applyWorkspaceUpdate(ws, getVariant('amadeus'));
    expect(seen.some((c) => /config --harness (kiro-ide|copilot) --yes$/.test(c))).toBe(true);
  });

  it('apply surfaces a conflict report without retrying or overwriting', async () => {
    const seen: string[] = [];
    shellRun = async (c) => { seen.push(c); throw new Error('1 conflict: file edited locally'); };
    const loader = new RuleLoader(makeContext());
    await expect(loader.applyWorkspaceUpdate(ws, getVariant('amadeus'))).rejects.toThrow(/conflicts/);
    expect(seen).toHaveLength(1);
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
