import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AIDLC_VARIANTS,
  DEFAULT_VARIANT_ID,
  detectHostHarness,
  getDefaultVariant,
  getVariant,
  resolveHarness,
} from './variants';

// Mutable store for the mocked rulesSource setting.
let rulesSource = '';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: string) => (rulesSource === '' ? fallback : rulesSource),
    }),
  },
}));

afterEach(() => {
  rulesSource = '';
});

describe('variants catalog', () => {
  it('declares aws as the default variant', () => {
    expect(DEFAULT_VARIANT_ID).toBe('aws');
    expect(AIDLC_VARIANTS.some((v) => v.id === 'aws')).toBe(true);
  });

  it('aws uses the native installer with both script URLs', () => {
    const aws = AIDLC_VARIANTS.find((v) => v.id === 'aws');
    expect(aws?.installMethod).toBe('native-installer');
    expect(aws?.doctorMode).toBe('native');
    expect(aws?.installScriptUrl?.unix).toMatch(/install\.sh$/);
    expect(aws?.installScriptUrl?.windows).toMatch(/install\.ps1$/);
  });

  it('amadeus uses the official repo-installer with the bun-tool doctor', () => {
    const amadeus = AIDLC_VARIANTS.find((v) => v.id === 'amadeus');
    expect(amadeus?.installMethod).toBe('repo-installer');
    expect(amadeus?.doctorMode).toBe('bun-tool');
    expect(amadeus?.repoUrl).toMatch(/^https?:\/\//);
  });
});

describe('getVariant', () => {
  it('returns the requested variant when no override is set', () => {
    expect(getVariant('amadeus').id).toBe('amadeus');
    expect(getVariant('aws').id).toBe('aws');
  });

  it('falls back to the first variant for an unknown id', () => {
    expect(getVariant('does-not-exist').id).toBe(AIDLC_VARIANTS[0].id);
  });

  it('getDefaultVariant resolves to the aws variant', () => {
    expect(getDefaultVariant().id).toBe('aws');
  });

  it('applies a custom rulesSource URL as a git-clone-copy override', () => {
    rulesSource = 'https://example.com/my/aidlc-fork';
    const variant = getVariant('aws');

    expect(variant.id).toBe('custom');
    expect(variant.label).toBe('Custom');
    expect(variant.installMethod).toBe('git-clone-copy');
    expect(variant.doctorMode).toBe('bun-tool');
    expect(variant.repoUrl).toBe('https://example.com/my/aidlc-fork');
  });

  it('ignores a non-http rulesSource value', () => {
    rulesSource = 'not-a-url';
    const variant = getVariant('aws');

    expect(variant.id).toBe('aws');
    expect(variant.installMethod).toBe('native-installer');
  });
});

describe('detectHostHarness', () => {
  it('selects kiro-ide when the host IDE is Kiro', () => {
    expect(detectHostHarness('Kiro')).toBe('kiro-ide');
  });

  it('selects copilot for VS Code', () => {
    expect(detectHostHarness('Visual Studio Code')).toBe('copilot');
    expect(detectHostHarness('Visual Studio Code - Insiders')).toBe('copilot');
  });

  it('is case-insensitive on the Kiro match', () => {
    expect(detectHostHarness('kiro')).toBe('kiro-ide');
    expect(detectHostHarness('KIRO IDE')).toBe('kiro-ide');
  });

  it('defaults to copilot for any other host', () => {
    expect(detectHostHarness('Some Other Editor')).toBe('copilot');
    expect(detectHostHarness('')).toBe('copilot');
  });
});

describe('resolveHarness', () => {
  const aws = AIDLC_VARIANTS.find((v) => v.id === 'aws')!;
  const amadeus = AIDLC_VARIANTS.find((v) => v.id === 'amadeus')!;

  it('AWS in Kiro installs kiro-ide (supported, no fallback)', () => {
    expect(resolveHarness(aws, 'Kiro')).toEqual({ harness: 'kiro-ide', fellBack: false });
  });

  it('AWS in VS Code installs copilot (supported, no fallback)', () => {
    expect(resolveHarness(aws, 'Visual Studio Code')).toEqual({ harness: 'copilot', fellBack: false });
  });

  it('Amadeus in Kiro installs kiro-ide (supported, no fallback)', () => {
    expect(resolveHarness(amadeus, 'Kiro')).toEqual({ harness: 'kiro-ide', fellBack: false });
  });

  it('Amadeus in VS Code falls back to kiro-ide (no copilot harness)', () => {
    // Amadeus is Kiro-only; VS Code has no supported harness, so it falls back.
    expect(resolveHarness(amadeus, 'Visual Studio Code')).toEqual({ harness: 'kiro-ide', fellBack: true });
  });

  it('falls back to the first supported harness for an unknown host', () => {
    expect(resolveHarness(amadeus, 'Some Other Editor')).toEqual({ harness: 'kiro-ide', fellBack: true });
  });
});
