import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Controllable test doubles the mocks read from ---
let cliPresent: boolean;
let detectedVariantId: 'aws' | 'amadeus' | null;
let quickPickId: string | undefined; // what the variant picker returns
let doctorPassed: boolean;
let accessResult: { accessible: boolean; reason?: string };

// Spy calls recorded on the fake RuleLoader.
const calls: string[] = [];

vi.mock('vscode', () => {
  return {
    Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
    ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { Workspace: 2 },
    workspace: {
      workspaceFolders: [{ uri: { path: '/ws', fsPath: '/ws' } }],
      getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }),
    },
    window: {
      createOutputChannel: () => makeOutputChannel(),
      showQuickPick: async () =>
        quickPickId ? { id: quickPickId, label: quickPickId, detail: '' } : undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      withProgress: async (
        _opts: unknown,
        task: (progress: { report: () => void }, token: { isCancellationRequested: boolean }) => Promise<unknown>
      ) => task({ report: () => undefined }, { isCancellationRequested: false }),
    },
    env: { appName: 'Visual Studio Code', clipboard: { writeText: async () => undefined } },
  };
});

vi.mock('../services/cliPresence', () => ({
  detectCliPresence: async () => ({
    present: cliPresent,
    variantId: detectedVariantId,
    version: null,
    source: cliPresent ? 'binary' : 'absent',
  }),
}));

vi.mock('../services/aidlcCli', () => ({
  AidlcCli: class {
    async doctor() {
      return {
        passed: doctorPassed,
        checks: [],
        failures: doctorPassed ? [] : ['x'],
        warnings: [],
      };
    }
  },
}));

vi.mock('../services/bunInstaller', () => ({
  BunInstaller: class {
    async check() { return { installed: true, version: '1.0.0' }; }
    async install() { return true; }
  },
}));

vi.mock('../services/variantAccessChecker', () => ({
  VariantAccessChecker: class {
    async check() { return accessResult; }
  },
  isAccessGated: (v: { id: string }) => v.id !== 'aws',
}));

import { SetupCommand } from './setup';

// Captures appended output lines so tests can assert the LOUD fallback log.
const logLines: string[] = [];
function makeOutputChannel() {
  return {
    appendLine: (line: string) => { logLines.push(line); },
    show: () => undefined,
    clear: () => undefined,
    dispose: () => undefined,
  } as unknown as import('vscode').OutputChannel;
}

/** A RuleLoader double recording the methods setup calls, with toggleable
 *  failures for the CLI-first / bootstrap paths to exercise the fallback. */
function makeRuleLoader(opts: {
  configured?: boolean;
  configureThrows?: boolean;
  nativeThrows?: boolean;
  amadeusThrows?: boolean;
} = {}) {
  return {
    isWorkspaceConfigured: async () => opts.configured ?? false,
    setVariant: () => { calls.push('setVariant'); },
    get variant() {
      return { doctorMode: 'native' };
    },
    configureWorkspaceForVariant: async () => {
      calls.push('configureWorkspaceForVariant');
      if (opts.configureThrows) { throw new Error('config failed'); }
    },
    installViaNativeInstaller: async () => {
      calls.push('installViaNativeInstaller');
      if (opts.nativeThrows) { throw new Error('native failed'); }
    },
    installViaAmadeusCli: async () => {
      calls.push('installViaAmadeusCli');
      if (opts.amadeusThrows) { throw new Error('amadeus failed'); }
    },
    installViaRepoInstaller: async () => { calls.push('installViaRepoInstaller'); },
    cloneAidlcRepo: async () => { calls.push('cloneAidlcRepo'); },
    installFramework: async () => { calls.push('installFramework'); },
    updateGitignore: async () => { calls.push('updateGitignore'); },
  } as unknown as import('../services/ruleLoader').RuleLoader;
}

beforeEach(() => {
  calls.length = 0;
  logLines.length = 0;
  cliPresent = false;
  detectedVariantId = null;
  quickPickId = undefined;
  doctorPassed = true;
  accessResult = { accessible: true };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SetupCommand — CLI-first branching', () => {
  it('CLI PRESENT: detects variant, runs aidlc config, skips the variant picker', async () => {
    cliPresent = true;
    detectedVariantId = 'amadeus';
    const loader = makeRuleLoader();
    const cmd = new SetupCommand(loader, makeOutputChannel(), async () => undefined);

    await cmd.execute();

    // Configured via the CLI, never cloned/installed.
    expect(calls).toContain('configureWorkspaceForVariant');
    expect(calls).not.toContain('installViaNativeInstaller');
    expect(calls).not.toContain('installViaAmadeusCli');
    expect(calls).not.toContain('cloneAidlcRepo');
  });

  it('CLI PRESENT but config FAILS: falls back to the full install path', async () => {
    cliPresent = true;
    detectedVariantId = 'aws'; // native-installer fallback
    const loader = makeRuleLoader({ configureThrows: true });
    const cmd = new SetupCommand(loader, makeOutputChannel(), async () => undefined);

    await cmd.execute();

    expect(calls).toContain('configureWorkspaceForVariant');
    // Fallback for an AWS variant is the native installer.
    expect(calls).toContain('installViaNativeInstaller');
    // The fall-through must be LOUD and explicit (why + that it's the legacy path).
    expect(logLines.some((l) => l.includes('[AIDLC fallback]') && /CLI-first/i.test(l))).toBe(true);
    expect(logLines.some((l) => /legacy repo-clone\/dist-copy/i.test(l))).toBe(true);
  });

  it('CLI ABSENT: shows the picker and bootstraps the chosen variant CLI', async () => {
    cliPresent = false;
    quickPickId = 'aws';
    const loader = makeRuleLoader();
    const cmd = new SetupCommand(loader, makeOutputChannel(), async () => undefined);

    await cmd.execute();

    // Bootstrap the AWS CLI; never the CLI-present config path.
    expect(calls).toContain('installViaNativeInstaller');
    expect(calls).not.toContain('configureWorkspaceForVariant');
  });

  it('CLI ABSENT + Amadeus bootstrap FAILS: falls back to the repo-clone path', async () => {
    cliPresent = false;
    quickPickId = 'amadeus';
    const loader = makeRuleLoader({ amadeusThrows: true });
    const cmd = new SetupCommand(loader, makeOutputChannel(), async () => undefined);

    await cmd.execute();

    expect(calls).toContain('installViaAmadeusCli');
    // amadeus-cli fallback goes through the clone-based official installer.
    expect(calls).toContain('installViaRepoInstaller');
  });

  it('CLI ABSENT: a cancelled picker does nothing', async () => {
    cliPresent = false;
    quickPickId = undefined; // user cancels
    const loader = makeRuleLoader();
    const cmd = new SetupCommand(loader, makeOutputChannel(), async () => undefined);

    await cmd.execute();

    expect(calls).not.toContain('installViaNativeInstaller');
    expect(calls).not.toContain('installViaAmadeusCli');
  });
});
