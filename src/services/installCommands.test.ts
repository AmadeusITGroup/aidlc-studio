import { describe, expect, it } from 'vitest';
import {
  aidlcBinaryCandidates,
  buildNativeInstallCommand,
  buildRepoInstallerCommand,
} from './installCommands';

describe('buildNativeInstallCommand', () => {
  const url = 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1';
  const shUrl = 'https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh';

  it('pipes the remote PowerShell installer into iex on Windows', () => {
    expect(buildNativeInstallCommand('win32', url)).toBe(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm '${url}'))) -Yes"`
    );
  });

  it('pipes the remote shell installer into sh on Unix', () => {
    expect(buildNativeInstallCommand('linux', shUrl)).toBe(`curl -fsSL ${shUrl} | sh`);
    expect(buildNativeInstallCommand('darwin', shUrl)).toBe(`curl -fsSL ${shUrl} | sh`);
  });
});

describe('aidlcBinaryCandidates', () => {
  it('lists the Windows install locations in order (LOCALAPPDATA set)', () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    // Use a path that differs from the home-derived fallback so this test
    // can't accidentally pass via the fallback path.
    process.env.LOCALAPPDATA = 'D:\\CustomAppData';
    try {
      expect(aidlcBinaryCandidates('win32', 'C:\\Users\\dev')).toEqual([
        'D:\\CustomAppData\\aidlc\\bin\\aidlc',
        'C:\\Users\\dev\\.aidlc\\bin\\aidlc.exe',
        'D:\\CustomAppData\\aidlc\\aidlc.exe',
      ]);
    } finally {
      if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
    }
  });

  it('falls back to home-derived path when LOCALAPPDATA is unset', () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    delete process.env.LOCALAPPDATA;
    try {
      expect(aidlcBinaryCandidates('win32', 'C:\\Users\\dev')).toEqual([
        'C:\\Users\\dev\\AppData\\Local\\aidlc\\bin\\aidlc',
        'C:\\Users\\dev\\.aidlc\\bin\\aidlc.exe',
        'C:\\Users\\dev\\AppData\\Local\\aidlc\\aidlc.exe',
      ]);
    } finally {
      if (originalLocalAppData !== undefined) {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
    }
  });

  it('lists the Unix install locations in order', () => {
    expect(aidlcBinaryCandidates('linux', '/home/dev')).toEqual([
      '/home/dev/.aidlc/bin/aidlc',
      '/home/dev/.local/bin/aidlc',
      '/usr/local/bin/aidlc',
    ]);
    expect(aidlcBinaryCandidates('darwin', '/Users/dev')).toEqual([
      '/Users/dev/.aidlc/bin/aidlc',
      '/Users/dev/.local/bin/aidlc',
      '/usr/local/bin/aidlc',
    ]);
  });
});

describe('buildRepoInstallerCommand', () => {
  it('runs the cloned install-aidlc.ps1 with -File on Windows', () => {
    expect(
      buildRepoInstallerCommand('win32', 'C:\\tmp\\clone\\scripts', 'C:\\ws', 'kiro-ide')
    ).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\tmp\\clone\\scripts\\install-aidlc.ps1" -Target "C:\\ws" -Harness kiro-ide'
    );
  });

  it('runs the cloned install-aidlc.sh with sh on Unix', () => {
    expect(
      buildRepoInstallerCommand('linux', '/tmp/clone/scripts', '/ws', 'kiro-ide')
    ).toBe('sh "/tmp/clone/scripts/install-aidlc.sh" --target "/ws" --harness kiro-ide');
  });
});
