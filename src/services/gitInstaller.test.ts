import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the mocked child_process.exec per test. Keyed on the command string.
let execImpl: (command: string) => { stdout: string; stderr: string };

vi.mock('child_process', () => ({
  // promisify(exec) expects the Node callback signature
  // (err, { stdout, stderr }); our shim resolves/rejects through that.
  exec: (
    command: string,
    _options: unknown,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    try {
      callback(null, execImpl(command));
    } catch (e) {
      callback(e instanceof Error ? e : new Error(String(e)));
    }
  },
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => { /* noop */ } }),
  },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  ProgressLocation: { Notification: 15 },
}));

import { GitInstaller, gitDownloadUrl, parseGitVersion } from './gitInstaller';

function makeChannel() {
  return { appendLine: () => { /* noop */ } } as unknown as import('vscode').OutputChannel;
}

beforeEach(() => {
  execImpl = () => { throw new Error('no command configured'); };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseGitVersion', () => {
  it('extracts the semver from a standard Unix git version string', () => {
    expect(parseGitVersion('git version 2.43.0')).toBe('2.43.0');
  });

  it('extracts the semver from a Windows git version string', () => {
    expect(parseGitVersion('git version 2.43.0.windows.1')).toBe('2.43.0');
  });

  it('returns undefined when no version token is present', () => {
    expect(parseGitVersion('git: command not found')).toBeUndefined();
    expect(parseGitVersion('')).toBeUndefined();
  });
});

describe('gitDownloadUrl', () => {
  it('returns the Windows link on win32', () => {
    expect(gitDownloadUrl('win32')).toBe('https://git-scm.com/download/win');
  });

  it('returns the macOS link on darwin', () => {
    expect(gitDownloadUrl('darwin')).toBe('https://git-scm.com/download/mac');
  });

  it('returns the Linux link on any other platform', () => {
    expect(gitDownloadUrl('linux')).toBe('https://git-scm.com/download/linux');
  });
});

describe('GitInstaller.check', () => {
  it('reports installed with parsed version and resolved path when git is present', async () => {
    execImpl = (cmd) => {
      if (cmd.includes('git --version')) { return { stdout: 'git version 2.43.0\n', stderr: '' }; }
      if (cmd.startsWith('where git') || cmd.startsWith('which git')) {
        return { stdout: '/usr/bin/git\n', stderr: '' };
      }
      throw new Error(`unexpected: ${cmd}`);
    };

    const result = await new GitInstaller(makeChannel()).check();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('2.43.0');
    expect(result.path).toBe('/usr/bin/git');
  });

  it('still reports installed when the path lookup fails', async () => {
    execImpl = (cmd) => {
      if (cmd.includes('git --version')) { return { stdout: 'git version 2.40.1\n', stderr: '' }; }
      throw new Error('which failed');
    };

    const result = await new GitInstaller(makeChannel()).check();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('2.40.1');
    expect(result.path).toBeUndefined();
  });

  it('swallows failures to { installed: false } when git is absent', async () => {
    execImpl = () => { throw new Error('git: command not found'); };

    const result = await new GitInstaller(makeChannel()).check();
    expect(result).toEqual({ installed: false });
  });
});
