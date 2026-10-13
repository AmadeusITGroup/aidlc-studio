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
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${url} | iex"`
    );
  });

  it('pipes the remote shell installer into sh on Unix', () => {
    expect(buildNativeInstallCommand('linux', shUrl)).toBe(`curl -fsSL ${shUrl} | sh`);
    expect(buildNativeInstallCommand('darwin', shUrl)).toBe(`curl -fsSL ${shUrl} | sh`);
  });
});

describe('aidlcBinaryCandidates', () => {
  it('lists the Windows install locations in order', () => {
    expect(aidlcBinaryCandidates('win32', 'C:\\Users\\dev')).toEqual([
      'C:\\Users\\dev\\.aidlc\\bin\\aidlc.exe',
      'C:\\Users\\dev\\AppData\\Local\\aidlc\\aidlc.exe',
    ]);
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
