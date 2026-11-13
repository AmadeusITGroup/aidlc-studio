import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the mocked Shell.run per test.
let shellRun: (command: string) => Promise<{ stdout: string; stderr: string }>;

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  ProgressLocation: { Notification: 15 },
  window: {
    // Run the progress task immediately with a no-op progress reporter.
    withProgress: (_opts: unknown, task: (progress: { report: () => void }) => unknown) =>
      task({ report: () => { /* noop */ } }),
  },
  workspace: {
    workspaceFolders: [{ uri: { path: '/ws', fsPath: '/ws' } }],
    getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }),
    fs: {
      // No install metadata / binary candidate files exist on disk → the
      // on-disk reader returns null and the probe uses bare-PATH `aidlc`.
      stat: async () => { throw new Error('ENOENT'); },
      readFile: async () => { throw new Error('ENOENT'); },
      readDirectory: async () => { throw new Error('ENOENT'); },
    },
  },
}));

vi.mock('./shell', () => ({
  Shell: {
    run: (command: string) => shellRun(command),
    // runStreaming shares the same driver so the native `aidlc update` path can
    // be exercised through shellRun.
    runStreaming: (command: string) => shellRun(command),
  },
}));

import { UpdateChecker, parseCliUpdateCheck } from './updateChecker';
import { RuleLoader, RepoAccessError } from './ruleLoader';
import { getVariant } from './variants';

function makeChannel() {
  return { appendLine: () => { /* noop */ } } as unknown as import('vscode').OutputChannel;
}

/**
 * Minimal RuleLoader stub that records the variant it was asked to install and
 * whether installViaRepoInstaller ran. Lets the repo-based update path be
 * verified without touching the real clone/installer.
 */
function makeRuleLoaderStub(opts: { fail?: Error } = {}) {
  const calls = { setVariantCount: 0, installCount: 0, configureCount: 0, lastVariant: null as unknown };
  const stub = {
    setVariant(variant: unknown) {
      calls.setVariantCount++;
      calls.lastVariant = variant;
    },
    async configureWorkspaceForVariant() {
      calls.configureCount++;
    },
    async installViaRepoInstaller() {
      calls.installCount++;
      if (opts.fail) { throw opts.fail; }
    },
  } as unknown as RuleLoader;
  return { stub, calls };
}

beforeEach(() => {
  shellRun = async () => { throw new Error('no command configured'); };
});

describe('UpdateChecker — CLI-first update check (`aidlc update --check`)', () => {
  // The CHECK is fully CLI-first for BOTH variants: no Artifactory feed scrape,
  // no GitHub releases lookup. A `curl` to a feed or a `releases/latest` /
  // `ls-remote` call is a test failure.
  const forbidManualChecks = (cmd: string) => {
    if (
      cmd.includes('curl') ||
      cmd.includes('releases/latest') ||
      cmd.includes('ls-remote') ||
      /\bgit\s/.test(cmd)
    ) {
      throw new Error(`forbidden manual feed/GitHub check: ${cmd}`);
    }
  };

  it('AWS present: `aidlc update --check` reports an available update', async () => {
    shellRun = async (cmd) => {
      forbidManualChecks(cmd);
      if (cmd.includes('update --check')) {
        return { stdout: 'Update available: 2.9.0 -> 2.9.1', stderr: '' };
      }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.9.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('aws'));
    const info = await checker.checkForUpdates();
    expect(info.variantDisplayId).toBe('aws');
    expect(info.cliAbsent).toBeFalsy();
    expect(info.currentVersion).toBe('2.9.0');
    expect(info.latestVersion).toBe('2.9.1');
    expect(info.updateAvailable).toBe(true);
  });

  it('Amadeus present: `aidlc update --check` reports up to date', async () => {
    shellRun = async (cmd) => {
      forbidManualChecks(cmd);
      if (cmd.includes('update --check')) {
        return { stdout: 'You are up-to-date (2.10.0).', stderr: '' };
      }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('amadeus'));
    const info = await checker.checkForUpdates();
    expect(info.variantDisplayId).toBe('amadeus');
    expect(info.currentVersion).toBe('2.10.0');
    expect(info.updateAvailable).toBe(false);
  });

  it('uses PRECEDENCE when the CLI gives only a latest token, not a raw !==', async () => {
    // CLI prints just the latest token; installed is a newer build. A raw
    // `!==` would nag — precedence must suppress it.
    shellRun = async (cmd) => {
      forbidManualChecks(cmd);
      if (cmd.includes('update --check')) {
        return { stdout: 'latest: 2.10.0', stderr: '' };
      }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.11.0-1a.2.0.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('amadeus'));
    const info = await checker.checkForUpdates();
    expect(info.currentVersion).toBe('2.11.0-1a.2.0.0');
    expect(info.latestVersion).toBe('2.10.0');
    expect(info.updateAvailable).toBe(false);
  });

  it('CLI check ERRORS → latest unknown, no fallback feed/GitHub scrape', async () => {
    shellRun = async (cmd) => {
      forbidManualChecks(cmd);
      if (cmd.includes('update --check')) { throw new Error('check failed'); }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('amadeus'));
    const info = await checker.checkForUpdates();
    expect(info.currentVersion).toBe('2.10.0');
    expect(info.latestVersion).toBe('unknown');
    expect(info.updateAvailable).toBe(false);
  });

  it('CLI ABSENT → cliAbsent, no latest, and NO network/feed/GitHub lookup', async () => {
    // Nothing answers --version (no binary, no metadata) → CLI absent. The only
    // probe allowed is detection; a feed/GitHub lookup is a failure.
    shellRun = async (cmd) => {
      forbidManualChecks(cmd);
      // Even a bare `aidlc --version` fails → detectCliPresence reports absent.
      throw new Error(`no cli: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('aws'));
    const info = await checker.checkForUpdates();
    expect(info.cliAbsent).toBe(true);
    expect(info.currentVersion).toBeNull();
    expect(info.latestVersion).toBe('unknown');
    expect(info.updateAvailable).toBe(false);
  });
});

describe('UpdateChecker — Amadeus (CLI model) update runs `aidlc update`', () => {
  it('routes the Amadeus update through `aidlc update`, never a clone/dist-copy', async () => {
    // 2.10+ Amadeus upgrades with the CLI, exactly like AWS. A git clone, a
    // dist-copy, or any RuleLoader reinstall is a test failure.
    const ran = { update: false };
    shellRun = async (cmd) => {
      if (cmd.includes('git clone') || cmd.includes('Copy-Item')) {
        throw new Error(`forbidden clone/dist-copy on the Amadeus update path: ${cmd}`);
      }
      if (cmd.includes('update')) { ran.update = true; return { stdout: 'updated', stderr: '' }; }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.11.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '2.10.0 2.11.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    const variant = getVariant('amadeus');
    const checker = new UpdateChecker(makeChannel(), variant, stub);

    const ok = await checker.pullLatest();

    expect(ok).toBe(true);
    expect(ran.update).toBe(true);
    // The CLI path must never touch the RuleLoader reinstall.
    expect(calls.installCount).toBe(0);
    expect(calls.setVariantCount).toBe(0);
  });

  it('CLI-first: refreshes the workspace via aidlc config after `aidlc update`', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('update')) { return { stdout: 'updated', stderr: '' }; }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.11.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '2.10.0 2.11.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    const checker = new UpdateChecker(
      makeChannel(),
      getVariant('amadeus'),
      stub
    );

    await checker.pullLatest();

    // CLI upgrade ran AND the workspace was refreshed with `aidlc config`.
    expect(calls.configureCount).toBe(1);
    expect(calls.installCount).toBe(0);
  });

  it('CLI-first FALLBACK: a failed `aidlc update` reinstalls via the repo path', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('update')) { throw new Error('aidlc update boom'); }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.11.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '2.10.0 2.11.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    const checker = new UpdateChecker(
      makeChannel(),
      getVariant('amadeus'),
      stub
    );

    await checker.pullLatest();

    // Fell back to the clone/dist reinstall path.
    expect(calls.installCount).toBe(1);
  });

  it('routes a custom (git-clone-copy) variant through the RuleLoader reinstall path', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 1.0.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '1.0.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    // A git-clone-copy variant (custom fork) still uses the reinstall path.
    const variant = { ...getVariant('amadeus'), installMethod: 'git-clone-copy' as const };
    const checker = new UpdateChecker(makeChannel(), variant, stub);

    await checker.pullLatest();

    expect(calls.installCount).toBe(1);
    expect(calls.setVariantCount).toBe(1);
  });

  it('propagates RepoAccessError from the custom reinstall path', async () => {
    const accessError = new RepoAccessError('no access', 'Custom', 'https://example');
    const { stub } = makeRuleLoaderStub({ fail: accessError });
    const checker = new UpdateChecker(
      makeChannel(),
      { ...getVariant('amadeus'), installMethod: 'git-clone-copy' as const },
      stub
    );

    await expect(checker.pullLatest()).rejects.toBe(accessError);
  });
});

describe('UpdateChecker — AWS native update path is unchanged', () => {
  it('does NOT use the RuleLoader and runs `aidlc update`', async () => {
    const ranUpdate = { value: false };
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.9.1', stderr: '' }; }
      if (cmd.includes('releases/latest')) {
        return { stdout: JSON.stringify({ tag_name: 'v2.9.1', html_url: 'u' }), stderr: '' };
      }
      if (cmd.includes('update')) {
        ranUpdate.value = true;
        return { stdout: 'updated', stderr: '' };
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    const checker = new UpdateChecker(makeChannel(), getVariant('aws'), stub);

    const ok = await checker.pullLatest();

    expect(ok).toBe(true);
    expect(ranUpdate.value).toBe(true);
    // The AWS/native path must never touch the RuleLoader.
    expect(calls.installCount).toBe(0);
    expect(calls.setVariantCount).toBe(0);
  });
});

describe('parseCliUpdateCheck — tolerant parser for `aidlc update --check`', () => {
  it('detects an explicit "update available" and reads the TARGET of an upgrade arrow', () => {
    const r = parseCliUpdateCheck('An update is available: 2.9.0 -> 2.9.1');
    expect(r.updateAvailable).toBe(true);
    // The latest is the arrow TARGET, not the source.
    expect(r.latestVersion).toBe('2.9.1');
  });

  it('detects "up-to-date" and reads "no update available" as NOT available', () => {
    expect(parseCliUpdateCheck('aidlc is up-to-date (2.10.0)').updateAvailable).toBe(false);
    expect(parseCliUpdateCheck('No update available.').updateAvailable).toBe(false);
    expect(parseCliUpdateCheck("You're on the latest version 2.10.0").updateAvailable).toBe(false);
  });

  it('parses a pre-release tail version token', () => {
    const r = parseCliUpdateCheck('update available 2.11.0-1a.2.0.0');
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe('2.11.0-1a.2.0.0');
  });

  it('returns all-null when there is no signal and no version', () => {
    const r = parseCliUpdateCheck('checking...');
    expect(r.updateAvailable).toBeNull();
    expect(r.latestVersion).toBeNull();
  });

  it('is null-safe on empty/garbage input', () => {
    expect(parseCliUpdateCheck('').updateAvailable).toBeNull();
    expect(parseCliUpdateCheck(undefined as unknown as string).latestVersion).toBeNull();
  });
});

describe('UpdateChecker — update check runs on macOS and Windows alike', () => {
  // The binary is resolved by ABSOLUTE PATH first, then bare `aidlc` — so the
  // `aidlc update --check` invocation works on either OS even when the CLI is
  // not on this process's PATH. Here no candidate files exist on disk, so both
  // platforms fall through to the bare-PATH `aidlc update --check`.
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    it(`[${platform}] sources the check from \`aidlc update --check\``, async () => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      try {
        const seen: string[] = [];
        shellRun = async (cmd) => {
          seen.push(cmd);
          if (cmd.includes('update --check')) {
            return { stdout: 'Update available: 2.9.1', stderr: '' };
          }
          if (cmd.includes('--version')) { return { stdout: 'aidlc 2.9.0', stderr: '' }; }
          throw new Error(`unexpected: ${cmd}`);
        };
        const checker = new UpdateChecker(makeChannel(), getVariant('aws'));
        const info = await checker.checkForUpdates();
        expect(info.updateAvailable).toBe(true);
        expect(info.latestVersion).toBe('2.9.1');
        // The check was sourced from the CLI, not a feed/GitHub call.
        expect(seen.some((c) => c.includes('update --check'))).toBe(true);
      } finally {
        if (original) { Object.defineProperty(process, 'platform', original); }
      }
    });
  }
});
