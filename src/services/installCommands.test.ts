import { describe, expect, it } from 'vitest';
import {
  aidlcBinaryCandidates,
  buildAmadeusMachineSetupCommand,
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

describe('buildAmadeusMachineSetupCommand', () => {
  // The Amadeus 2.10+ machine setup installs the CLI only (no -Target/-Harness
  // legacy flags); the project is configured afterwards with `aidlc config`.
  const winScript =
    'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli/install-aidlc.ps1';
  const shScript =
    'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli/install-aidlc.sh';

  it('runs install-aidlc.ps1 with -SkipCredentials on Windows (no -Target/-Harness)', () => {
    const cmd = buildAmadeusMachineSetupCommand('win32', winScript);
    expect(cmd).toBe(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${winScript}" -SkipCredentials`
    );
    expect(cmd).not.toContain('-Target');
    expect(cmd).not.toContain('-Harness');
  });

  it('runs install-aidlc.sh with --skip-credentials on Unix', () => {
    expect(buildAmadeusMachineSetupCommand('linux', shScript)).toBe(
      `sh "${shScript}" --skip-credentials`
    );
    expect(buildAmadeusMachineSetupCommand('darwin', shScript)).toBe(
      `sh "${shScript}" --skip-credentials`
    );
  });
});

describe('buildRepoInstallerCommand (legacy custom-fork path)', () => {
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
