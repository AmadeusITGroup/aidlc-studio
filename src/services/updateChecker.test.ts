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

import { UpdateChecker } from './updateChecker';
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
  const calls = { setVariantCount: 0, installCount: 0, lastVariant: null as unknown };
  const stub = {
    setVariant(variant: unknown) {
      calls.setVariantCount++;
      calls.lastVariant = variant;
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

describe('UpdateChecker — AWS native path', () => {
  it('reports aws display id and uses the GitHub release', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.9.0', stderr: '' }; }
      if (cmd.includes('releases/latest')) {
        return { stdout: JSON.stringify({ tag_name: 'v2.9.1', html_url: 'u' }), stderr: '' };
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), getVariant('aws'));
    const info = await checker.checkForUpdates();
    expect(info.variantDisplayId).toBe('aws');
    expect(info.channel).toBe('release');
    expect(info.currentVersion).toBe('2.9.0');
    expect(info.latestVersion).toBe('2.9.1');
    expect(info.updateAvailable).toBe(true);
  });
});

describe('UpdateChecker — Amadeus Artifactory path', () => {
  it('picks the latest RELEASE build for the release channel', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0', stderr: '' }; }
      if (cmd.includes('curl')) {
        // Feed lists a release and a preview; release channel must ignore preview.
        return { stdout: '2.10.0 2.11.0 2.12.0-1a.1.0.0', stderr: '' };
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), { ...getVariant('amadeus'), channel: 'release' });
    const info = await checker.checkForUpdates();
    expect(info.variantDisplayId).toBe('amadeus');
    expect(info.channel).toBe('release');
    expect(info.currentVersion).toBe('2.10.0');
    expect(info.latestVersion).toBe('2.11.0');
    expect(info.updateAvailable).toBe(true);
  });

  it('picks the latest PREVIEW build and detects a newer preview', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0-1a.1.0.0', stderr: '' }; }
      if (cmd.includes('curl')) {
        return { stdout: '2.10.0 2.10.0-1a.1.0.0 2.11.0-1a.2.0.0', stderr: '' };
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), { ...getVariant('amadeus'), channel: 'preview' });
    const info = await checker.checkForUpdates();
    expect(info.variantDisplayId).toBe('amadeus-preview');
    expect(info.channel).toBe('preview');
    expect(info.currentVersion).toBe('2.10.0-1a.1.0.0');
    expect(info.latestVersion).toBe('2.11.0-1a.2.0.0');
    expect(info.updateAvailable).toBe(true);
  });

  it('degrades gracefully to unknown latest when the feed throws', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0', stderr: '' }; }
      if (cmd.includes('curl')) { throw new Error('network down'); }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), { ...getVariant('amadeus'), channel: 'release' });
    const info = await checker.checkForUpdates();
    expect(info.currentVersion).toBe('2.10.0');
    expect(info.latestVersion).toBe('unknown');
    expect(info.updateAvailable).toBe(false);
  });

  it('never falls back to a GitHub/git tag lookup (no bogus 7.161.26)', async () => {
    // Guard against BUG B: the Amadeus path must only consult the Artifactory
    // feed. A GitHub releases call or `git ls-remote` is a test failure.
    shellRun = async (cmd) => {
      if (cmd.includes('releases/latest') || cmd.includes('ls-remote') || cmd.includes('git ')) {
        throw new Error(`forbidden GitHub/git lookup on the Amadeus path: ${cmd}`);
      }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0-1a.1.1.0-preview.3', stderr: '' }; }
      if (cmd.includes('curl')) { throw new Error('feed unreachable'); }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), { ...getVariant('amadeus'), channel: 'preview' });
    const info = await checker.checkForUpdates();
    // Current from binary, latest degrades to 'unknown' — never a GitHub tag.
    expect(info.currentVersion).toBe('2.10.0-1a.1.1.0-preview.3');
    expect(info.latestVersion).toBe('unknown');
    expect(info.variantDisplayId).toBe('amadeus-preview');
  });

  it('degrades gracefully when the feed returns an unexpected shape', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.10.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '<html>no versions here</html>', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const checker = new UpdateChecker(makeChannel(), { ...getVariant('amadeus'), channel: 'release' });
    const info = await checker.checkForUpdates();
    expect(info.latestVersion).toBe('unknown');
    expect(info.updateAvailable).toBe(false);
  });
});

describe('UpdateChecker — repo-based update delegates to reinstall', () => {
  it('routes the Amadeus update through RuleLoader.installViaRepoInstaller', async () => {
    // The version re-check after install resolves current from the binary and
    // latest from the feed; neither a git clone nor a blind dist-copy runs.
    shellRun = async (cmd) => {
      if (cmd.includes('git clone') || cmd.includes('Copy-Item')) {
        throw new Error(`forbidden standalone dist-copy on the update path: ${cmd}`);
      }
      if (cmd.includes('--version')) { return { stdout: 'aidlc 2.11.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '2.10.0 2.11.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    const variant = { ...getVariant('amadeus'), channel: 'release' as const };
    const checker = new UpdateChecker(makeChannel(), variant, stub);

    const ok = await checker.pullLatest();

    expect(ok).toBe(true);
    // The reinstall path ran exactly once...
    expect(calls.installCount).toBe(1);
    // ...and the loader was synced to the active variant before installing.
    expect(calls.setVariantCount).toBe(1);
    expect(calls.lastVariant).toBe(variant);
  });

  it('routes a custom variant through the same reinstall path', async () => {
    shellRun = async (cmd) => {
      if (cmd.includes('--version')) { return { stdout: 'aidlc 1.0.0', stderr: '' }; }
      if (cmd.includes('curl')) { return { stdout: '1.0.0', stderr: '' }; }
      throw new Error(`unexpected: ${cmd}`);
    };
    const { stub, calls } = makeRuleLoaderStub();
    // A git-clone-copy variant (custom fork) must also use the reinstall path.
    const variant = { ...getVariant('amadeus'), installMethod: 'git-clone-copy' as const };
    const checker = new UpdateChecker(makeChannel(), variant, stub);

    await checker.pullLatest();

    expect(calls.installCount).toBe(1);
  });

  it('propagates RepoAccessError from the reinstall path', async () => {
    const accessError = new RepoAccessError('no access', 'Amadeus AIDLC', 'https://example');
    const { stub } = makeRuleLoaderStub({ fail: accessError });
    const checker = new UpdateChecker(
      makeChannel(),
      { ...getVariant('amadeus'), channel: 'release' },
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
