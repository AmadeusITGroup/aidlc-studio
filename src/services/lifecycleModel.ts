import { STAGE_DEFINITIONS } from './stageDefinitions';

/**
 * The model of the Analytics "Lifecycle" tab and the pure builder that makes it: the
 * stages of one intent grouped by phase, the stage running now, the gates waiting for
 * approval and the units x per-unit stages matrix.
 *
 * Pure: no `vscode`, no I/O. Every input is a file the framework wrote (state, stage
 * graph, runtime graph, unit dependency document, file listings) handed over as text, so
 * vitest covers it without mocks. All of them are untrusted: they are size-capped, every
 * line is length-capped BEFORE any expression runs on it, they are parsed defensively,
 * and their strings are only ever returned as data (the webview escapes them).
 *
 * `lifecycleCollector.ts` does the reads and re-exports everything from here.
 */

// --- Model (rendered by the Lifecycle tab of analyticsPanel.ts) ---

export type LifecycleStatus =
  | 'completed'
  | 'active'
  | 'awaiting-approval'
  | 'revised'
  | 'skipped'
  | 'pending';

export interface LifecycleStage {
  slug: string;
  number: string;
  name: string;
  /** Phase id: initialization | ideation | inception | construction | operation. */
  phase: string;
  status: LifecycleStatus;
  /** false = in the installed stage graph but absent from this intent's state file. */
  inPlan: boolean;
  /** Counted in the progress totals (= inPlan). */
  counted: boolean;
  skipReason?: string;
  /** Raw agent id (runtime agent, else graph lead_agent, else Studio's stage definition). */
  leadAgent: string;
  /** Stage graph `for_each` is `unit-of-work`. */
  perUnit: boolean;
  /**
   * Reviewable files on disk, workspace-relative POSIX paths. Ordered so that `artifacts[0]`
   * is the deliverable: by the position of the base name in the stage graph's `produces`,
   * then `optional_produces`, then the rest by path (a per-unit stage lists the stage
   * folder first, then each unit in Bolt order). Without a stage graph: by path.
   * A stage whose produces live in the space's codekb (reverse-engineering) lists those too.
   */
  artifacts: string[];
  sensors: { passed: number; failed: number; other: number };
  startedAt: string | null;
  completedAt: string | null;
}

export interface LifecyclePhase {
  id: string;
  name: string;
  stages: LifecycleStage[];
  /** Completed + skipped stages among the counted ones. */
  done: number;
  /** Counted stages. */
  total: number;
}

export interface LifecycleUnit {
  name: string;
  kind: string | null;
  /** 1-based batch (topological level) of the Bolt DAG. */
  batch: number;
  dependsOn: string[];
}

export type UnitCellState = 'done' | 'in-progress' | 'pending' | 'not-applicable';

export interface UnitCell {
  unit: string;
  stageSlug: string;
  state: UnitCellState;
  /** Required (`produces`) files on disk. Optional files never count, so they never block a cell. */
  present: number;
  /** Required (`produces`) files the unit's kind owes this stage. */
  expected: number;
  /** Required files on disk, then optional (`optional_produces`) ones, each in graph order. */
  files: string[];
}

export interface LifecycleModel {
  intentLabel: string;
  intentDir: string;
  scope: string;
  current: LifecycleStage | null;
  revisionCount: number | null;
  phases: LifecyclePhase[];
  gates: LifecycleStage[];
  units: LifecycleUnit[];
  unitStages: { slug: string; number: string; name: string }[];
  unitCells: UnitCell[];
  unitsSource: 'dependency-doc' | 'runtime-graph' | null;
  unitsError?: string;
  /**
   * Counted stages only (those in this intent's plan).
   * - `done`: completed + skipped, the framework's own progress (what the progress bar shows).
   * - `completed`: completed only, the figure the Overview tab's Stages card uses.
   * - `skipped`: skipped only. `done === completed + skipped`.
   */
  totals: { done: number; total: number; completed: number; skipped: number };
  hasStageGraph: boolean;
  hasRuntimeGraph: boolean;
}

/** What a collection gives: no intent, an intent that cannot be read (and why), or the model. */
export type LifecycleResult =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'ok'; model: LifecycleModel };

/** Raw texts and the file list the pure builder works from. */
export interface LifecycleInput {
  /** Text of `<record>/aidlc-state.md`. */
  stateText: string;
  /** Text of `.kiro/tools/data/stage-graph.json`, when present. */
  stageGraphText?: string | null;
  /** Text of `<record>/runtime-graph.json`, when present. */
  runtimeGraphText?: string | null;
  /** Text of `<record>/inception/units-generation/unit-of-work-dependency.md`, when it exists. */
  dependencyDocText?: string | null;
  /** The document exists but could not be read (too large, I/O error): fails closed. */
  dependencyDocError?: string | null;
  /** Workspace-relative POSIX record directory of the intent. */
  recordDir: string;
  /** Existing workspace-relative files under the record directory. */
  files: Iterable<string>;
  /** Workspace-relative POSIX codekb root of the space (`aidlc/spaces/<space>/codekb`). */
  codekbDir?: string;
  /** Existing workspace-relative files under `<codekbDir>/<repo>/`. */
  codekbFiles?: Iterable<string>;
}

// --- Limits (every input file is untrusted) ---

/** Largest file Studio reads for this tab. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STAGES = 500;
const MAX_UNITS = 1000;
const MAX_ARTIFACT_NAMES = 200;
const MAX_FILES = 20000;
/**
 * Longest line either parser looks at. Lines are capped BEFORE any expression runs on them:
 * a state line over the cap is ignored, a unit document line over the cap inside the units
 * block makes the document malformed. Every expression below is also linear on its own (no
 * lazy capture followed by a trailing whitespace run, no whitespace run next to an optional
 * group), so the cap is the second line of defence, not the only one. State rows and fields
 * are short; unit lines can carry an inline `depends_on` list.
 */
const MAX_STATE_LINE = 1024;
const MAX_DOC_LINE = 4096;
const MAX_TEXT = 300;

const PHASE_NAMES: Record<string, string> = {
  initialization: 'Initialization',
  ideation: 'Ideation',
  inception: 'Inception',
  construction: 'Construction',
  operation: 'Operation',
};

const SKIP_FALLBACK_REASON = 'Scope excludes this stage';
const NOT_IN_PLAN_REASON = "not in this intent's plan";

// --- Small helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) { return true; }
  }
  return false;
}

/** A name that may be used as ONE path segment: no separator, no `..`, no control character. */
export function isSafeSegment(name: string): boolean {
  return name.length > 0
    && name.length <= 200
    && name !== '.'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('..')
    && !hasControlChar(name);
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function phaseName(id: string): string {
  return PHASE_NAMES[id] ?? titleCase(id);
}

/** Framework-internal files: no human review (same rule as artifactsProvider.ts isFrameworkFile). */
function isFrameworkFile(fileName: string): boolean {
  return fileName === 'memory.md'
    || fileName === 'audit-trail.md'
    || fileName === 'runtime-graph.json'
    || fileName.startsWith('.aidlc');
}

/**
 * Studio's own stage definition for a slug, by exact slugified name. StateParser's
 * slug lookup is private and is left untouched: this only fills the number, name
 * and agent when no stage graph is installed.
 */
function definitionBySlug(slug: string): (typeof STAGE_DEFINITIONS)[number] | undefined {
  return STAGE_DEFINITIONS.find((d) => slugify(d.name) === slug);
}

// --- State file ---

// Framework source: .kiro/knowledge/aidlc-shared/state-template.md (Stage Progress, Current Status,
// Runtime State, Project Information sections) and the same row mapping as
// StateParser.parseStageProgress.

/** State file lines. A line over the cap is blanked here, before any expression sees it. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => (l.length > MAX_STATE_LINE ? '' : l));
}

/** Lines of a `## <heading>` section, up to the next `## ` heading (`###` does not end it). */
function sectionLines(lines: string[], heading: string): string[] | null {
  const start = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  let i = lines.findIndex((l) => start.test(l));
  if (i < 0) { return null; }
  const out: string[] = [];
  for (i++; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { break; }
    out.push(lines[i]);
  }
  return out;
}

/** `- **Key**: Value` in a section; empty and `Unknown` are absent (as StateParser). */
function boldField(section: string[] | null, key: string): string | null {
  if (!section) { return null; }
  // The value is everything after the colon, trimmed in code (no `\s*(.+)$` shape: it backtracks).
  const re = new RegExp(`^\\s*-\\s*\\*\\*${key}\\*\\*:(.*)$`, 'i');
  for (const line of section) {
    const m = re.exec(line);
    if (m && m[1] !== '') {
      const value = m[1].trim();
      return value === '' || value === 'Unknown' ? null : value;
    }
  }
  return null;
}

interface StateRow {
  slug: string;
  status: LifecycleStatus;
  /** Phase id of the `### <PHASE> PHASE` heading above the row; null before any heading. */
  phase: string | null;
  skipReason?: string;
}

function parseStageRows(lines: string[] | null): StateRow[] {
  const rows: StateRow[] = [];
  if (!lines) { return rows; }
  const seen = new Set<string>();
  let phase: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    const heading = trimmed.match(/^###\s+(\w+)\s+PHASE/i);
    if (heading) {
      phase = heading[1].toLowerCase();
      continue;
    }

    // Same expression as StateParser.parseStageProgress.
    const match = trimmed.match(/^-\s*\[([x\-?RS ])\]\s*([a-z0-9-]+)\s*—?\s*(EXECUTE|SKIP)?/i);
    if (!match) { continue; }
    const [whole, mark, slug, action] = match;
    if (seen.has(slug) || rows.length >= MAX_STAGES) { continue; }
    seen.add(slug);

    let status: LifecycleStatus;
    switch (mark) {
      case 'x': status = 'completed'; break;
      case '-': status = 'active'; break;
      case '?': status = 'awaiting-approval'; break;
      case 'R': status = 'revised'; break;
      case 'S': status = 'skipped'; break;
      default: status = 'pending'; break;
    }
    const isSkip = action?.toUpperCase() === 'SKIP';
    if (isSkip && status === 'pending') { status = 'skipped'; }

    const row: StateRow = { slug, status, phase };
    if (status === 'skipped' && isSkip) {
      // Greedy capture, trimmed in code: a lazy `(.+?)\s*$` backtracks cubically on hostile input.
      const reason = /^\s*:(.*)$/.exec(trimmed.slice(whole.length));
      const text = reason ? reason[1].trim().slice(0, MAX_TEXT) : '';
      row.skipReason = text !== '' ? text : SKIP_FALLBACK_REASON;
    }
    rows.push(row);
  }
  return rows;
}

// --- Stage graph ---

// Framework source: .kiro/tools/data/stage-graph.json (slug, number, name, phase, lead_agent, for_each,
// produces, optional_produces, produces_kinds); .kiro/tools/aidlc-lib.ts (StageEntry, loadStageGraph: nodes with
// enabled === false are not part of the graph).

interface GraphStage {
  slug: string;
  number: string;
  name: string;
  phase: string;
  leadAgent: string;
  perUnit: boolean;
  /** Required artifacts: what `expected` counts. */
  produces: string[];
  /** Optional artifacts: listed when on disk, never counted in `expected`. */
  optionalProduces: string[];
  /** artifact name -> unit kinds it applies to; null = no map. */
  producesKinds: Map<string, string[]> | null;
}

/** Artifact base names of a graph list: one safe path segment each, no duplicates. */
function artifactNames(value: unknown): string[] {
  if (!Array.isArray(value)) { return []; }
  const out: string[] = [];
  for (const p of value.slice(0, MAX_ARTIFACT_NAMES)) {
    if (typeof p === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && !p.includes('..') && !out.includes(p)) { out.push(p); }
  }
  return out;
}

function parseStageGraph(text: string | null | undefined): GraphStage[] | null {
  if (!text || text.length > MAX_FILE_BYTES) { return null; }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) { return null; }

  const stages: GraphStage[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (stages.length >= MAX_STAGES) { break; }
    if (!isRecord(entry) || entry.enabled === false) { continue; }
    const slug = asString(entry.slug);
    const phase = asString(entry.phase);
    if (!slug || !phase || !/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9_-]+$/.test(phase) || seen.has(slug)) { continue; }
    seen.add(slug);

    const produces = artifactNames(entry.produces);
    const optionalProduces = artifactNames(entry.optional_produces).filter((n) => !produces.includes(n));

    let producesKinds: Map<string, string[]> | null = null;
    if (isRecord(entry.produces_kinds)) {
      producesKinds = new Map();
      for (const [artifact, kinds] of Object.entries(entry.produces_kinds)) {
        if (Array.isArray(kinds)) {
          producesKinds.set(artifact, kinds.filter((k): k is string => typeof k === 'string'));
        }
      }
    }

    stages.push({
      slug,
      number: asString(entry.number, 20) ?? '',
      name: asString(entry.name) ?? titleCase(slug),
      phase,
      leadAgent: asString(entry.lead_agent) ?? '',
      perUnit: entry.for_each === 'unit-of-work',
      produces,
      optionalProduces,
      producesKinds,
    });
  }
  return stages.length > 0 ? stages : null;
}

/**
 * Artifacts of a per-unit stage that apply to a unit of this kind.
 * Framework source: .kiro/tools/aidlc-lib.ts (filterProducesByKind): no kind keeps every
 * name; a name absent from produces_kinds applies to every kind.
 */
function filterProducesByKind(
  producesKinds: Map<string, string[]> | null,
  names: string[],
  unitKind: string | null,
): string[] {
  if (unitKind === null || producesKinds === null) { return names; }
  return names.filter((name) => {
    const kinds = producesKinds.get(name);
    return kinds === undefined || kinds.includes(unitKind);
  });
}

// --- Runtime graph ---

// Framework source: .kiro/tools/aidlc-runtime.ts (RuntimeGraph, RuntimeStage, BoltInstance,
// SensorFiring, BoltDag). The file is compiled by a hook and git-ignored: it may be missing or stale.

interface RuntimeStageInfo {
  startedAt: string | null;
  completedAt: string | null;
  agent: string | null;
  sensors: { passed: number; failed: number; other: number };
}

interface RuntimeBoltDag {
  batches: string[][];
  kinds: Map<string, string>;
  dependsOn: Map<string, string[]>;
}

interface RuntimeData {
  stages: Map<string, RuntimeStageInfo>;
  boltDag: RuntimeBoltDag | null;
}

function countSensors(firings: unknown, into: { passed: number; failed: number; other: number }): void {
  if (!Array.isArray(firings)) { return; }
  for (const firing of firings) {
    const result = isRecord(firing) ? firing.result : undefined;
    if (result === 'passed') { into.passed++; }
    else if (result === 'failed') { into.failed++; }
    else { into.other++; }
  }
}

function parseRuntimeBoltDag(value: unknown): RuntimeBoltDag | null {
  if (!isRecord(value) || !Array.isArray(value.batches)) { return null; }
  const batches: string[][] = [];
  let count = 0;
  for (const batch of value.batches) {
    if (!Array.isArray(batch)) { return null; }
    const names: string[] = [];
    for (const unit of batch) {
      if (typeof unit !== 'string' || unit.length === 0) { return null; }
      names.push(unit);
    }
    count += names.length;
    if (count > MAX_UNITS) { return null; }
    batches.push(names);
  }
  if (count === 0) { return null; }

  const kinds = new Map<string, string>();
  const dependsOn = new Map<string, string[]>();
  if (Array.isArray(value.units)) {
    for (const unit of value.units) {
      if (!isRecord(unit) || typeof unit.name !== 'string') { continue; }
      if (typeof unit.kind === 'string') { kinds.set(unit.name, unit.kind); }
      if (Array.isArray(unit.depends_on)) {
        dependsOn.set(unit.name, unit.depends_on.filter((d): d is string => typeof d === 'string'));
      }
    }
  }
  return { batches, kinds, dependsOn };
}

function parseRuntimeGraph(text: string | null | undefined): RuntimeData | null {
  if (!text || text.length > MAX_FILE_BYTES) { return null; }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.stages)) { return null; }

  const stages = new Map<string, RuntimeStageInfo>();
  for (const stage of data.stages) {
    if (!isRecord(stage) || typeof stage.stage_slug !== 'string' || stages.has(stage.stage_slug)) { continue; }

    const sensors = { passed: 0, failed: 0, other: 0 };
    countSensors(stage.sensor_firings, sensors);

    let startedAt = asString(stage.started_at, 64);
    let completedAt = asString(stage.completed_at, 64);
    const agent = asString(stage.agent);

    if (Array.isArray(stage.instances)) {
      // A per-unit stage keeps its timing on each Bolt instance.
      const started: string[] = [];
      const completed: string[] = [];
      let allCompleted = stage.instances.length > 0;
      for (const instance of stage.instances) {
        if (!isRecord(instance)) { allCompleted = false; continue; }
        countSensors(instance.sensor_firings, sensors);
        const s = asString(instance.started_at, 64);
        const c = asString(instance.completed_at, 64);
        if (s !== null && !Number.isNaN(Date.parse(s))) { started.push(s); }
        if (c !== null && !Number.isNaN(Date.parse(c))) { completed.push(c); } else { allCompleted = false; }
      }
      if (startedAt === null && started.length > 0) {
        startedAt = started.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
      }
      if (completedAt === null && allCompleted && completed.length > 0) {
        completedAt = completed.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
      }
    }

    stages.set(stage.stage_slug, { startedAt, completedAt, agent, sensors });
  }

  return { stages, boltDag: parseRuntimeBoltDag(data.bolt_dag) };
}

// --- Unit dependency document ---

// Framework source: .kiro/tools/aidlc-lib.ts (parseBoltDag, extractYamlUnitsBlock, parseUnitsBlock,
// computeBatches, UNIT_KINDS, unitDependencyPath, resolveBoltDag). Ported without behaviour change;
// the only additions are the bounds on hostile input (MAX_DOC_LINE, MAX_UNITS).

const UNIT_KINDS = ['service', 'spec', 'ui', 'packaging', 'library'] as const;

interface UnitEdge {
  name: string;
  depends_on: string[];
  kind?: string;
}

type DocParse =
  | { ok: true; units: UnitEdge[]; batches: string[][] }
  | { ok: false; reason: 'absent' | 'malformed' | 'cyclic' | 'unreadable'; detail: string };

// A line the unit document parser may run an expression on.
function withinDocCap(line: string): boolean {
  return line.length <= MAX_DOC_LINE;
}

/** `units:` key line, found per line (never with a multiline expression over the whole block). */
function isUnitsKeyLine(line: string): boolean {
  return withinDocCap(line) && /^\s*units\s*:/.test(line);
}

/**
 * The lines of the first fenced yaml block that holds a `units:` key, or null. Fence lines are
 * short: an over-cap line is never a fence, and inside a candidate block it is kept as is (the
 * units parser rejects it) without any expression running on it.
 */
function extractYamlUnitsBlock(body: string): string[] | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (withinDocCap(lines[i]) && /^```ya?ml\s*$/.test(lines[i].trim())) {
      const inner: string[] = [];
      let hasUnits = false;
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (withinDocCap(lines[j]) && /^```\s*$/.test(lines[j].trim())) { break; }
        if (!hasUnits && isUnitsKeyLine(lines[j])) { hasUnits = true; }
        inner.push(lines[j]);
      }
      if (hasUnits) { return inner; }
      i = j; // not the units block: resume scanning past its close fence
    }
  }
  return null;
}

function unquoteScalar(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineDepsList(raw: string): string[] {
  const t = raw.trim();
  if (t === '' || t === '[]') { return []; }
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((s) => unquoteScalar(s))
      .filter((s) => s !== '');
  }
  return [unquoteScalar(t)]; // bare scalar: a one-item list
}

function parseUnitsBlock(lines: string[]): UnitEdge[] {
  let i = 0;
  for (; i < lines.length; i++) {
    if (isUnitsKeyLine(lines[i])) {
      const after = lines[i].replace(/^\s*units\s*:/, '').trim();
      if (after !== '') {
        throw new Error('units: must be a block list, not an inline value');
      }
      break;
    }
  }
  if (i >= lines.length) { throw new Error('missing units: key'); }
  i++;

  const edges: UnitEdge[] = [];
  let current: UnitEdge | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    // The cap comes first: no expression below ever sees a line over it.
    if (line.length > MAX_DOC_LINE) { throw new Error('line too long in units block'); }
    if (line.trim() === '') { continue; }

    // Values are captured greedily and trimmed in code: a lazy `(.+?)\s*$` backtracks on hostile input.
    const nameMatch = line.match(/^\s*-\s+name\s*:(.+)$/);
    if (nameMatch) {
      if (current) { edges.push(current); }
      if (edges.length >= MAX_UNITS) { throw new Error(`more than ${MAX_UNITS} units`); }
      current = { name: unquoteScalar(nameMatch[1]), depends_on: [] };
      continue;
    }

    const depMatch = line.match(/^\s*depends_on\s*:(.*)$/);
    if (depMatch) {
      if (!current) { throw new Error('depends_on: before any - name: entry'); }
      current.depends_on = parseInlineDepsList(depMatch[1]);
      continue;
    }

    const kindMatch = line.match(/^\s*kind\s*:(.+)$/);
    if (kindMatch) {
      if (!current) { throw new Error('kind: before any - name: entry'); }
      const value = unquoteScalar(kindMatch[1]);
      if (!(UNIT_KINDS as readonly string[]).includes(value)) {
        throw new Error(
          `unit "${current.name}" has invalid kind "${value}" (expected ${UNIT_KINDS.join('|')})`
        );
      }
      current.kind = value;
      continue;
    }

    // Block-form dependency item (a bare `- dep` under `depends_on:`).
    const itemMatch = line.match(/^\s*-\s(.+)$/);
    if (itemMatch && current) {
      current.depends_on.push(unquoteScalar(itemMatch[1]));
      continue;
    }

    throw new Error(`unrecognised line in units block: ${line.trim().slice(0, 80)}`);
  }
  if (current) { edges.push(current); }

  for (const e of edges) {
    if (!e.name.trim()) { throw new Error('unit with empty name'); }
  }
  return edges;
}

/** Kahn's algorithm by level; each level sorted. null = a cycle remains. */
function computeBatches(edges: UnitEdge[]): string[][] | null {
  const deps = new Map<string, string[]>();
  for (const e of edges) { deps.set(e.name, e.depends_on); }
  const remaining = new Set(edges.map((e) => e.name));
  const batches: string[][] = [];
  while (remaining.size > 0) {
    const level: string[] = [];
    for (const name of remaining) {
      const satisfied = (deps.get(name) ?? []).every((dep) => !remaining.has(dep));
      if (satisfied) { level.push(name); }
    }
    if (level.length === 0) { return null; }
    level.sort();
    for (const name of level) { remaining.delete(name); }
    batches.push(level);
  }
  return batches;
}

function parseDependencyDoc(body: string): DocParse {
  const block = extractYamlUnitsBlock(body);
  if (block === null) {
    return { ok: false, reason: 'absent', detail: 'no fenced ```yaml units: block found' };
  }

  let edges: UnitEdge[];
  try {
    edges = parseUnitsBlock(block);
  } catch (e) {
    return { ok: false, reason: 'malformed', detail: e instanceof Error ? e.message : String(e) };
  }
  if (edges.length === 0) {
    return { ok: false, reason: 'malformed', detail: 'units: block has no entries' };
  }

  const names = new Set<string>();
  for (const u of edges) {
    if (names.has(u.name)) {
      return { ok: false, reason: 'malformed', detail: `duplicate unit name: ${u.name}` };
    }
    names.add(u.name);
  }
  for (const u of edges) {
    for (const dep of u.depends_on) {
      if (dep === u.name) {
        return { ok: false, reason: 'malformed', detail: `unit "${u.name}" depends on itself` };
      }
      if (!names.has(dep)) {
        return { ok: false, reason: 'malformed', detail: `unit "${u.name}" depends on unknown unit "${dep}"` };
      }
    }
  }

  const batches = computeBatches(edges);
  if (batches === null) {
    return { ok: false, reason: 'cyclic', detail: 'dependency cycle detected' };
  }
  return { ok: true, units: edges, batches };
}

interface ResolvedUnits {
  units: LifecycleUnit[];
  source: 'dependency-doc' | 'runtime-graph' | null;
  error?: string;
}

/**
 * The authored document is authoritative whenever it exists (resolveBoltDag):
 * a document that does not parse gives no units and an error (fail closed);
 * the runtime graph `bolt_dag` is used only when the document is absent.
 */
function resolveUnits(input: LifecycleInput, runtime: RuntimeData | null): ResolvedUnits {
  if (input.dependencyDocError) {
    return { units: [], source: null, error: `unreadable: ${input.dependencyDocError.slice(0, MAX_TEXT)}` };
  }

  if (typeof input.dependencyDocText === 'string') {
    if (input.dependencyDocText.length > MAX_FILE_BYTES) {
      return { units: [], source: null, error: 'unreadable: file is larger than 2 MB' };
    }
    const parsed = parseDependencyDoc(input.dependencyDocText);
    if (!parsed.ok) {
      return { units: [], source: null, error: `${parsed.reason}: ${parsed.detail.slice(0, MAX_TEXT)}` };
    }
    const byName = new Map(parsed.units.map((u) => [u.name, u]));
    const units: LifecycleUnit[] = [];
    parsed.batches.forEach((batch, index) => {
      for (const name of batch) {
        const edge = byName.get(name);
        units.push({ name, kind: edge?.kind ?? null, batch: index + 1, dependsOn: edge ? [...edge.depends_on] : [] });
      }
    });
    return { units, source: 'dependency-doc' };
  }

  const dag = runtime?.boltDag;
  if (dag) {
    const seen = new Set<string>();
    const units: LifecycleUnit[] = [];
    dag.batches.forEach((batch, index) => {
      for (const name of [...batch].sort()) {
        if (seen.has(name)) { continue; }
        seen.add(name);
        units.push({ name, kind: dag.kinds.get(name) ?? null, batch: index + 1, dependsOn: dag.dependsOn.get(name) ?? [] });
      }
    });
    return { units, source: 'runtime-graph' };
  }

  return { units: [], source: null };
}

// --- Files on disk ---

/** Existing files under `dir`, as workspace-relative POSIX paths; anything else is dropped. */
function normalizeFiles(files: Iterable<string>, dir: string): Set<string> {
  const out = new Set<string>();
  let count = 0;
  const prefix = `${dir}/`;
  for (const file of files) {
    if (++count > MAX_FILES) { break; }
    if (typeof file !== 'string') { continue; }
    const norm = file.replace(/\\/g, '/');
    if (!norm.startsWith(prefix) || hasControlChar(norm) || norm.split('/').includes('..')) { continue; }
    out.add(norm);
  }
  return out;
}

/** A directory given by the collector must stay relative to the workspace. */
function normalizeRelativeDir(dir: string): string | null {
  const norm = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm === '' || norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || hasControlChar(norm) || norm.split('/').includes('..')) {
    return null;
  }
  return norm;
}

// --- Artifact order ---

// Framework source: .kiro/tools/aidlc-lib.ts (KNOWN_CODEKB_STAGES, producesArtifactFile, codekbDir,
// relativeCodekbDir). A codekb stage (reverse-engineering is the only one) writes its produces
// DIRECTLY under `aidlc/spaces/<space>/codekb/<repo>/<name>.md`, one <repo> segment, no <slug> segment.
// The framework narrows the repo to the intent's recorded set (intents.json `repos`, empty = any):
// Studio does not read the registry, so it lists every repo's file of the space.
const KNOWN_CODEKB_STAGES: ReadonlySet<string> = new Set(['reverse-engineering']);

function baseName(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * Orders files so the deliverable comes first: by the position of the base name in `ranked`
 * (the stage graph's `produces`, then `optional_produces`), then the rest by path. With no
 * `ranked` list (no stage graph) this is plain path order.
 */
function orderArtifacts(files: Iterable<string>, ranked: readonly string[]): string[] {
  const position = new Map<string, number>();
  ranked.forEach((name, index) => { if (!position.has(name)) { position.set(name, index); } });
  const rank = (file: string): number => position.get(baseName(file)) ?? ranked.length;
  return [...files]
    .map((file) => ({ file, rank: rank(file) }))
    .sort((a, b) => a.rank - b.rank || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((entry) => entry.file);
}

/** The codekb files a codekb stage produces: `<codekb>/<repo>/<name>.md` for a name of its graph entry. */
function codekbProduces(codekbFiles: Set<string>, codekbRoot: string, names: readonly string[]): string[] {
  if (names.length === 0) { return []; } // as producesArtifactFile: no produces, nothing matches
  const prefix = `${codekbRoot}/`;
  const out: string[] = [];
  for (const file of codekbFiles) {
    const parts = file.slice(prefix.length).split('/');
    if (parts.length !== 2 || !file.endsWith('.md') || isFrameworkFile(parts[1])) { continue; }
    if (names.includes(baseName(file))) { out.push(file); }
  }
  return out;
}

// --- Builder ---

function isRunning(status: LifecycleStatus): boolean {
  return status === 'active' || status === 'awaiting-approval' || status === 'revised';
}

/**
 * Builds the lifecycle model from raw texts. Pure: no vscode, no I/O, never throws on
 * malformed input (a bad optional file is treated as absent).
 */
export function buildLifecycleModel(input: LifecycleInput): LifecycleModel {
  const record = normalizeRelativeDir(input.recordDir);
  const files = record === null ? new Set<string>() : normalizeFiles(input.files, record);
  const recordPrefix = record ?? '';
  const codekbRoot = input.codekbDir !== undefined ? normalizeRelativeDir(input.codekbDir) : null;
  const codekbFiles = codekbRoot === null || input.codekbFiles === undefined
    ? new Set<string>()
    : normalizeFiles(input.codekbFiles, codekbRoot);

  const stateText = input.stateText.length > MAX_FILE_BYTES ? '' : input.stateText;
  const lines = splitLines(stateText);
  const projectInfo = sectionLines(lines, 'Project Information');
  const rows = parseStageRows(sectionLines(lines, 'Stage Progress'));
  const currentSlug = boldField(sectionLines(lines, 'Current Status'), 'Current Stage')?.replace(/`/g, '') ?? null;
  const revisionRaw = boldField(sectionLines(lines, 'Runtime State'), 'Revision Count');
  const revisionCount = revisionRaw !== null && /^\d{1,9}$/.test(revisionRaw) ? parseInt(revisionRaw, 10) : null;

  const graph = parseStageGraph(input.stageGraphText);
  const runtime = parseRuntimeGraph(input.runtimeGraphText);
  const graphBySlug = new Map((graph ?? []).map((g) => [g.slug, g]));
  const rowBySlug = new Map(rows.map((r) => [r.slug, r]));

  const resolved = resolveUnits(input, runtime);
  const units = resolved.units;

  /**
   * Artifacts a unit owes a per-unit stage, and the ones on disk (`construction/<unit>/<stage>/<name>.md`).
   * `expected` and `present` count the required `produces` only: an `optional_produces` file is
   * listed in `files` (after the required ones) when it exists, but its absence never blocks a cell.
   * Both lists keep the stage graph's order, so `files[0]` is the main deliverable.
   */
  const unitArtifacts = (unit: LifecycleUnit, g: GraphStage): { expected: number; present: number; files: string[] } => {
    const required = filterProducesByKind(g.producesKinds, g.produces, unit.kind);
    const optional = filterProducesByKind(g.producesKinds, g.optionalProduces, unit.kind);
    // The unit name comes from an untrusted file: no path is built from an unsafe one.
    const safe = record !== null && isSafeSegment(unit.name);
    const onDisk = (names: string[]): string[] => safe
      ? names
          .map((n) => `${recordPrefix}/construction/${unit.name}/${g.slug}/${n}.md`)
          .filter((p) => files.has(p) && !isFrameworkFile(p.slice(p.lastIndexOf('/') + 1)))
      : [];
    const found = onDisk(required);
    return { expected: required.length, present: found.length, files: [...found, ...onDisk(optional)] };
  };

  // Order: the stage graph when installed (the engine emits the rows in that order),
  // then the state rows the graph does not know; without a graph, the state order.
  const order: { slug: string; row?: StateRow; g?: GraphStage }[] = [];
  const placed = new Set<string>();
  for (const g of graph ?? []) {
    order.push({ slug: g.slug, row: rowBySlug.get(g.slug), g });
    placed.add(g.slug);
  }
  for (const row of rows) {
    if (!placed.has(row.slug)) { order.push({ slug: row.slug, row }); }
  }

  const stages: LifecycleStage[] = order.map(({ slug, row, g }) => {
    const def = g ? undefined : definitionBySlug(slug);
    const rt = runtime?.stages.get(slug);
    const inPlan = row !== undefined;
    const phase = row?.phase ?? g?.phase ?? 'initialization';
    const perUnit = g?.perUnit ?? false;

    // Stage folder (and the codekb files of a codekb stage), the deliverable first; then, for a
    // per-unit stage, each unit's files in Bolt order, each unit in graph order.
    const ranked = g ? [...g.produces, ...g.optionalProduces] : [];
    const stageFiles = new Set<string>();
    if (record !== null) {
      const dir = `${recordPrefix}/${phase}/${slug}/`;
      for (const f of files) {
        if (f.startsWith(dir) && !isFrameworkFile(f.slice(f.lastIndexOf('/') + 1))) { stageFiles.add(f); }
      }
    }
    if (g && codekbRoot !== null && KNOWN_CODEKB_STAGES.has(slug)) {
      for (const f of codekbProduces(codekbFiles, codekbRoot, ranked)) { stageFiles.add(f); }
    }
    const artifactSet = new Set<string>(orderArtifacts(stageFiles, ranked));
    if (record !== null && perUnit && g) {
      for (const unit of units) {
        for (const f of unitArtifacts(unit, g).files) { artifactSet.add(f); }
      }
    }

    const stage: LifecycleStage = {
      slug,
      number: g?.number ?? def?.id ?? '',
      name: g?.name ?? def?.name ?? titleCase(slug),
      phase,
      status: row?.status ?? 'skipped',
      inPlan,
      counted: inPlan,
      leadAgent: rt?.agent ?? g?.leadAgent ?? def?.leadAgent ?? '',
      perUnit,
      artifacts: [...artifactSet],
      sensors: rt?.sensors ?? { passed: 0, failed: 0, other: 0 },
      startedAt: rt?.startedAt ?? null,
      completedAt: rt?.completedAt ?? null,
    };
    if (!inPlan) {
      stage.skipReason = NOT_IN_PLAN_REASON;
    } else if (row?.skipReason !== undefined) {
      stage.skipReason = row.skipReason;
    }
    return stage;
  });

  // Phases in order of first appearance.
  const phases: LifecyclePhase[] = [];
  for (const stage of stages) {
    let phase = phases.find((p) => p.id === stage.phase);
    if (!phase) {
      phase = { id: stage.phase, name: phaseName(stage.phase), stages: [], done: 0, total: 0 };
      phases.push(phase);
    }
    phase.stages.push(stage);
    if (stage.counted) {
      phase.total++;
      if (stage.status === 'completed' || stage.status === 'skipped') { phase.done++; }
    }
  }

  const counted = stages.filter((s) => s.counted);
  const current =
    (currentSlug !== null ? counted.find((s) => s.slug === currentSlug) : undefined)
    ?? counted.find((s) => isRunning(s.status))
    ?? null;

  // Unit x per-unit stage matrix.
  const unitStageList = stages.filter((s) => s.perUnit);
  const unitStages = units.length > 0
    ? unitStageList.map((s) => ({ slug: s.slug, number: s.number, name: s.name }))
    : [];
  const unitCells: UnitCell[] = [];
  if (units.length > 0) {
    for (const stage of unitStageList) {
      const g = graphBySlug.get(stage.slug);
      if (!g) { continue; }
      for (const unit of units) {
        unitCells.push(buildCell(unit, stage, unitArtifacts(unit, g)));
      }
    }
  }

  // `done` is the framework's own progress (completed + skipped); `completed` is the figure the
  // Overview tab's Stages card counts, so the two tabs can show the same number side by side.
  const completed = counted.filter((s) => s.status === 'completed').length;
  const skipped = counted.filter((s) => s.status === 'skipped').length;
  const totals = { done: completed + skipped, total: counted.length, completed, skipped };

  const recordName = recordPrefix.slice(recordPrefix.lastIndexOf('/') + 1);
  const model: LifecycleModel = {
    intentLabel: boldField(projectInfo, 'Project')?.slice(0, MAX_TEXT) ?? (recordName || 'Unknown Intent'),
    intentDir: recordPrefix,
    scope: boldField(projectInfo, 'Scope')?.slice(0, MAX_TEXT) ?? '',
    current,
    revisionCount,
    phases,
    gates: counted.filter((s) => s.status === 'awaiting-approval'),
    units,
    unitStages,
    unitCells,
    unitsSource: resolved.source,
    totals,
    hasStageGraph: graph !== null,
    hasRuntimeGraph: runtime !== null,
  };
  if (resolved.error !== undefined) { model.unitsError = resolved.error; }
  return model;
}

/**
 * One cell of the units matrix. The cell reflects the artifacts on disk, while the
 * approval gate belongs to the stage: a cell is 'done' once the stage is completed
 * (or every expected file exists while the stage runs), never because a reviewer
 * approved that one unit. While a stage is revising, its files are the rejected round's: a
 * cell is at most in progress.
 */
function buildCell(
  unit: LifecycleUnit,
  stage: LifecycleStage,
  found: { expected: number; present: number; files: string[] },
): UnitCell {
  const { expected, present, files } = found;
  let state: UnitCellState;
  if (stage.status === 'skipped' || !stage.inPlan || expected === 0) {
    state = 'not-applicable';
  } else if (stage.status === 'completed') {
    state = 'done';
  } else if (stage.status === 'pending') {
    state = 'pending';
  } else if (present === expected) {
    // A revising stage is reworking its artifacts: the files of the rejected round are still on
    // disk, so they say nothing about whether the unit is done.
    state = stage.status === 'revised' ? 'in-progress' : 'done';
  } else if (present > 0) {
    state = 'in-progress';
  } else {
    state = 'pending';
  }
  return { unit: unit.name, stageSlug: stage.slug, state, present, expected, files };
}
