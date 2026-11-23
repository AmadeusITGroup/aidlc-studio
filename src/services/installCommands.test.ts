import { describe, expect, it } from 'vitest';
import {
  aidlcBinaryCandidates,
  amadeusInstallNextSteps,
  amadeusManualInstallHint,
  buildAccessProbeCommand,
  buildAmadeusInstallerTerminal,
  buildNativeInstallCommand,
  buildRepoInstallerCommand,
  doctorReportsInteractiveOnlyPath,
  reportsConfigConflict,
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

describe('buildAmadeusInstallerTerminal (README section 1)', () => {
  const urls = {
    unix: 'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.sh',
    windows:
      'https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.ps1',
  };

  it('Windows: PowerShell, download-then-run, exactly the README one-liner', () => {
    const t = buildAmadeusInstallerTerminal('win32', urls);
    expect(t.shellPath).toBe('powershell.exe');
    expect(t.command).toBe(
      '$f = Join-Path $env:TEMP "install-aidlc.ps1"; ' +
        `curl.exe -fsSL ${urls.windows} -o $f; ` +
        'powershell -ExecutionPolicy Bypass -File $f; Remove-Item $f'
    );
  });

  it('macOS and Linux: bash with process substitution, exactly the README command', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const t = buildAmadeusInstallerTerminal(platform, urls);
      expect(t.shellPath).toBe('/bin/bash');
      expect(t.command).toBe(`bash <(curl -fsSL ${urls.unix})`);
    }
  });

  it('never uses irm|iex, -File <url>, curl | sh, skip flags or preview', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const { command } = buildAmadeusInstallerTerminal(platform, urls);
      expect(command).not.toMatch(/\birm\b|\biex\b|\| sh|-File https?:|skip-|-Skip|preview|-Preview/i);
    }
  });
});

describe('amadeus install messaging', () => {
  const urls = { unix: 'https://x/install-aidlc.sh', windows: 'https://x/install-aidlc.ps1' };

  it('manual hint embeds the exact command for the OS', () => {
    expect(amadeusManualInstallHint('win32', urls)).toContain(
      buildAmadeusInstallerTerminal('win32', urls).command
    );
    expect(amadeusManualInstallHint('win32', urls)).toContain('not as administrator');
    expect(amadeusManualInstallHint('darwin', urls)).toContain('bash <(curl -fsSL https://x/install-aidlc.sh)');
  });

  it('next steps differ per OS and mention eve credentials + re-running Setup', () => {
    const win = amadeusInstallNextSteps('win32');
    expect(win).toContain('quit and reopen');
    expect(win).toContain('not as administrator');
    const mac = amadeusInstallNextSteps('darwin');
    expect(mac).toContain('open a new terminal');
    expect(amadeusInstallNextSteps('linux')).toContain('open a new terminal');
    for (const s of [win, mac]) {
      expect(s).toContain('Setup again');
      expect(s).toContain('eve credentials amaiisdom <your-username>');
    }
  });
});

describe('buildAccessProbeCommand', () => {
  it('uses curl.exe on Windows and curl elsewhere, with a short timeout', () => {
    expect(buildAccessProbeCommand('win32', 'https://h/p')).toBe(
      'curl.exe -fsS -I --max-time 10 "https://h/p"'
    );
    expect(buildAccessProbeCommand('darwin', 'https://h/p')).toBe(
      'curl -fsS -I --max-time 10 "https://h/p"'
    );
    expect(buildAccessProbeCommand('linux', 'https://h/p')).toBe(
      'curl -fsS -I --max-time 10 "https://h/p"'
    );
  });
});

describe('doctor / config output classifiers', () => {
  it('detects the interactive-only PATH report', () => {
    expect(doctorReportsInteractiveOnlyPath('⚠ aidlc is interactive-only (not on the hook PATH)')).toBe(true);
    expect(doctorReportsInteractiveOnlyPath('aidlc resolves only through the interactive PATH')).toBe(true);
    expect(doctorReportsInteractiveOnlyPath('✓ all good')).toBe(false);
    expect(doctorReportsInteractiveOnlyPath(undefined)).toBe(false);
  });

  it('detects conflict reports', () => {
    expect(reportsConfigConflict('2 conflicts: .kiro/x edited locally')).toBe(true);
    expect(reportsConfigConflict('nothing to change')).toBe(false);
    expect(reportsConfigConflict(undefined)).toBe(false);
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
