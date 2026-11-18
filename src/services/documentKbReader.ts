import * as vscode from 'vscode';
import { studioSpace } from './spaces';

// Read-only reader of the space's DocumentKB catalog (the "Pod Brain").
//
// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (DOCUMENTKB_SCHEMA_VERSION,
//   EXTRACTION_STATES and the remedy comment above it, validateDocumentIndex,
//   validDocumentPath, effectiveExtractionState, derivativeIsCurrent, isTombstoned,
//   summaryIsCurrent, effectiveSummaryState)
// Framework source: .kiro/tools/aidlc-knowledge.ts (documentkbDir, indexPath, readIndex)
// Framework source: .kiro/tools/aidlc-lib.ts (knowledgeDir)
//
// What it reads: ONLY aidlc/spaces/<space>/knowledge/documentkb/index.json.
// It never reads content.md, summary.md, metadata.json or the user's originals:
// extracted text is untrusted and is never read or rendered by Studio.
//
// index.json is a committed file, therefore untrusted input. Like the framework's
// validateDocumentIndex, any error makes the WHOLE index unreadable (never a
// partial read) and an unsupported schema_version fails closed. Nothing is ever
// rewritten.
//
// PARITY WITH THE FRAMEWORK. validateIndex below is a port of validateDocumentIndex
// and gives the same verdict (readable / refused) on every row the framework
// checks: the per-state extraction requirements (STATE_REQUIREMENTS: extractor
// identity, source_revision, chars, truncated, reason, detectedType), source,
// sha256, bytes, indexed_at, summary, related_intent_ids, tags (count and length
// caps, control characters, leading/trailing whitespace, NFC + case-fold
// duplicates), content, content_sha256, summary_sha256, removed_at and duplicate
// ids. documentKbReader.test.ts runs the framework's own validator on the same
// fixtures and asserts the verdicts are equal.
//
// NOT CHECKED (out of what Studio reads): the files the rows point at. Studio
// never opens content.md, summary.md, metadata.json or the originals, so it does
// not verify that they exist or that content_sha256 / summary_sha256 match their
// bytes, and it does not run validateDocumentMetadata (metadata.json). Error
// MESSAGES are shorter than the framework's; only the verdict is the same. The
// symbolic-link walk is described on readKbHealth.

export type ExtractionState =
  | 'extracted'
  | 'no_extractable_text'
  | 'extractor_unavailable'
  | 'extraction_failed'
  | 'unsupported_type'
  | 'invalidated';

export interface KbDocument {
  id: string;
  sourceKind: 'managed' | 'linked';
  sourcePath: string;
  alias?: string;
  displayName: string;
  extraction: ExtractionState; // EFFECTIVE state (extracted with source_revision !== sha256 -> invalidated)
  remedy: string | null; // from the schema comments; null for extracted and unsupported_type
  scope: 'space' | 'intent';
  intentIds: string[];
  tags: string[];
  summary: 'absent' | 'generated' | 'invalidated'; // effectiveSummaryState
  removed: boolean;
  indexedAt: string;
}

export interface KbHealth {
  state: 'ok' | 'absent' | 'unreadable';
  error?: string;
  space: string;
  documents: KbDocument[]; // tombstones included, flagged removed
  active: number;
  extracted: number;
  extractable: number;
  knowledgePct: number | null;
  needsRemedy: number; // active rows in no_extractable_text | extractor_unavailable | extraction_failed | invalidated
  intentScoped: number;
  spaceWide: number;
  summarized: number;
  tombstones: number;
}

/** Size cap for index.json, a committed (untrusted) file: 5 MB. */
export const MAX_INDEX_BYTES = 5 * 1024 * 1024;

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (DOCUMENTKB_SCHEMA_VERSION)
const SUPPORTED_SCHEMA_VERSION = 1;

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (EXTRACTION_STATES)
const EXTRACTION_STATES: readonly ExtractionState[] = [
  'extracted',
  'no_extractable_text',
  'extractor_unavailable',
  'extraction_failed',
  'unsupported_type',
  'invalidated',
];

// Remedies, from the comment above EXTRACTION_STATES in aidlc-documentkb-schema.ts.
const REMEDIES: Record<ExtractionState, string | null> = {
  extracted: null,
  no_extractable_text: 'Supply a text version of the document (OCR is out of scope).',
  extractor_unavailable: 'Install the extractor; /aidlc knowledge sync retries.',
  extraction_failed: 'Fix or replace the document.',
  unsupported_type: null,
  invalidated: 'Run /aidlc knowledge sync (the extracted text predates the current file).',
};

// States that need an action from the user (the document will not reach agents as is).
const NEEDS_REMEDY: ReadonlySet<ExtractionState> = new Set<ExtractionState>([
  'no_extractable_text',
  'extractor_unavailable',
  'extraction_failed',
  'invalidated',
]);

// What each extraction state MUST carry, transcribed from STATE_REQUIREMENTS.
// `extractor` has three levels: extractor_unavailable records the attempted NAME
// and no version (the program never ran); the states that ran need name+version.
// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (STATE_REQUIREMENTS)
type ExtractorRequirement = 'name-and-version' | 'name-only' | 'absent-ok';

interface StateRequirements {
  extractor: ExtractorRequirement;
  sourceRevision: boolean;
  chars: boolean;
  truncated: boolean;
  reason: boolean;
  detectedType: boolean;
}

const STATE_REQUIREMENTS: Readonly<Record<ExtractionState, StateRequirements>> = {
  extracted: { extractor: 'name-and-version', sourceRevision: true, chars: true, truncated: true, reason: false, detectedType: false },
  no_extractable_text: { extractor: 'name-and-version', sourceRevision: true, chars: false, truncated: false, reason: false, detectedType: false },
  extractor_unavailable: { extractor: 'name-only', sourceRevision: false, chars: false, truncated: false, reason: false, detectedType: true },
  extraction_failed: { extractor: 'name-and-version', sourceRevision: false, chars: false, truncated: false, reason: true, detectedType: true },
  unsupported_type: { extractor: 'absent-ok', sourceRevision: false, chars: false, truncated: false, reason: false, detectedType: true },
  invalidated: { extractor: 'absent-ok', sourceRevision: true, chars: false, truncated: false, reason: false, detectedType: false },
};

const SHA256_REGEX = /^[0-9a-f]{64}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

const MAX_TAGS_PER_DOCUMENT = 32;
const MAX_TAG_LENGTH = 64;
const MAX_SHOWN_ERRORS = 3;
const MAX_ERROR_LENGTH = 160;
const MAX_SHOWN_VALUE = 40;

interface RawRow {
  id: string;
  sha256: string;
  indexed_at: string;
  source: { kind: 'managed' | 'linked'; path: string; alias?: string };
  extraction: { state: ExtractionState; source_revision?: string };
  summary: { state: 'absent' | 'generated'; source_revision?: string };
  related_intent_ids?: string[];
  tags?: string[];
  removed_at?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Untrusted values quoted in an error message are cut short and JSON-quoted.
function show(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_SHOWN_VALUE ? `${text.slice(0, MAX_SHOWN_VALUE)}...` : text;
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (isValidIsoTimestamp)
function isValidIsoTimestamp(raw: unknown): raw is string {
  if (typeof raw !== 'string') { return false; }
  const match = ISO_TIMESTAMP_REGEX.exec(raw);
  if (match === null || Number.isNaN(Date.parse(raw))) { return false; }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 23 || offsetMinute > 59) { return false; }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= maxDay;
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (validDocumentPath)
function validDocumentPath(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) { return false; }
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\')) { return false; }
  if (raw.includes('\\') || raw.includes('\0')) { return false; }
  return !raw.split('/').some((segment) => segment === '..' || segment === '');
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) { return true; }
  }
  return false;
}

function validateSource(raw: unknown, where: string, errors: string[]): void {
  if (!isObject(raw)) {
    errors.push(`${where}.source must be an object`);
    return;
  }
  if (raw.kind !== 'managed' && raw.kind !== 'linked') {
    errors.push(`${where}.source.kind must be managed or linked (got ${show(raw.kind)})`);
    return;
  }
  if (!validDocumentPath(raw.path)) {
    errors.push(`${where}.source.path must be a relative POSIX path with no ".." (got ${show(raw.path)})`);
  }
  if (raw.kind === 'linked') {
    if (typeof raw.alias !== 'string' || raw.alias.length === 0) {
      errors.push(`${where}.source.alias is required for a linked source`);
    }
  } else if ('alias' in raw) {
    errors.push(`${where}.source.alias is not valid on a managed source`);
  }
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (validateExtraction)
function validateExtraction(raw: unknown, where: string, errors: string[]): void {
  if (!isObject(raw)) {
    errors.push(`${where}.extraction must be an object`);
    return;
  }
  const state = raw.state;
  if (typeof state !== 'string' || !(EXTRACTION_STATES as readonly string[]).includes(state)) {
    errors.push(`${where}.extraction.state is not a known state (got ${show(state)})`);
    return;
  }
  const req = STATE_REQUIREMENTS[state as ExtractionState];
  const at = `${where}.extraction`;

  // extractor identity, per state
  const extractor = raw.extractor;
  if (req.extractor === 'absent-ok') {
    if (extractor !== undefined && (!isObject(extractor) || typeof extractor.name !== 'string')) {
      errors.push(`${at}.extractor, when present, must carry a name string`);
    }
  } else if (!isObject(extractor) || typeof extractor.name !== 'string') {
    errors.push(`${at}.extractor.name is required when state is "${state}"`);
  } else if (req.extractor === 'name-and-version' && typeof extractor.version !== 'string') {
    errors.push(`${at}.extractor.version is required when state is "${state}"`);
  } else if (req.extractor === 'name-only' && extractor.version !== undefined) {
    errors.push(`${at}.extractor.version must be absent when state is "${state}"`);
  }

  // source_revision (String() coercion as in the framework)
  if (raw.source_revision !== undefined && !SHA256_REGEX.test(String(raw.source_revision))) {
    errors.push(`${at}.source_revision must be a lowercase sha256 hex digest`);
  }
  if (req.sourceRevision && raw.source_revision === undefined) {
    errors.push(`${at}.source_revision is required when state is "${state}"`);
  }

  // per-state companions
  if (req.chars && (typeof raw.chars !== 'number' || !Number.isInteger(raw.chars) || raw.chars < 0)) {
    errors.push(`${at}.chars must be a non-negative integer when state is "${state}"`);
  }
  if (req.truncated && typeof raw.truncated !== 'boolean') {
    errors.push(`${at}.truncated must be a boolean when state is "${state}"`);
  }
  if (req.reason && typeof raw.reason !== 'string') {
    errors.push(`${at}.reason is required when state is "${state}"`);
  }
  if (req.detectedType && typeof raw.detectedType !== 'string') {
    errors.push(`${at}.detectedType is required when state is "${state}"`);
  }
}

function validateSummary(raw: unknown, id: unknown, where: string, errors: string[]): void {
  if (!isObject(raw)) {
    errors.push(`${where}.summary must be an object`);
    return;
  }
  if (raw.state === 'absent') { return; }
  if (raw.state !== 'generated') {
    errors.push(`${where}.summary.state must be absent or generated (got ${show(raw.state)})`);
    return;
  }
  if (!validDocumentPath(raw.path)) {
    errors.push(`${where}.summary.path must be a relative POSIX path`);
  } else if (typeof id === 'string' && raw.path !== `documentkb/${id}/summary.md`) {
    errors.push(`${where}.summary.path must be the row's own documentkb/<id>/summary.md`);
  }
  if (!SHA256_REGEX.test(String(raw.source_revision))) {
    errors.push(`${where}.summary.source_revision must be a sha256 hex digest`);
  }
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (validateRow, the `tags` block)
function validateTags(tags: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(tags)) {
    errors.push(`${where}.tags must be an array when present`);
    return;
  }
  if (tags.length === 0) {
    errors.push(`${where}.tags must be omitted when a document has no tags (an empty list is invalid)`);
    return;
  }
  if (tags.length > MAX_TAGS_PER_DOCUMENT) {
    errors.push(`${where}.tags has ${tags.length} entries, over the ${MAX_TAGS_PER_DOCUMENT}-tag cap`);
    return;
  }
  const seen = new Map<string, number>(); // NFC + case-folded key -> first index
  tags.forEach((tag, i) => {
    if (typeof tag !== 'string' || tag.length === 0) {
      errors.push(`${where}.tags[${i}] must be a non-empty string (got ${show(tag)})`);
      return;
    }
    if (hasControlChar(tag)) {
      errors.push(`${where}.tags[${i}] must not contain control characters (got ${show(tag)})`);
      return;
    }
    if (tag.trim() !== tag || tag.trim().length === 0) {
      errors.push(`${where}.tags[${i}] must not have leading or trailing whitespace (got ${show(tag)})`);
      return;
    }
    if (tag.length > MAX_TAG_LENGTH) {
      errors.push(`${where}.tags[${i}] is ${tag.length} chars, over the ${MAX_TAG_LENGTH}-char cap`);
      return;
    }
    const key = tag.normalize('NFC').toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push(`${where}.tags[${i}] duplicates tags[${first}] (${show(tag)})`);
    } else {
      seen.set(key, i);
    }
  });
}

function validateRow(raw: unknown, where: string, errors: string[]): void {
  if (!isObject(raw)) {
    errors.push(`${where} must be an object`);
    return;
  }
  if (typeof raw.id !== 'string' || !UUID_REGEX.test(raw.id)) {
    errors.push(`${where}.id must be a canonical UUID (got ${show(raw.id)})`);
  }
  if (typeof raw.sha256 !== 'string' || !SHA256_REGEX.test(raw.sha256)) {
    errors.push(`${where}.sha256 must be a lowercase sha256 hex digest`);
  }
  if (typeof raw.bytes !== 'number' || !Number.isInteger(raw.bytes) || raw.bytes < 0) {
    errors.push(`${where}.bytes must be a non-negative integer`);
  }
  if (!isValidIsoTimestamp(raw.indexed_at)) {
    errors.push(`${where}.indexed_at must be an ISO-8601 timestamp`);
  }
  validateSource(raw.source, where, errors);
  validateExtraction(raw.extraction, where, errors);
  validateSummary(raw.summary, raw.id, where, errors);

  if (raw.related_intent_ids !== undefined) {
    const ids = raw.related_intent_ids;
    if (!Array.isArray(ids) || ids.length === 0 ||
        ids.some((v) => typeof v !== 'string' || !UUID_REGEX.test(v))) {
      errors.push(`${where}.related_intent_ids must be a non-empty array of UUIDs when present`);
    }
  }
  if (raw.tags !== undefined) {
    validateTags(raw.tags, where, errors);
  }
  if (raw.content !== undefined) {
    if (!validDocumentPath(raw.content) ||
        (typeof raw.id === 'string' && raw.content !== `documentkb/${raw.id}/content.md`)) {
      errors.push(`${where}.content must be the row's own documentkb/<id>/content.md`);
    }
    if (typeof raw.content_sha256 !== 'string' || !SHA256_REGEX.test(raw.content_sha256)) {
      errors.push(`${where}.content_sha256 must be a sha256 hex digest when content is present`);
    }
  } else if (raw.content_sha256 !== undefined) {
    errors.push(`${where}.content_sha256 must be absent when content is absent`);
  }
  if (raw.summary_sha256 !== undefined) {
    const summaryState = isObject(raw.summary) ? raw.summary.state : undefined;
    if (summaryState !== 'generated') {
      errors.push(`${where}.summary_sha256 must be absent when summary.state is not "generated"`);
    } else if (typeof raw.summary_sha256 !== 'string' || !SHA256_REGEX.test(raw.summary_sha256)) {
      errors.push(`${where}.summary_sha256, when present, must be a lowercase sha256 digest`);
    }
  }
  if (raw.removed_at !== undefined && !isValidIsoTimestamp(raw.removed_at)) {
    errors.push(`${where}.removed_at must be an ISO-8601 timestamp when present`);
  }
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (validateDocumentIndex)
function validateIndex(parsed: unknown): { ok: true; rows: RawRow[] } | { ok: false; errors: string[] } {
  if (!isObject(parsed)) {
    return { ok: false, errors: ['index.json must be a JSON object'] };
  }
  if (parsed.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `index.json schema_version must be ${SUPPORTED_SCHEMA_VERSION} (got ${show(parsed.schema_version)}); ` +
        'this release of Studio does not read other versions',
      ],
    };
  }
  if (!Array.isArray(parsed.documents)) {
    return { ok: false, errors: ['index.json documents must be an array'] };
  }
  const errors: string[] = [];
  parsed.documents.forEach((row, i) => validateRow(row, `documents[${i}]`, errors));

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of parsed.documents) {
    if (isObject(row) && typeof row.id === 'string') {
      if (seen.has(row.id)) { duplicates.add(row.id); }
      seen.add(row.id);
    }
  }
  for (const id of duplicates) {
    errors.push(`duplicate document id ${show(id)}`);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, rows: parsed.documents as unknown as RawRow[] };
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (effectiveExtractionState, derivativeIsCurrent)
function effectiveExtraction(row: RawRow): ExtractionState {
  if (row.extraction.state === 'extracted' && row.extraction.source_revision !== row.sha256) {
    return 'invalidated';
  }
  return row.extraction.state;
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (isTombstoned)
function isTombstoned(row: RawRow): boolean {
  return typeof row.removed_at === 'string' && row.removed_at.length > 0;
}

// Framework source: .kiro/tools/aidlc-documentkb-schema.ts (effectiveSummaryState, summaryIsCurrent)
function effectiveSummary(row: RawRow): 'absent' | 'generated' | 'invalidated' {
  if (isTombstoned(row)) { return 'absent'; }
  if (row.summary.state === 'generated' && row.summary.source_revision !== row.sha256) {
    return 'invalidated';
  }
  return row.summary.state;
}

function toDocument(row: RawRow): KbDocument {
  const extraction = effectiveExtraction(row);
  const intentIds = row.related_intent_ids ?? [];
  const segments = row.source.path.split('/');
  return {
    id: row.id,
    sourceKind: row.source.kind,
    sourcePath: row.source.path,
    ...(row.source.kind === 'linked' && row.source.alias !== undefined ? { alias: row.source.alias } : {}),
    displayName: segments[segments.length - 1],
    extraction,
    remedy: REMEDIES[extraction],
    scope: intentIds.length > 0 ? 'intent' : 'space',
    intentIds: [...intentIds],
    tags: [...(row.tags ?? [])],
    summary: effectiveSummary(row),
    removed: isTombstoned(row),
    indexedAt: row.indexed_at,
  };
}

function emptyHealth(state: KbHealth['state'], space: string, error?: string): KbHealth {
  return {
    state,
    ...(error !== undefined ? { error } : {}),
    space,
    documents: [],
    active: 0,
    extracted: 0,
    extractable: 0,
    knowledgePct: null,
    needsRemedy: 0,
    intentScoped: 0,
    spaceWide: 0,
    summarized: 0,
    tombstones: 0,
  };
}

/** No DocumentKB in this space (nothing to show, not an error). */
export function absentKbHealth(space: string = studioSpace()): KbHealth {
  return emptyHealth('absent', space);
}

/** A DocumentKB Studio cannot read: shown with its message, never partially. */
export function unreadableKbHealth(error: string, space: string = studioSpace()): KbHealth {
  return emptyHealth('unreadable', space, error);
}

function summarizeErrors(errors: string[]): string {
  const shown = errors
    .slice(0, MAX_SHOWN_ERRORS)
    .map((e) => (e.length > MAX_ERROR_LENGTH ? `${e.slice(0, MAX_ERROR_LENGTH)}...` : e));
  const more = errors.length > MAX_SHOWN_ERRORS ? ` (+${errors.length - MAX_SHOWN_ERRORS} more)` : '';
  return `index.json is not valid and was not read (nothing was rewritten): ${shown.join('; ')}${more}`;
}

// Knowledge % = extracted / extractable. It is floored (integer arithmetic, so
// 29/100 is 29 and not 28.999...) and only a catalog where EVERY extractable
// document is extracted reaches 100: rounding would show 100% while a document
// still needs a remedy (199 of 200 is 99%).
function knowledgePercent(extracted: number, extractable: number): number | null {
  if (extractable === 0) { return null; }
  return extracted >= extractable ? 100 : Math.floor((extracted * 100) / extractable);
}

/**
 * Parse and validate the text of index.json. Pure: no I/O, no vscode.
 * Any error makes the whole index `unreadable` (fail closed).
 */
export function parseKbIndex(text: string, space: string = studioSpace()): KbHealth {
  if (Buffer.byteLength(text, 'utf-8') > MAX_INDEX_BYTES) {
    return unreadableKbHealth('index.json is larger than 5 MB and was not read', space);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadableKbHealth('index.json is not valid JSON and was not read', space);
  }
  const result = validateIndex(parsed);
  if (!result.ok) {
    return unreadableKbHealth(summarizeErrors(result.errors), space);
  }

  const documents = result.rows.map(toDocument);
  const active = documents.filter((d) => !d.removed);
  const extracted = active.filter((d) => d.extraction === 'extracted').length;
  const extractable = active.filter((d) => d.extraction !== 'unsupported_type').length;
  const intentScoped = active.filter((d) => d.scope === 'intent').length;

  return {
    state: 'ok',
    space,
    documents,
    active: active.length,
    extracted,
    extractable,
    knowledgePct: knowledgePercent(extracted, extractable),
    needsRemedy: active.filter((d) => NEEDS_REMEDY.has(d.extraction)).length,
    intentScoped,
    spaceWide: active.length - intentScoped,
    summarized: active.filter((d) => d.summary === 'generated').length,
    tombstones: documents.length - active.length,
  };
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'FileNotFound' || code === 'ENOENT') { return true; }
  return error instanceof Error && /ENOENT|EntryNotFound|FileNotFound/.test(`${error.name} ${error.message}`);
}

function isSymlink(type: vscode.FileType): boolean {
  return (type & vscode.FileType.SymbolicLink) !== 0;
}

// The path components the framework refuses to find a symbolic link in, from the
// workspace down to documentkb/ (the last one).
// Framework source: .kiro/tools/aidlc-knowledge.ts (assertKnowledgeRootTrusted)
function kbChain(space: string): string[] {
  return ['aidlc', 'spaces', space, 'knowledge', 'documentkb'];
}

/**
 * Read the DocumentKB health of a space from
 * `aidlc/spaces/<space>/knowledge/documentkb/index.json`. Read-only.
 *
 * - index.json present: parsed and validated (fail closed).
 * - index.json missing and documentkb/ holds document dirs: unreadable, with the
 *   framework's remedy (`/aidlc knowledge sync` rebuilds it from metadata.json).
 * - otherwise: absent.
 *
 * Symbolic links: like assertKnowledgeRootTrusted, a link at ANY component of
 * aidlc/spaces/<space>/knowledge/documentkb/index.json is refused. Each
 * component is stat'ed on its own (stat of a link reports the SymbolicLink bit
 * for the link itself, whereas a stat of a child resolves links in its parents).
 * A component that does not exist cannot redirect anything: the catalog is
 * absent. The workspace folder itself may be a link, as in the framework (it
 * anchors at the real path of the project directory).
 * NOT covered: the check relies on the SymbolicLink bit of the file system
 * provider (reliable on the local disk; a virtual or remote provider may not set
 * it), a Windows junction is not reported as a link, and, as in the framework, a
 * link planted between the check and the read is not defended against.
 */
export async function readKbHealth(
  workspaceUri: vscode.Uri,
  space: string = studioSpace()
): Promise<KbHealth> {
  let kbDir = workspaceUri;
  const walked: string[] = [];
  for (const segment of kbChain(space)) {
    kbDir = vscode.Uri.joinPath(kbDir, segment);
    walked.push(segment);
    try {
      const stat = await vscode.workspace.fs.stat(kbDir);
      if (isSymlink(stat.type)) {
        return unreadableKbHealth(`${walked.join('/')}/ is a symbolic link; Studio does not follow it`, space);
      }
    } catch (error) {
      return isNotFound(error)
        ? absentKbHealth(space)
        : unreadableKbHealth(`${walked.join('/')}/ could not be read`, space);
    }
  }
  const indexUri = vscode.Uri.joinPath(kbDir, 'index.json');

  let indexSize: number;
  try {
    const indexStat = await vscode.workspace.fs.stat(indexUri);
    if (isSymlink(indexStat.type)) {
      return unreadableKbHealth('index.json is a symbolic link; Studio does not follow it', space);
    }
    if ((indexStat.type & vscode.FileType.File) === 0) {
      return unreadableKbHealth('index.json is not a regular file', space);
    }
    indexSize = indexStat.size;
  } catch (error) {
    if (!isNotFound(error)) {
      return unreadableKbHealth('index.json could not be read', space);
    }
    return (await hasDocumentDirs(kbDir))
      ? unreadableKbHealth('index.json is missing: /aidlc knowledge sync rebuilds it', space)
      : absentKbHealth(space);
  }

  if (indexSize > MAX_INDEX_BYTES) {
    return unreadableKbHealth('index.json is larger than 5 MB and was not read', space);
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(indexUri);
    if (bytes.byteLength > MAX_INDEX_BYTES) {
      return unreadableKbHealth('index.json is larger than 5 MB and was not read', space);
    }
    return parseKbIndex(Buffer.from(bytes).toString('utf-8'), space);
  } catch {
    return unreadableKbHealth('index.json could not be read', space);
  }
}

// documentkb/<id>/ directories (dotted entries such as .journal are scratch).
async function hasDocumentDirs(kbDir: vscode.Uri): Promise<boolean> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(kbDir);
    return entries.some(
      ([name, type]) => !name.startsWith('.') && (type & vscode.FileType.Directory) !== 0 && !isSymlink(type)
    );
  } catch {
    return false;
  }
}
