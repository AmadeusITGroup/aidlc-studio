import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AIDLC_VARIANTS,
  DEFAULT_VARIANT_ID,
  getDefaultVariant,
  getVariant,
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
    expect(aws?.installScriptUrl?.unix).toMatch(/install\.sh$/);
    expect(aws?.installScriptUrl?.windows).toMatch(/install\.ps1$/);
  });

  it('amadeus uses the git-clone-copy method', () => {
    const amadeus = AIDLC_VARIANTS.find((v) => v.id === 'amadeus');
    expect(amadeus?.installMethod).toBe('git-clone-copy');
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
    expect(variant.repoUrl).toBe('https://example.com/my/aidlc-fork');
  });

  it('ignores a non-http rulesSource value', () => {
    rulesSource = 'not-a-url';
    const variant = getVariant('aws');

    expect(variant.id).toBe('aws');
    expect(variant.installMethod).toBe('native-installer');
  });
});
