import { describe, expect, it, vi } from 'vitest';

// The module under test imports `vscode` for its thin fs wrapper; the pure
// parser itself needs none of it. Stub `vscode` so the module resolves under
// vitest (which has no `vscode` runtime), then exercise the pure parser.
vi.mock('vscode', () => ({
  Uri: { joinPath: (base: { path: string }, ...parts: string[]) => ({ path: [base.path, ...parts].join('/') }) },
  workspace: { fs: { readFile: async () => { throw new Error('ENOENT'); } } },
}));

import { parseRepoAidlcVersion } from './repoVersionReader';

describe('parseRepoAidlcVersion', () => {
  it('parses a well-formed double-quoted constant', () => {
    const text = [
      '// Hand-edited single source of truth for the AIDLC framework version.',
      'export const AIDLC_VERSION = "2.5.67";',
      '',
    ].join('\n');
    expect(parseRepoAidlcVersion(text)).toBe('2.5.67');
  });

  it('parses a single-quoted value', () => {
    expect(parseRepoAidlcVersion("export const AIDLC_VERSION = '3.1.0';")).toBe('3.1.0');
  });

  it('tolerates extra whitespace around the assignment', () => {
    expect(parseRepoAidlcVersion('export const AIDLC_VERSION   =   "1.0.0" ;')).toBe('1.0.0');
  });

  it('parses a pre-release / suffixed value', () => {
    expect(parseRepoAidlcVersion('export const AIDLC_VERSION = "2.10.0-preview.3";')).toBe(
      '2.10.0-preview.3'
    );
  });

  it('returns null when there is no AIDLC_VERSION export', () => {
    expect(parseRepoAidlcVersion('export const SOMETHING_ELSE = "1.2.3";')).toBeNull();
    expect(parseRepoAidlcVersion('// just a comment, no version here')).toBeNull();
  });

  it('returns null for a malformed constant (no quoted value)', () => {
    expect(parseRepoAidlcVersion('export const AIDLC_VERSION = ;')).toBeNull();
    expect(parseRepoAidlcVersion('export const AIDLC_VERSION = someIdentifier;')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseRepoAidlcVersion('')).toBeNull();
  });
});
