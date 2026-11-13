import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Controllable doubles ---
const executed: string[] = []; // command ids executed via vscode.commands
const calls: string[] = []; // method calls recorded on the checker/loader stubs
let cliPresent: boolean;
let detectedVariantId: 'aws' | 'amadeus' | null;
let workspaceState: {
  configured: boolean;
  cliPresent: boolean;
  workspaceVersion: string | null;
  cliVersion: string | null;
  versionDiffers: boolean;
  refreshApplicable: boolean;
};
let cliInfo: {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  variantDisplayId: 'aws' | 'amadeus';
  cliAbsent?: boolean;
};
let modalChoice: string | undefined; // what showInformationMessage modal returns
let doctorPassed: boolean;

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  ProgressLocation: { Notification: 15 },
  workspace: {
    workspaceFolders: [{ uri: { path: '/ws', fsPath: '/ws' } }],
    getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }),
  },
  window: {
    showInformationMessage: async () => modalChoice,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (
      _opts: unknown,
      task: (p: { report: () => void }) => Promise<unknown>
    ) => task({ report: () => undefined }),
  },
  env: { openExternal: async () => true },
  commands: {
    executeCommand: (id: string) => { executed.push(id); },
  },
}));

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
      return { passed: doctorPassed, checks: [], failures: doctorPassed ? [] : ['x'], warnings: [] };
    }
  },
}));

// Keep the real RepoAccessError / getVariant.
vi.mock('../services/variants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/variants')>();
  return actual;
});

import { UpdateCommand } from './update';
import type { UpdateChecker } from '../services/updateChecker';
import type { RuleLoader } from '../services/ruleLoader';

function makeChannel() {
  return {
    appendLine: () => undefined,
    show: () => undefined,
  } as unknown as import('vscode').OutputChannel;
}

function makeChecker() {
  return {
    get variant() { return { id: 'aws', doctorMode: 'native' }; },
    async checkCliUpdate() { return cliInfo; },
    async checkWorkspaceState() { return workspaceState; },
    async updateCliBinary() { calls.push('updateCliBinary'); return true; },
  } as unknown as UpdateChecker;
}

function makeLoader() {
  return {
    setVariant() { calls.push('setVariant'); },
    async configureWorkspaceForVariant() { calls.push('configureWorkspaceForVariant'); },
  } as unknown as RuleLoader;
}

beforeEach(() => {
  executed.length = 0;
  calls.length = 0;
  cliPresent = true;
  detectedVariantId = 'aws';
  doctorPassed = true;
  modalChoice = undefined;
  workspaceState = {
    configured: true,
    cliPresent: true,
    workspaceVersion: '2.10.0',
    cliVersion: '2.10.0',
    versionDiffers: false,
    refreshApplicable: true,
  };
  cliInfo = {
    currentVersion: '2.9.0',
    latestVersion: '2.9.1',
    updateAvailable: true,
    variantDisplayId: 'aws',
  };
});

afterEach(() => vi.clearAllMocks());

describe('UpdateCommand — split operations', () => {
  it('updateCli runs ONLY the CLI binary upgrade (no aidlc config)', async () => {
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.updateCli();
    expect(calls).toContain('updateCliBinary');
    expect(calls).not.toContain('configureWorkspaceForVariant');
  });

  it('updateWorkspace runs `aidlc config` for the DETECTED variant + doctor, not the CLI upgrade', async () => {
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.updateWorkspace();
    expect(calls).toContain('configureWorkspaceForVariant');
    expect(calls).not.toContain('updateCliBinary');
  });

  it('updateWorkspace refuses when no CLI is present', async () => {
    workspaceState = { ...workspaceState, cliPresent: false, refreshApplicable: false };
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.updateWorkspace();
    expect(calls).not.toContain('configureWorkspaceForVariant');
  });

  it('updateWorkspace refuses when the workspace is not configured', async () => {
    workspaceState = { ...workspaceState, configured: false, refreshApplicable: false };
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.updateWorkspace();
    expect(calls).not.toContain('configureWorkspaceForVariant');
  });

  it('updateRules runs CLI FIRST, THEN the workspace refresh (enforced order)', async () => {
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.updateRules();
    const cliIdx = calls.indexOf('updateCliBinary');
    const wsIdx = calls.indexOf('configureWorkspaceForVariant');
    expect(cliIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThanOrEqual(0);
    expect(cliIdx).toBeLessThan(wsIdx); // CLI before workspace
  });

  it('checkForUpdates with cliAbsent does not attempt an upgrade', async () => {
    cliInfo = { ...cliInfo, cliAbsent: true, updateAvailable: false, currentVersion: null, latestVersion: 'unknown' };
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.checkForUpdates();
    expect(calls).not.toContain('updateCliBinary');
  });

  it('checkForUpdates offers the CLI upgrade and runs updateCli when accepted', async () => {
    modalChoice = 'Update CLI Now';
    const cmd = new UpdateCommand(makeChecker(), makeChannel(), makeLoader());
    await cmd.checkForUpdates();
    expect(calls).toContain('updateCliBinary');
  });
});
