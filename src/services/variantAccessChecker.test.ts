import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the mocked Shell.run per test.
let shellRun: (command: string) => Promise<{ stdout: string; stderr: string }>;

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }),
  },
}));

vi.mock('./shell', () => ({
  Shell: {
    run: (command: string) => shellRun(command),
  },
}));

import {
  GIT_UNAVAILABLE_SKIP,
  VariantAccessChecker,
  classifyAccessFailure,
  isAccessGated,
  isGitUnavailable,
} from './variantAccessChecker';
import { getVariant, AidlcVariant } from './variants';

function makeChannel() {
  return { appendLine: () => { /* noop */ } } as unknown as import('vscode').OutputChannel;
}

const amadeus = getVariant('amadeus');

beforeEach(() => {
  shellRun = async () => { throw new Error('no command configured'); };
});

describe('classifyAccessFailure', () => {
  const variant = { label: 'Amadeus AIDLC', repoUrl: 'https://example.com/private' };

  it('classifies authentication failures as a friendly access message', () => {
    for (const msg of [
      'remote: Authentication failed',
      'fatal: could not read Username',
      'HTTP 403',
      'error 401 Unauthorized',
      'terminal prompts disabled',
    ]) {
      const reason = classifyAccessFailure(msg, variant);
      expect(reason).toContain("don't have access");
      expect(reason).toContain(variant.label);
    }
  });

  it('classifies not-found failures with the repo URL', () => {
    for (const msg of ['Repository not found', 'remote: not found', 'repo does not exist']) {
      const reason = classifyAccessFailure(msg, variant);
      expect(reason).toContain('not found or is inaccessible');
      expect(reason).toContain(variant.repoUrl);
    }
  });

  it('returns undefined for an unrelated failure', () => {
    expect(classifyAccessFailure('some transient network blip', variant)).toBeUndefined();
  });
});

describe('isGitUnavailable', () => {
  it('matches the shapes produced when the git executable cannot be spawned', () => {
    for (const msg of [
      'spawn git ENOENT',
      "'git' is not recognized as an internal or external command",
      '/bin/sh: git: command not found',
      'Error: ENOENT',
    ]) {
      expect(isGitUnavailable(msg)).toBe(true);
    }
  });

  it('does NOT match a remote auth/not-found response (git ran fine)', () => {
    expect(isGitUnavailable('fatal: Authentication failed')).toBe(false);
    expect(isGitUnavailable('Repository not found')).toBe(false);
    expect(isGitUnavailable('connection reset')).toBe(false);
  });
});

describe('isAccessGated', () => {
  it('is false for AWS (public)', () => {
    expect(isAccessGated(getVariant('aws'))).toBe(false);
  });

  it('is true for the Amadeus CLI variant', () => {
    expect(isAccessGated(amadeus)).toBe(true);
  });

  it('is true for repo-installer and git-clone-copy methods', () => {
    expect(isAccessGated({ id: 'x', installMethod: 'repo-installer' })).toBe(true);
    expect(isAccessGated({ id: 'custom', installMethod: 'git-clone-copy' })).toBe(true);
  });
});

describe('VariantAccessChecker.check', () => {
  it('returns accessible for AWS without any network call', async () => {
    let called = false;
    shellRun = async () => { called = true; return { stdout: '', stderr: '' }; };

    const result = await new VariantAccessChecker(makeChannel()).check(getVariant('aws'));
    expect(result).toEqual({ accessible: true });
    expect(called).toBe(false);
  });

  // --- Amadeus (CLI model): the Artifactory installer URL must be reachable ---

  it('Amadeus: probes the installer URL with curl (never git ls-remote or GitHub)', async () => {
    const seen: string[] = [];
    shellRun = async (cmd) => { seen.push(cmd); return { stdout: 'HTTP/2 200', stderr: '' }; };

    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      seen.length = 0;
      const result = await new VariantAccessChecker(makeChannel()).check(amadeus, platform);
      expect(result).toEqual({ accessible: true });
      expect(seen).toHaveLength(1);
      const url = platform === 'win32'
        ? amadeus.installScriptUrl!.windows
        : amadeus.installScriptUrl!.unix;
      expect(seen[0]).toContain('--max-time 10');
      expect(seen[0]).toContain(`"${url}"`);
      expect(seen[0].startsWith(platform === 'win32' ? 'curl.exe ' : 'curl ')).toBe(true);
      expect(seen[0]).not.toContain('git ');
      expect(seen[0]).not.toContain('github.com');
    }
  });

  it('Amadeus: DNS / connect / timeout / HTTP 4xx all map to the friendly no-access reason', async () => {
    for (const msg of [
      'curl: (6) Could not resolve host: repository.rnd.amadeus.net',
      'curl: (7) Failed to connect',
      'curl: (28) Connection timed out after 10001 milliseconds',
      'curl: (22) The requested URL returned error: 403',
      'curl: (22) The requested URL returned error: 401',
    ]) {
      shellRun = async () => { throw new Error(msg); };
      const result = await new VariantAccessChecker(makeChannel()).check(amadeus, 'darwin');
      expect(result.accessible).toBe(false);
      expect(result.reason).toContain("don't have access");
      expect(result.reason).toContain(amadeus.installScriptUrl!.unix);
      // Must NOT leak the raw curl output
      expect(result.reason).not.toContain('curl:');
    }
  });

  it('Amadeus: a missing curl skips the pre-check instead of reporting no access', async () => {
    shellRun = async () => {
      throw new Error("'curl.exe' is not recognized as an internal or external command");
    };
    const result = await new VariantAccessChecker(makeChannel()).check(amadeus, 'win32');
    expect(result.accessible).toBe(true);
    expect(result.reason).toBe(GIT_UNAVAILABLE_SKIP);
  });

  // --- Custom git-clone-copy fork keeps the git ls-remote behavior ---

  const custom: AidlcVariant = { ...amadeus, id: 'custom', installMethod: 'git-clone-copy' };

  it('custom: returns accessible when git ls-remote succeeds', async () => {
    shellRun = async (cmd) => {
      expect(cmd).toContain('git ls-remote');
      return { stdout: 'abc123\tHEAD\n', stderr: '' };
    };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    expect(result).toEqual({ accessible: true });
  });

  it('custom: returns a friendly auth reason when ls-remote fails with auth error', async () => {
    shellRun = async () => { throw new Error('fatal: Authentication failed'); };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    expect(result.accessible).toBe(false);
    expect(result.reason).toContain("don't have access");
  });

  it('custom: returns a clean generic reason for an unclassified failure', async () => {
    shellRun = async () => { throw new Error('connection reset'); };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    expect(result.accessible).toBe(false);
    expect(result.reason).toContain("don't have access");
    // Must NOT leak the raw git output
    expect(result.reason).not.toContain('connection reset');
  });

  it('custom: skips the pre-check (accessible) when git is not installed', async () => {
    shellRun = async () => { throw new Error('spawn git ENOENT'); };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    // Missing git must NOT be reported as "no access" — setup proceeds and the
    // install-time RepoAccessError remains the authoritative backstop.
    expect(result.accessible).toBe(true);
    expect(result.reason).toBe(GIT_UNAVAILABLE_SKIP);
  });

  it('custom: skips the pre-check on the Windows "not recognized" git message', async () => {
    shellRun = async () => {
      throw new Error("'git' is not recognized as an internal or external command");
    };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    expect(result.accessible).toBe(true);
    expect(result.reason).toBe(GIT_UNAVAILABLE_SKIP);
  });

  it('custom: a not-found repo is reported as inaccessible', async () => {
    shellRun = async () => { throw new Error('Repository not found'); };

    const result = await new VariantAccessChecker(makeChannel()).check(custom);
    expect(result.accessible).toBe(false);
    expect(result.reason).toContain('not found or is inaccessible');
  });
});
