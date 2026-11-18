import { describe, expect, it, vi } from 'vitest';

// documentKbReader.ts imports vscode for its file access; this test only calls
// the pure parseKbIndex.
vi.mock('vscode', () => ({ FileType: {}, Uri: {}, workspace: {} }));

import { parseKbIndex } from './documentKbReader';
// The framework's own validator, the one every `/aidlc knowledge` verb runs through
// readIndex. Imported straight from the maintainers' AI-DLC install: tsconfig
// excludes *.test.ts, so rootDir (src) does not apply to this test and vitest
// transpiles the file without type-checking it.
// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (validateDocumentIndex)
import { validateDocumentIndex } from '../../.kiro/tools/aidlc-documentkb-schema';

// For every index below, Studio's verdict (readable / refused) must equal the
// framework's. The table also pins the framework's verdict (`framework`) so that
// a change in the framework's rules shows up here instead of silently moving the
// reference.

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ID_1 = '0190a1b2-c3d4-7e5f-8a6b-000000000001';
const ID_2 = '0190a1b2-c3d4-7e5f-8a6b-000000000002';
const INTENT = '0190a1b2-c3d4-7e5f-8a6b-0000000000aa';

type Row = Record<string, unknown>;

const EXTRACTION: Record<string, Row> = {
  extracted: { state: 'extracted', extractor: { name: 'text', version: '1' }, source_revision: SHA_A, chars: 5, truncated: false },
  no_extractable_text: { state: 'no_extractable_text', extractor: { name: 'pdf', version: '2' }, source_revision: SHA_A },
  extractor_unavailable: { state: 'extractor_unavailable', extractor: { name: 'docx' }, detectedType: 'application/docx' },
  extraction_failed: { state: 'extraction_failed', extractor: { name: 'pdf', version: '2' }, reason: 'timeout', detectedType: 'application/pdf' },
  unsupported_type: { state: 'unsupported_type', detectedType: 'image/png' },
  invalidated: { state: 'invalidated', source_revision: SHA_B },
};

function row(overrides: Row = {}, id = ID_1): Row {
  return {
    id,
    source: { kind: 'managed', path: 'docs/spec.pdf' },
    sha256: SHA_A,
    bytes: 10,
    indexed_at: '2026-01-02T03:04:05Z',
    extraction: EXTRACTION.extracted,
    summary: { state: 'absent' },
    ...overrides,
  };
}

function withExtraction(state: string, change: (record: Row) => void): Row {
  const record = JSON.parse(JSON.stringify(EXTRACTION[state])) as Row;
  change(record);
  return row({ extraction: record });
}

function indexOf(documents: unknown[], overrides: Row = {}): string {
  return JSON.stringify({ schema_version: 1, documents, ...overrides });
}

function verdicts(text: string): { framework: boolean; studio: boolean } {
  return {
    framework: validateDocumentIndex(JSON.parse(text)).ok,
    studio: parseKbIndex(text, 'default').state === 'ok',
  };
}

const SUMMARY = { state: 'generated', path: `documentkb/${ID_1}/summary.md`, source_revision: SHA_A };

// [name, index text, does the framework read it?]
const NAMED: Array<[string, string, boolean]> = [
  ['a valid row', indexOf([row()]), true],
  ['an empty index', indexOf([]), true],
  ['two valid rows', indexOf([row(), row({}, ID_2)]), true],
  ['a fully populated row', indexOf([row({
    tags: ['api', 'Caf\u00e9'], related_intent_ids: [INTENT],
    content: `documentkb/${ID_1}/content.md`, content_sha256: SHA_B,
    summary: SUMMARY, summary_sha256: SHA_B, removed_at: '2026-02-03T04:05:06Z',
  })]), true],
  ['a generated summary without summary_sha256', indexOf([row({ summary: SUMMARY })]), true],
  ['a linked source', indexOf([row({ source: { kind: 'linked', alias: 'wiki', path: 'a/b.md' } })]), true],

  // the six shapes the first review found Studio reading as healthy
  ['extracted without extractor, chars and truncated', indexOf([row({ extraction: { state: 'extracted', source_revision: SHA_A } })]), false],
  ['extraction_failed without reason', indexOf([row({ extraction: { ...EXTRACTION.extraction_failed, reason: undefined } })]), false],
  ['extractor_unavailable with extractor.version', indexOf([row({ extraction: { ...EXTRACTION.extractor_unavailable, extractor: { name: 'docx', version: '1' } } })]), false],
  ['tags differing by case', indexOf([row({ tags: ['api', 'API'] })]), false],
  ['a tag with leading whitespace', indexOf([row({ tags: [' api'] })]), false],
  ['summary_sha256 as a one-element array', indexOf([row({ summary: SUMMARY, summary_sha256: [SHA_A] })]), false],

  // other fields
  ['a whitespace-only tag', indexOf([row({ tags: [' '] })]), false],
  ['a tab inside a tag', indexOf([row({ tags: ['a\tb'] })]), false],
  ['NFC / NFD duplicate tags', indexOf([row({ tags: ['caf\u00e9', 'cafe\u0301'] })]), false],
  ['a 64-character tag', indexOf([row({ tags: ['t'.repeat(64)] })]), true],
  ['a 65-character tag', indexOf([row({ tags: ['t'.repeat(65)] })]), false],
  ['32 tags', indexOf([row({ tags: Array.from({ length: 32 }, (_, i) => `t${i}`) })]), true],
  ['33 tags', indexOf([row({ tags: Array.from({ length: 33 }, (_, i) => `t${i}`) })]), false],
  ['an empty tags array', indexOf([row({ tags: [] })]), false],
  ['tags that are not an array', indexOf([row({ tags: 'api' })]), false],
  ['an empty related_intent_ids', indexOf([row({ related_intent_ids: [] })]), false],
  ['a slug in related_intent_ids', indexOf([row({ related_intent_ids: ['my-intent'] })]), false],
  ['summary_sha256 on an absent summary', indexOf([row({ summary_sha256: SHA_A })]), false],
  ['summary_sha256 that is not a digest', indexOf([row({ summary: SUMMARY, summary_sha256: 'x' })]), false],
  ['content without content_sha256', indexOf([row({ content: `documentkb/${ID_1}/content.md` })]), false],
  ['content_sha256 without content', indexOf([row({ content_sha256: SHA_A })]), false],
  ['content_sha256 that is a number', indexOf([row({ content: `documentkb/${ID_1}/content.md`, content_sha256: 7 })]), false],
  ['the content of another row', indexOf([row({ content: `documentkb/${ID_2}/content.md`, content_sha256: SHA_A })]), false],
  ['a summary path of another row', indexOf([row({ summary: { ...SUMMARY, path: `documentkb/${ID_2}/summary.md` } })]), false],
  ['bytes as a string', indexOf([row({ bytes: '10' })]), false],
  ['bytes fractional', indexOf([row({ bytes: 1.5 })]), false],
  ['bytes negative', indexOf([row({ bytes: -1 })]), false],
  ['bytes zero', indexOf([row({ bytes: 0 })]), true],
  ['an uppercase sha256', indexOf([row({ sha256: 'A'.repeat(64) })]), false],
  ['an impossible indexed_at', indexOf([row({ indexed_at: '2026-02-30T00:00:00Z' })]), false],
  ['removed_at that is not a date', indexOf([row({ removed_at: 'not-a-date' })]), false],
  ['removed_at null', indexOf([row({ removed_at: null })]), false],
  ['an absolute source path', indexOf([row({ source: { kind: 'managed', path: '/etc/passwd' } })]), false],
  ['a managed source with an alias', indexOf([row({ source: { kind: 'managed', alias: 'x', path: 'a.md' } })]), false],
  ['a linked source without alias', indexOf([row({ source: { kind: 'linked', path: 'a.md' } })]), false],
  ['a duplicate id', indexOf([row(), row()]), false],
  ['one bad row among good ones', indexOf([row(), row({ sha256: 'x' }, ID_2)]), false],
  ['schema_version 2', indexOf([row()], { schema_version: 2 }), false],
  ['a string schema_version', indexOf([], { schema_version: '1' }), false],
  ['documents that is not an array', indexOf([], { documents: {} }), false],
];

describe('parseKbIndex gives the framework\'s verdict (validateDocumentIndex)', () => {
  it.each(NAMED)('%s', (_name, text, framework) => {
    const result = verdicts(text);
    expect(result.framework).toBe(framework);
    expect(result.studio).toBe(framework);
  });

  it('refuses a row the framework refuses with an error naming the first problems', () => {
    const health = parseKbIndex(indexOf([row({ extraction: { state: 'extracted', source_revision: SHA_A } })]));
    expect(health.state).toBe('unreadable');
    expect(health.error).toMatch(/extractor\.name is required/);
    expect(health.error).toMatch(/chars must be/);
  });
});

describe('parseKbIndex gives the framework\'s verdict on every extraction shape', () => {
  const BAD_VALUES: unknown[] = [null, 0, 1.5, -1, '', 'x', true, false, [], [SHA_A], {}];
  const COMPANIONS = ['extractor', 'source_revision', 'chars', 'truncated', 'reason', 'detectedType'];
  const EXTRACTORS: unknown[] = [
    undefined, null, [], 'pdf', { name: 'x' }, { name: 'x', version: '1' }, { version: '1' },
    { name: 1 }, { name: 'x', version: 2 }, { name: 'x', version: null }, { name: '', version: '' },
  ];

  const cases: Array<[string, string]> = [];
  for (const state of Object.keys(EXTRACTION)) {
    cases.push([`${state}: as is`, indexOf([withExtraction(state, () => undefined)])]);
    for (const field of COMPANIONS) {
      cases.push([`${state}: ${field} removed`, indexOf([withExtraction(state, (r) => { delete r[field]; })])]);
      for (const bad of BAD_VALUES) {
        cases.push([`${state}: ${field} = ${JSON.stringify(bad)}`, indexOf([withExtraction(state, (r) => { r[field] = bad; })])]);
      }
    }
    for (const extractor of EXTRACTORS) {
      cases.push([`${state}: extractor = ${JSON.stringify(extractor) ?? 'absent'}`,
        indexOf([withExtraction(state, (r) => { r.extractor = extractor; })])]);
    }
    // every companion supplied, valid, whatever the state requires
    cases.push([`${state}: every companion present`, indexOf([withExtraction(state, (r) => {
      r.extractor = { name: 'x', version: '1' };
      r.source_revision = SHA_A;
      r.chars = 3;
      r.truncated = true;
      r.reason = 'r';
      r.detectedType = 't';
    })])]);
  }

  it.each(cases)('%s', (_name, text) => {
    const { framework, studio } = verdicts(text);
    expect(studio).toBe(framework);
  });

  it('covers both verdicts for every state (the sweep is not vacuous)', () => {
    for (const state of Object.keys(EXTRACTION)) {
      const own = cases.filter(([name]) => name.startsWith(`${state}:`));
      const results = own.map(([, text]) => verdicts(text).framework);
      expect(results.some((ok) => ok), `${state}: nothing accepted`).toBe(true);
      expect(results.some((ok) => !ok), `${state}: nothing refused`).toBe(true);
    }
  });
});
