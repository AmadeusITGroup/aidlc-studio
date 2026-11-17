import { describe, expect, it } from 'vitest';
import { LifecycleInput, buildLifecycleModel } from './lifecycleModel';

// The pure builder: no vscode import, no mock.

const REC = 'aidlc/spaces/default/intents/260101-demo';

const HEAD = `# AI-DLC State Tracking

## Project Information
- **Project**: Demo intent
- **Project Type**: Greenfield
- **Scope**: feature
- **Start Date**: 2026-01-01T00:00:00Z
`;

function state(stageProgress: string, opts: { current?: string; revision?: string } = {}): string {
  return `${HEAD}
## Runtime State
${opts.revision !== undefined ? `- **Revision Count**: ${opts.revision}\n` : ''}
## Stage Progress
${stageProgress}

## Current Status
- **Lifecycle Phase**: IDEATION
${opts.current !== undefined ? `- **Current Stage**: ${opts.current}\n` : ''}- **Status**: Running
`;
}

function build(stateText: string, extra: Partial<LifecycleInput> = {}) {
  return buildLifecycleModel({ stateText, recordDir: REC, files: [], ...extra });
}

const allStages = (m: ReturnType<typeof build>) => m.phases.flatMap((p) => p.stages);
const bySlug = (m: ReturnType<typeof build>, slug: string) => {
  const stage = allStages(m).find((s) => s.slug === slug);
  if (!stage) { throw new Error(`no stage ${slug}`); }
  return stage;
};

// A small stage graph in the shape of .kiro/tools/data/stage-graph.json.
const GRAPH = JSON.stringify([
  { slug: 'intent-capture', number: '1.1', name: 'Intent Capture', phase: 'ideation', lead_agent: 'aidlc-product-agent', produces: ['intent-statement'] },
  { slug: 'feasibility', number: '1.3', name: 'Feasibility', phase: 'ideation', lead_agent: 'aidlc-architect-agent', produces: ['feasibility-assessment'] },
  { slug: 'units-generation', number: '2.7', name: 'Units Generation', phase: 'inception', lead_agent: 'aidlc-architect-agent', produces: ['unit-of-work-dependency'] },
  {
    slug: 'functional-design', number: '3.1', name: 'Functional Design', phase: 'construction',
    lead_agent: 'aidlc-architect-agent', for_each: 'unit-of-work',
    produces: ['business-logic-model', 'business-rules', 'domain-entities'],
    optional_produces: ['frontend-components'],
    produces_kinds: {
      'business-logic-model': ['service', 'ui', 'library'],
      'business-rules': ['service', 'spec', 'library'],
      'frontend-components': ['ui'],
    },
  },
  { slug: 'code-generation', number: '3.5', name: 'Code Generation', phase: 'construction', lead_agent: 'aidlc-developer-agent', for_each: 'unit-of-work', produces: ['code-generation-plan', 'code-summary'] },
  { slug: 'extra-stage', number: '4.9', name: 'Extra Stage', phase: 'operation', lead_agent: 'aidlc-operations-agent', produces: [] },
]);

const GRAPH_STATE = state(`### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [?] feasibility — EXECUTE
### INCEPTION PHASE
- [x] units-generation — EXECUTE
### CONSTRUCTION PHASE
- [-] functional-design — EXECUTE
- [ ] code-generation — EXECUTE`, { current: 'functional-design', revision: '2' });

const DOC = `# Unit of work dependency

\`\`\`mermaid
graph TD; auth --> api
\`\`\`

\`\`\`yaml
units:
  - name: auth
    kind: service
    depends_on: []
  - name: api
    kind: ui
    depends_on: [auth]
  - name: docs
    kind: spec
    depends_on:
      - auth
\`\`\`
`;

const doc = (yaml: string) => `\`\`\`yaml\nunits:\n${yaml}\n\`\`\`\n`;

describe('lifecycle model: state rows', () => {
  it('maps the six checkbox marks', () => {
    const m = build(state(`### IDEATION PHASE
- [x] a-done — EXECUTE
- [-] b-active — EXECUTE
- [?] c-await — EXECUTE
- [R] d-revised — EXECUTE
- [S] e-skipped — SKIP
- [ ] f-pending — EXECUTE`));
    expect(allStages(m).map((s) => [s.slug, s.status])).toEqual([
      ['a-done', 'completed'], ['b-active', 'active'], ['c-await', 'awaiting-approval'],
      ['d-revised', 'revised'], ['e-skipped', 'skipped'], ['f-pending', 'pending'],
    ]);
    expect(m.phases).toHaveLength(1);
    expect(m.phases[0]).toMatchObject({ id: 'ideation', name: 'Ideation', total: 6, done: 2 });
    expect(m.totals).toEqual({ done: 2, total: 6, completed: 1, skipped: 1 });
  });

  it('keeps the SKIP reason, and gives a bare SKIP the default reason', () => {
    const m = build(state(`### IDEATION PHASE
- [S] one — SKIP: covered by the existing design
- [ ] two — SKIP
- [S] three — EXECUTE`));
    expect(bySlug(m, 'one')).toMatchObject({ status: 'skipped', skipReason: 'covered by the existing design' });
    expect(bySlug(m, 'two')).toMatchObject({ status: 'skipped', skipReason: 'Scope excludes this stage' });
    expect(bySlug(m, 'three').status).toBe('skipped');
    expect(bySlug(m, 'three').skipReason).toBeUndefined();
  });

  it('reads the intent label and scope from Project Information', () => {
    const m = build(state(''));
    expect(m.intentLabel).toBe('Demo intent');
    expect(m.scope).toBe('feature');
    expect(m.intentDir).toBe(REC);
  });

  it('resolves the current stage from Current Status, then falls back to the first running row', () => {
    const rows = `### IDEATION PHASE
- [x] one — EXECUTE
- [-] two — EXECUTE
- [?] three — EXECUTE`;
    expect(build(state(rows, { current: 'three' })).current?.slug).toBe('three');
    expect(build(state(rows, { current: 'no-such-stage' })).current?.slug).toBe('two');
    expect(build(state(rows)).current?.slug).toBe('two');
    expect(build(state('### IDEATION PHASE\n- [x] one — EXECUTE')).current).toBeNull();
  });

  it('reads the revision count, null when absent or not an integer', () => {
    expect(build(state('', { revision: '3' })).revisionCount).toBe(3);
    expect(build(state('', { revision: '0' })).revisionCount).toBe(0);
    expect(build(state('')).revisionCount).toBeNull();
    expect(build(state('', { revision: 'many' })).revisionCount).toBeNull();
  });

  it('lists the stages awaiting approval as gates, in order', () => {
    const m = build(state(`### IDEATION PHASE
- [?] one — EXECUTE
- [-] two — EXECUTE
### INCEPTION PHASE
- [?] three — EXECUTE`));
    expect(m.gates.map((s) => s.slug)).toEqual(['one', 'three']);
  });

  it('survives a state file with no Stage Progress section', () => {
    const m = build(`${HEAD}\n## Current Status\n- **Current Stage**: none\n`);
    expect(m.phases).toEqual([]);
    expect(m.gates).toEqual([]);
    expect(m.current).toBeNull();
    expect(m.totals).toEqual({ done: 0, total: 0, completed: 0, skipped: 0 });
    expect(m.units).toEqual([]);
  });

  it('survives CRLF line endings and an empty state', () => {
    const m = build(state('### IDEATION PHASE\n- [x] one — EXECUTE').replace(/\n/g, '\r\n'));
    expect(bySlug(m, 'one').status).toBe('completed');
    expect(() => build('')).not.toThrow();
  });
});

describe('lifecycle model: stage graph', () => {
  it('merges the graph: number, name, agent, order, and a not-in-plan stage', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH });
    expect(m.hasStageGraph).toBe(true);
    expect(m.phases.map((p) => p.id)).toEqual(['ideation', 'inception', 'construction', 'operation']);
    expect(bySlug(m, 'feasibility')).toMatchObject({
      number: '1.3', name: 'Feasibility', leadAgent: 'aidlc-architect-agent', status: 'awaiting-approval', inPlan: true, counted: true,
    });
    const extra = bySlug(m, 'extra-stage');
    expect(extra).toMatchObject({ status: 'skipped', inPlan: false, counted: false, skipReason: "not in this intent's plan" });
    // The stage not in the plan is shown but not counted.
    const operation = m.phases.find((p) => p.id === 'operation')!;
    expect(operation).toMatchObject({ total: 0, done: 0 });
    expect(m.totals).toEqual({ done: 2, total: 5, completed: 2, skipped: 0 });
    expect(m.gates.map((s) => s.slug)).toEqual(['feasibility']);
    expect(m.current?.slug).toBe('functional-design');
    expect(m.revisionCount).toBe(2);
    expect(bySlug(m, 'functional-design').perUnit).toBe(true);
    expect(bySlug(m, 'feasibility').perUnit).toBe(false);
  });

  it('skips graph nodes disabled by a plugin selection and ignores a malformed graph', () => {
    const disabled = JSON.stringify([
      { slug: 'intent-capture', phase: 'ideation', enabled: false, lead_agent: 'graph-agent' },
      { slug: 'feasibility', phase: 'ideation', number: '1.3', name: 'Feasibility' },
    ]);
    const m = build(GRAPH_STATE, { stageGraphText: disabled });
    // The row stays (the state file lists it) but nothing comes from the disabled graph node.
    expect(bySlug(m, 'intent-capture')).toMatchObject({ leadAgent: 'product', inPlan: true });
    expect(bySlug(m, 'feasibility').number).toBe('1.3');

    for (const bad of ['not json', '{"a":1}', '[]', '[1,"x",null]', JSON.stringify([{ slug: '../x', phase: 'ideation' }])]) {
      const mm = build(GRAPH_STATE, { stageGraphText: bad });
      expect(mm.hasStageGraph).toBe(false);
      expect(mm.phases.length).toBeGreaterThan(0);
    }
  });

  it('works without a graph: Studio definitions fill the name, headings give the order', () => {
    const m = build(state(`### INCEPTION PHASE
- [x] user-stories — EXECUTE
### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [ ] some-new-stage — EXECUTE`));
    expect(m.hasStageGraph).toBe(false);
    expect(m.phases.map((p) => p.id)).toEqual(['inception', 'ideation']);
    expect(bySlug(m, 'intent-capture')).toMatchObject({ number: '1.1', name: 'Intent Capture' });
    expect(bySlug(m, 'some-new-stage')).toMatchObject({ number: '', name: 'Some New Stage', leadAgent: '' });
    expect(allStages(m).every((s) => s.counted && s.inPlan && !s.perUnit)).toBe(true);
    expect(m.unitStages).toEqual([]);
  });
});

describe('lifecycle model: runtime graph', () => {
  const runtime = JSON.stringify({
    workflow_id: 'w', scope: 'feature', started_at: '2026-01-01T00:00:00Z',
    stages: [
      {
        stage_slug: 'intent-capture', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:10:00Z', agent: 'runtime-agent',
        sensor_firings: [{ id: 's1', result: 'passed' }, { id: 's2', result: 'failed' }, { id: 's3', result: 'budget-override' }],
      },
      {
        stage_slug: 'functional-design', started_at: null, completed_at: null, agent: null,
        sensor_firings: [{ id: 's4', result: 'passed' }],
        instances: [
          { bolt: 'a', started_at: '2026-01-02T00:00:00Z', completed_at: '2026-01-02T01:00:00Z', sensor_firings: [{ result: 'passed' }, { result: 'incomplete' }] },
          { bolt: 'b', started_at: '2026-01-01T12:00:00Z', completed_at: '2026-01-02T03:00:00Z', sensor_firings: [{ result: 'failed' }] },
        ],
      },
    ],
  });

  it('adds timing, agent and sensors (top level plus instances)', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, runtimeGraphText: runtime });
    expect(m.hasRuntimeGraph).toBe(true);
    expect(bySlug(m, 'intent-capture')).toMatchObject({
      leadAgent: 'runtime-agent',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:10:00Z',
      sensors: { passed: 1, failed: 1, other: 1 },
    });
    expect(bySlug(m, 'functional-design')).toMatchObject({
      leadAgent: 'aidlc-architect-agent', // runtime agent is null: the graph's lead_agent
      startedAt: '2026-01-01T12:00:00Z',
      completedAt: '2026-01-02T03:00:00Z',
      sensors: { passed: 2, failed: 1, other: 1 },
    });
    expect(bySlug(m, 'feasibility')).toMatchObject({ startedAt: null, completedAt: null, sensors: { passed: 0, failed: 0, other: 0 } });
  });

  it('treats malformed runtime graphs as absent and never throws', () => {
    for (const bad of ['{not json', '[]', '"x"', '{"stages":"no"}', '']) {
      const m = build(GRAPH_STATE, { runtimeGraphText: bad });
      expect(m.hasRuntimeGraph).toBe(false);
      expect(bySlug(m, 'feasibility').startedAt).toBeNull();
    }
    const odd = build(GRAPH_STATE, { runtimeGraphText: JSON.stringify({ stages: [null, 3, { stage_slug: 5 }, { stage_slug: 'feasibility', sensor_firings: 'x', instances: [null] }] }) });
    expect(odd.hasRuntimeGraph).toBe(true);
    expect(bySlug(odd, 'feasibility').sensors).toEqual({ passed: 0, failed: 0, other: 0 });
  });
});

describe('lifecycle model: units', () => {
  it('reads units, kinds and batches from the dependency document', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC });
    expect(m.unitsSource).toBe('dependency-doc');
    expect(m.unitsError).toBeUndefined();
    expect(m.units).toEqual([
      { name: 'auth', kind: 'service', batch: 1, dependsOn: [] },
      { name: 'api', kind: 'ui', batch: 2, dependsOn: ['auth'] },
      { name: 'docs', kind: 'spec', batch: 2, dependsOn: ['auth'] },
    ]);
    expect(m.unitStages.map((s) => s.slug)).toEqual(['functional-design', 'code-generation']);
  });

  it('orders units by batch then name whatever the authoring order', () => {
    const m = build(GRAPH_STATE, {
      dependencyDocText: doc(`  - name: zeta\n    depends_on: [mid]\n  - name: mid\n    depends_on: [alpha, beta]\n  - name: beta\n  - name: alpha\n    depends_on: []`),
    });
    expect(m.units.map((u) => `${u.batch}:${u.name}`)).toEqual(['1:alpha', '1:beta', '2:mid', '3:zeta']);
    expect(m.units.every((u) => u.kind === null)).toBe(true);
  });

  it('accepts quoted names and inline lists', () => {
    const m = build(GRAPH_STATE, { dependencyDocText: doc(`  - name: "a b"\n  - name: 'c'\n    depends_on: ["a b"]`) });
    expect(m.units.map((u) => [u.name, u.batch, u.dependsOn])).toEqual([['a b', 1, []], ['c', 2, ['a b']]]);
  });

  it('uses the runtime graph bolt_dag only when the document is absent', () => {
    const runtime = JSON.stringify({
      stages: [],
      bolt_dag: { batches: [['b', 'a'], ['c']], units: [{ name: 'a', depends_on: [], kind: 'service' }, { name: 'c', depends_on: ['a', 'b'] }] },
    });
    const fromRuntime = build(GRAPH_STATE, { runtimeGraphText: runtime });
    expect(fromRuntime.unitsSource).toBe('runtime-graph');
    expect(fromRuntime.units).toEqual([
      { name: 'a', kind: 'service', batch: 1, dependsOn: [] },
      { name: 'b', kind: null, batch: 1, dependsOn: [] },
      { name: 'c', kind: null, batch: 2, dependsOn: ['a', 'b'] },
    ]);

    // The authored document wins over the cache.
    const both = build(GRAPH_STATE, { runtimeGraphText: runtime, dependencyDocText: DOC });
    expect(both.unitsSource).toBe('dependency-doc');
    expect(both.units.map((u) => u.name)).toEqual(['auth', 'api', 'docs']);

    // A document that does not parse fails closed even though the cache is valid.
    const broken = build(GRAPH_STATE, { runtimeGraphText: runtime, dependencyDocText: 'no block here' });
    expect(broken.units).toEqual([]);
    expect(broken.unitsSource).toBeNull();
    expect(broken.unitsError).toMatch(/^absent: /);
  });

  it('ignores a malformed bolt_dag', () => {
    for (const dag of [{ batches: 'x' }, { batches: [] }, { batches: [[1]] }, { batches: [['']] }, { batches: [['a'], 'b'] }, null]) {
      const m = build(GRAPH_STATE, { runtimeGraphText: JSON.stringify({ stages: [], bolt_dag: dag }) });
      expect(m.units).toEqual([]);
      expect(m.unitsSource).toBeNull();
      expect(m.unitsError).toBeUndefined();
    }
  });

  it('has no units and no error when neither source exists', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH });
    expect(m).toMatchObject({ units: [], unitsSource: null, unitStages: [], unitCells: [] });
    expect(m.unitsError).toBeUndefined();
  });

  describe('a document that exists but does not parse gives unitsError and no units', () => {
    const cases: [string, string, RegExp][] = [
      ['no yaml units block', '# nothing\n```yaml\nother: 1\n```', /^absent: /],
      ['empty units block', doc(''), /^malformed: units: block has no entries/],
      ['inline units value', '```yaml\nunits: [a, b]\n```', /^malformed: units: must be a block list/],
      ['empty name', doc('  - name: ""'), /^malformed: unit with empty name/],
      ['whitespace-only name', doc('  - name: "   "'), /^malformed: unit with empty name/],
      ['duplicate name', doc('  - name: a\n  - name: a'), /^malformed: duplicate unit name: a/],
      ['self dependency', doc('  - name: a\n    depends_on: [a]'), /^malformed: unit "a" depends on itself/],
      ['unknown dependency', doc('  - name: a\n    depends_on: [ghost]'), /^malformed: unit "a" depends on unknown unit "ghost"/],
      ['invalid kind', doc('  - name: a\n    kind: database'), /^malformed: unit "a" has invalid kind "database"/],
      ['kind before any name', doc('    kind: service\n  - name: a'), /^malformed: kind: before any - name: entry/],
      ['depends_on before any name', doc('    depends_on: []\n  - name: a'), /^malformed: depends_on: before any/],
      ['unrecognised line', doc('  - name: a\n  something odd'), /^malformed: unrecognised line/],
      ['cycle', doc('  - name: a\n    depends_on: [b]\n  - name: b\n    depends_on: [a]'), /^cyclic: dependency cycle detected/],
      ['hostile line length', doc(`  - name: a\n    kind: ${' '.repeat(5000)}x`), /^malformed: line too long/],
    ];
    it.each(cases)('%s', (_label, text, expected) => {
      const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: text });
      expect(m.units).toEqual([]);
      expect(m.unitCells).toEqual([]);
      expect(m.unitStages).toEqual([]);
      expect(m.unitsSource).toBeNull();
      expect(m.unitsError).toMatch(expected);
    });

    it('an unreadable document is also an error', () => {
      const m = build(GRAPH_STATE, { dependencyDocError: 'file is larger than 2 MB', dependencyDocText: null });
      expect(m.unitsSource).toBeNull();
      expect(m.unitsError).toBe('unreadable: file is larger than 2 MB');
    });
  });
});

describe('lifecycle model: artifacts and unit cells', () => {
  const FD = `${REC}/construction/functional-design`;
  const files = [
    `${REC}/ideation/intent-capture/intent-statement.md`,
    `${REC}/ideation/intent-capture/memory.md`,
    `${REC}/ideation/intent-capture/audit-trail.md`,
    `${REC}/ideation/intent-capture/runtime-graph.json`,
    `${REC}/ideation/intent-capture/.aidlc-lock`,
    `${REC}/ideation/intent-capture/questions/q1.md`,
    `${REC}/ideation/feasibility/feasibility-assessment.md`,
    // per-unit artifacts of the running per-unit stage
    `${REC}/construction/auth/functional-design/business-logic-model.md`,
    `${REC}/construction/auth/functional-design/business-rules.md`,
    `${REC}/construction/auth/functional-design/domain-entities.md`,
    `${REC}/construction/api/functional-design/business-logic-model.md`,
    `${REC}/construction/auth/functional-design/memory.md`,
    `${FD}/not-per-unit.md`,
    // outside the record: never attributed
    'other/ideation/intent-capture/leak.md',
  ];

  it('lists reviewable stage files, sorted, without framework files', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, files });
    expect(bySlug(m, 'intent-capture').artifacts).toEqual([
      `${REC}/ideation/intent-capture/intent-statement.md`,
      `${REC}/ideation/intent-capture/questions/q1.md`,
    ]);
    expect(bySlug(m, 'feasibility').artifacts).toEqual([`${REC}/ideation/feasibility/feasibility-assessment.md`]);
    expect(bySlug(m, 'extra-stage').artifacts).toEqual([]);
  });

  it('adds the per-unit files to a per-unit stage', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC, files });
    // The stage folder first, then each unit in Bolt order (auth is batch 1, api batch 2), each unit's
    // files in the order of the graph's produces.
    expect(bySlug(m, 'functional-design').artifacts).toEqual([
      `${FD}/not-per-unit.md`,
      `${REC}/construction/auth/functional-design/business-logic-model.md`,
      `${REC}/construction/auth/functional-design/business-rules.md`,
      `${REC}/construction/auth/functional-design/domain-entities.md`,
      `${REC}/construction/api/functional-design/business-logic-model.md`,
    ]);
  });

  it('computes each cell state, pruning expected artifacts by unit kind', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC, files });
    const cell = (unit: string, stage: string) => m.unitCells.find((c) => c.unit === unit && c.stageSlug === stage)!;
    expect(m.unitCells).toHaveLength(6); // 3 units x 2 per-unit stages

    // functional-design is running: the cell follows the files on disk.
    // service: all 3 apply (domain-entities has no kind map entry); ui: business-rules pruned; spec: business-logic-model pruned.
    expect(cell('auth', 'functional-design')).toMatchObject({ state: 'done', present: 3, expected: 3 });
    expect(cell('auth', 'functional-design').files).toEqual([
      `${REC}/construction/auth/functional-design/business-logic-model.md`,
      `${REC}/construction/auth/functional-design/business-rules.md`,
      `${REC}/construction/auth/functional-design/domain-entities.md`,
    ]);
    expect(cell('api', 'functional-design')).toMatchObject({ state: 'in-progress', present: 1, expected: 2 });
    expect(cell('docs', 'functional-design')).toMatchObject({ state: 'pending', present: 0, expected: 2 });

    // code-generation is pending: pending whatever is on disk; no kind map = every artifact applies.
    expect(cell('auth', 'code-generation')).toMatchObject({ state: 'pending', expected: 2 });
  });

  it('marks completed, skipped, not-in-plan and artifact-less stages', () => {
    const graph = JSON.stringify([
      { slug: 'done-stage', phase: 'construction', for_each: 'unit-of-work', produces: ['one'] },
      { slug: 'skipped-stage', phase: 'construction', for_each: 'unit-of-work', produces: ['one'] },
      { slug: 'missing-stage', phase: 'construction', for_each: 'unit-of-work', produces: ['one'] },
      { slug: 'empty-stage', phase: 'construction', for_each: 'unit-of-work', produces: [] },
      { slug: 'await-stage', phase: 'construction', for_each: 'unit-of-work', produces: ['one', 'two'] },
    ]);
    const m = build(state(`### CONSTRUCTION PHASE
- [x] done-stage — EXECUTE
- [S] skipped-stage — SKIP
- [ ] empty-stage — EXECUTE
- [?] await-stage — EXECUTE`), {
      stageGraphText: graph,
      dependencyDocText: doc('  - name: u'),
      files: [`${REC}/construction/u/await-stage/one.md`, `${REC}/construction/u/await-stage/two.md`],
    });
    const state_ = (slug: string) => m.unitCells.find((c) => c.stageSlug === slug)!.state;
    expect(state_('done-stage')).toBe('done'); // the gate belongs to the stage, not to the files
    expect(state_('skipped-stage')).toBe('not-applicable');
    expect(state_('missing-stage')).toBe('not-applicable'); // in the graph, not in this plan
    expect(state_('empty-stage')).toBe('not-applicable'); // nothing expected
    expect(state_('await-stage')).toBe('done'); // awaiting approval with every file present
  });

  it('never builds a path from an unsafe unit name', () => {
    const names = ['../escape', 'a/b', 'a\\b', 'a..b', 'ctl\u0001x'];
    const yaml = names.map((n) => `  - name: "${n}"`).join('\n');
    const unsafeFiles = [
      `${REC}/construction/../escape/functional-design/business-logic-model.md`,
      `${REC}/construction/a/b/functional-design/business-logic-model.md`,
      `${REC}/construction/a\\b/functional-design/business-logic-model.md`,
      `${REC}/construction/a..b/functional-design/business-logic-model.md`,
      `${REC}/construction/ctl\u0001x/functional-design/business-logic-model.md`,
      'aidlc/spaces/default/intents/escape/functional-design/business-logic-model.md',
    ];
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: doc(yaml), files: unsafeFiles });
    expect(m.units.map((u) => u.name).sort()).toEqual([...names].sort());
    for (const c of m.unitCells) {
      expect(c.files).toEqual([]);
      expect(c.present).toBe(0);
    }
    expect(bySlug(m, 'functional-design').artifacts).toEqual([]);
  });

  it('stays inside the record directory', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, recordDir: '../outside', files: ['../outside/ideation/feasibility/x.md'] });
    expect(bySlug(m, 'feasibility').artifacts).toEqual([]);
    const abs = build(GRAPH_STATE, { stageGraphText: GRAPH, recordDir: '/etc', files: ['/etc/ideation/feasibility/x.md'] });
    expect(bySlug(abs, 'feasibility').artifacts).toEqual([]);
    const traversal = build(GRAPH_STATE, { stageGraphText: GRAPH, files: [`${REC}/ideation/../../x/feasibility/y.md`] });
    expect(bySlug(traversal, 'feasibility').artifacts).toEqual([]);
  });

  it('accepts Windows separators in the file list', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, files: [`${REC}/ideation/feasibility/x.md`.replace(/\//g, '\\')] });
    expect(bySlug(m, 'feasibility').artifacts).toEqual([`${REC}/ideation/feasibility/x.md`]);
  });
});


describe('lifecycle model: artifact order', () => {
  const graph = JSON.stringify([
    {
      // The two produces are written on disk in the order alphabetical path order would reverse:
      // `-` sorts before `.`, so the questions file used to come first (and "Open artifact" opened it).
      slug: 'requirements-analysis', number: '2.3', name: 'Requirements Analysis', phase: 'inception',
      produces: ['requirements', 'requirements-analysis-questions'], optional_produces: ['glossary'],
    },
    { slug: 'plain', phase: 'inception', produces: [] },
  ]);
  const rows = state(`### INCEPTION PHASE
- [?] requirements-analysis — EXECUTE
- [ ] plain — EXECUTE`);
  const RA = `${REC}/inception/requirements-analysis`;

  it('puts the deliverable first: produces order, then optional_produces, then the rest by path', () => {
    const m = build(rows, {
      stageGraphText: graph,
      files: [
        `${RA}/zz-extra.md`,
        `${RA}/glossary.md`,
        `${RA}/requirements-analysis-questions.md`,
        `${RA}/requirements.md`,
        `${RA}/a-extra.md`,
        `${RA}/notes/requirements.md`, // a nested file of the same base name ranks like its base name
      ],
    });
    expect(bySlug(m, 'requirements-analysis').artifacts).toEqual([
      `${RA}/notes/requirements.md`,
      `${RA}/requirements.md`,
      `${RA}/requirements-analysis-questions.md`,
      `${RA}/glossary.md`,
      `${RA}/a-extra.md`,
      `${RA}/zz-extra.md`,
    ]);
    expect(m.gates[0].artifacts[0]).toMatch(/requirements\.md$/);
  });

  it('keeps path order when there is no stage graph', () => {
    const m = build(rows, { files: [`${RA}/requirements.md`, `${RA}/requirements-analysis-questions.md`, `${RA}/glossary.md`] });
    expect(bySlug(m, 'requirements-analysis').artifacts).toEqual([
      `${RA}/glossary.md`,
      `${RA}/requirements-analysis-questions.md`,
      `${RA}/requirements.md`,
    ]);
  });

  it('orders the files of a unit cell by the graph, whatever the path order', () => {
    const unitGraph = JSON.stringify([
      { slug: 'design', phase: 'construction', for_each: 'unit-of-work', produces: ['zeta', 'alpha'], optional_produces: ['beta', 'aaa'] },
    ]);
    const unitDir = `${REC}/construction/u/design`;
    const m = build(state(`### CONSTRUCTION PHASE\n- [?] design — EXECUTE`), {
      stageGraphText: unitGraph,
      dependencyDocText: doc('  - name: u'),
      files: ['aaa', 'alpha', 'beta', 'zeta'].map((n) => `${unitDir}/${n}.md`),
    });
    const cell = m.unitCells[0];
    // Required in graph order, then optional in graph order.
    expect(cell.files).toEqual(['zeta', 'alpha', 'beta', 'aaa'].map((n) => `${unitDir}/${n}.md`));
    expect(cell).toMatchObject({ present: 2, expected: 2, state: 'done' });
    expect(bySlug(m, 'design').artifacts[0]).toBe(`${unitDir}/zeta.md`);
  });

  it('lists the units of a per-unit stage in Bolt order, not path order', () => {
    const unitGraph = JSON.stringify([
      { slug: 'design', phase: 'construction', for_each: 'unit-of-work', produces: ['spec'] },
    ]);
    const m = build(state(`### CONSTRUCTION PHASE\n- [?] design — EXECUTE`), {
      stageGraphText: unitGraph,
      dependencyDocText: doc('  - name: aaa\n    depends_on: [zzz]\n  - name: zzz'),
      files: [`${REC}/construction/aaa/design/spec.md`, `${REC}/construction/zzz/design/spec.md`],
    });
    expect(bySlug(m, 'design').artifacts).toEqual([
      `${REC}/construction/zzz/design/spec.md`, // batch 1
      `${REC}/construction/aaa/design/spec.md`, // batch 2
    ]);
  });
});

describe('lifecycle model: optional artifacts', () => {
  const FD = `${REC}/construction`;
  const files = [
    `${FD}/auth/functional-design/business-logic-model.md`,
    `${FD}/auth/functional-design/domain-entities.md`,
    `${FD}/api/functional-design/business-logic-model.md`,
    `${FD}/api/functional-design/domain-entities.md`,
    `${FD}/api/functional-design/frontend-components.md`,
    `${FD}/docs/functional-design/frontend-components.md`, // a spec unit: pruned by produces_kinds
  ];

  it('lists a ui unit\'s frontend-components after the required files, without counting it', () => {
    const m = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC, files });
    const cell = (unit: string) => m.unitCells.find((c) => c.unit === unit && c.stageSlug === 'functional-design')!;

    expect(cell('api').files).toEqual([
      `${FD}/api/functional-design/business-logic-model.md`,
      `${FD}/api/functional-design/domain-entities.md`,
      `${FD}/api/functional-design/frontend-components.md`,
    ]);
    expect(cell('api')).toMatchObject({ present: 2, expected: 2, state: 'done' });

    // Not a ui unit: the optional file is pruned by kind, so it is not listed.
    expect(cell('docs').files).toEqual([]);
    expect(bySlug(m, 'functional-design').artifacts).toContain(`${FD}/api/functional-design/frontend-components.md`);
    expect(bySlug(m, 'functional-design').artifacts).not.toContain(`${FD}/docs/functional-design/frontend-components.md`);
  });

  it('never blocks a cell: a missing optional file leaves it done, an optional file alone does not make it so', () => {
    const noOptional = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC, files: files.filter((f) => !f.endsWith('frontend-components.md')) });
    const api = noOptional.unitCells.find((c) => c.unit === 'api' && c.stageSlug === 'functional-design')!;
    expect(api).toMatchObject({ present: 2, expected: 2, state: 'done' });

    const onlyOptional = build(GRAPH_STATE, { stageGraphText: GRAPH, dependencyDocText: DOC, files: [`${FD}/api/functional-design/frontend-components.md`] });
    const cell = onlyOptional.unitCells.find((c) => c.unit === 'api' && c.stageSlug === 'functional-design')!;
    expect(cell).toMatchObject({ present: 0, expected: 2, state: 'pending' });
    expect(cell.files).toEqual([`${FD}/api/functional-design/frontend-components.md`]);
  });

  it('lists the optional files of a stage-level stage', () => {
    const graph = JSON.stringify([{ slug: 'feasibility', phase: 'ideation', produces: ['assessment'], optional_produces: ['risks'] }]);
    const m = build(state('### IDEATION PHASE\n- [?] feasibility — EXECUTE'), {
      stageGraphText: graph,
      files: [`${REC}/ideation/feasibility/risks.md`, `${REC}/ideation/feasibility/assessment.md`],
    });
    expect(bySlug(m, 'feasibility').artifacts).toEqual([
      `${REC}/ideation/feasibility/assessment.md`,
      `${REC}/ideation/feasibility/risks.md`,
    ]);
  });

  it('ignores optional names that are not one safe path segment, and a name listed twice', () => {
    const graph = JSON.stringify([{
      slug: 'feasibility', phase: 'ideation', produces: ['a'],
      optional_produces: ['../x', 'a/b', 5, 'a', 'ok', 'ok'],
    }]);
    const m = build(state('### IDEATION PHASE\n- [?] feasibility — EXECUTE'), {
      stageGraphText: graph,
      files: [`${REC}/ideation/feasibility/ok.md`, `${REC}/ideation/feasibility/a.md`],
    });
    expect(bySlug(m, 'feasibility').artifacts).toEqual([`${REC}/ideation/feasibility/a.md`, `${REC}/ideation/feasibility/ok.md`]);
  });
});

describe('lifecycle model: codekb artifacts', () => {
  const CODEKB = 'aidlc/spaces/default/codekb';
  const graph = JSON.stringify([
    { slug: 'reverse-engineering', number: '2.1', name: 'Reverse Engineering', phase: 'inception', produces: ['business-overview', 'architecture'] },
    { slug: 'feasibility', phase: 'ideation', produces: ['architecture'] },
  ]);
  const rows = state(`### IDEATION PHASE
- [ ] feasibility — EXECUTE
### INCEPTION PHASE
- [?] reverse-engineering — EXECUTE`);
  const codekbFiles = [
    `${CODEKB}/app/architecture.md`,
    `${CODEKB}/app/business-overview.md`,
    `${CODEKB}/app/other.md`, // not one of the stage's produces
    `${CODEKB}/app/memory.md`,
    `${CODEKB}/app/sub/architecture.md`, // one repo segment only
    `${CODEKB}/architecture.md`, // no repo segment
    `${CODEKB}/lib/architecture.md`,
    'aidlc/spaces/other/codekb/app/architecture.md', // another space
    `${CODEKB}/../escape/app/architecture.md`,
  ];

  it('lists the produces under codekb/<repo>/, in produces order, for the reverse-engineering stage only', () => {
    const m = build(rows, {
      stageGraphText: graph,
      codekbDir: CODEKB,
      codekbFiles,
      files: [`${REC}/inception/reverse-engineering/notes.md`],
    });
    expect(bySlug(m, 'reverse-engineering').artifacts).toEqual([
      `${CODEKB}/app/business-overview.md`,
      `${CODEKB}/app/architecture.md`,
      `${CODEKB}/lib/architecture.md`,
      `${REC}/inception/reverse-engineering/notes.md`,
    ]);
    expect(m.gates[0].artifacts[0]).toBe(`${CODEKB}/app/business-overview.md`);
    // A stage that is not a codekb stage never takes codekb files, even with a matching produces name.
    expect(bySlug(m, 'feasibility').artifacts).toEqual([]);
  });

  it('lists nothing from codekb without the stage graph (no produces to match), nor without a codekb input', () => {
    expect(bySlug(build(rows, { codekbDir: CODEKB, codekbFiles }), 'reverse-engineering').artifacts).toEqual([]);
    expect(bySlug(build(rows, { stageGraphText: graph }), 'reverse-engineering').artifacts).toEqual([]);
  });

  it('refuses a codekb root that leaves the workspace', () => {
    for (const root of ['../codekb', '/abs/codekb', 'C:/codekb', 'a/../codekb']) {
      const m = build(rows, { stageGraphText: graph, codekbDir: root, codekbFiles: [`${root}/app/architecture.md`] });
      expect(bySlug(m, 'reverse-engineering').artifacts).toEqual([]);
    }
  });

  it('accepts Windows separators and bounds the list', () => {
    const win = build(rows, { stageGraphText: graph, codekbDir: CODEKB, codekbFiles: [`${CODEKB}/app/architecture.md`.replace(/\//g, '\\')] });
    expect(bySlug(win, 'reverse-engineering').artifacts).toEqual([`${CODEKB}/app/architecture.md`]);

    // Only the first 20000 entries are looked at.
    const many = function* () {
      for (let i = 0; i < 20000; i++) { yield `${CODEKB}/r${i}/other.md`; }
      yield `${CODEKB}/late/architecture.md`;
    };
    expect(bySlug(build(rows, { stageGraphText: graph, codekbDir: CODEKB, codekbFiles: many() }), 'reverse-engineering').artifacts).toEqual([]);
  });
});

describe('lifecycle model: a revising stage', () => {
  const FD = `${REC}/construction`;
  const complete = [
    `${FD}/auth/functional-design/business-logic-model.md`,
    `${FD}/auth/functional-design/business-rules.md`,
    `${FD}/auth/functional-design/domain-entities.md`,
  ];
  const withMark = (mark: string) => build(state(`### CONSTRUCTION PHASE\n- [${mark}] functional-design — EXECUTE`), {
    stageGraphText: GRAPH, dependencyDocText: DOC, files: complete,
  }).unitCells.find((c) => c.unit === 'auth' && c.stageSlug === 'functional-design')!;

  it('does not show a unit done while the stage is being revised', () => {
    // The files of the rejected round are still on disk: complete, yet the stage is reworking them.
    expect(withMark('R')).toMatchObject({ state: 'in-progress', present: 3, expected: 3 });
    expect(withMark('-')).toMatchObject({ state: 'done', present: 3, expected: 3 });
    expect(withMark('?')).toMatchObject({ state: 'done' });
    expect(withMark('x')).toMatchObject({ state: 'done' });
  });

  it('keeps pending and in-progress cells as they are while revising', () => {
    const m = build(state(`### CONSTRUCTION PHASE\n- [R] functional-design — EXECUTE`), {
      stageGraphText: GRAPH, dependencyDocText: DOC, files: [`${FD}/api/functional-design/business-logic-model.md`],
    });
    const cell = (unit: string) => m.unitCells.find((c) => c.unit === unit && c.stageSlug === 'functional-design')!;
    expect(cell('api').state).toBe('in-progress');
    expect(cell('docs').state).toBe('pending');
  });
});

describe('lifecycle model: progress totals', () => {
  it('gives done (completed + skipped), completed and skipped, and leaves out stages not in the plan', () => {
    const m = build(state(`### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [x] feasibility — EXECUTE
- [S] units-generation — SKIP: not needed
- [ ] functional-design — SKIP
- [-] code-generation — EXECUTE`), { stageGraphText: GRAPH });
    expect(m.totals).toEqual({ done: 4, total: 5, completed: 2, skipped: 2 });
    expect(m.totals.done).toBe(m.totals.completed + m.totals.skipped);
    // extra-stage is in the graph but not in the plan: not counted.
    expect(bySlug(m, 'extra-stage').counted).toBe(false);
  });
});

describe('lifecycle model: lines over the cap', () => {
  it('ignores a state line over the cap and still reads the lines around it', () => {
    const long = 'x'.repeat(1100);
    const m = build(`${HEAD.replace('Demo intent', long)}
## Stage Progress
### IDEATION PHASE
- [x] first — EXECUTE
- [S] ${long} — SKIP: ${long}
- [x] second — EXECUTE
`);
    // The over-cap project line is ignored (label falls back to the directory name) and so is the over-cap row.
    expect(m.intentLabel).toBe('260101-demo');
    expect(allStages(m).map((s) => s.slug)).toEqual(['first', 'second']);
  });

  it('reads a row and a field just under the cap', () => {
    const reason = 'r'.repeat(300);
    const m = build(state(`### IDEATION PHASE\n- [S] one — SKIP: ${reason}${' '.repeat(600)}`));
    expect(bySlug(m, 'one').skipReason).toBe(reason);
  });

  it('finds the units block after a yaml block that is not the units block', () => {
    const text = '```yaml\nother: 1\n```\n\ntext\n\n```yaml\nunits:\n  - name: a\n  - name: b\n    depends_on: [a]\n```\n';
    const m = build(GRAPH_STATE, { dependencyDocText: text });
    expect(m.units.map((u) => u.name)).toEqual(['a', 'b']);
  });

  it('does not take a long line for a fence, and rejects one inside the units block', () => {
    const longFence = `\`\`\`yaml${' '.repeat(5000)}\nunits:\n  - name: a\n\`\`\`\n`;
    expect(build(GRAPH_STATE, { dependencyDocText: longFence }).unitsError).toMatch(/^absent: /);
    const inside = `\`\`\`yaml\nunits:\n  - name: a\n  # ${'c'.repeat(5000)}\n\`\`\`\n`;
    expect(build(GRAPH_STATE, { dependencyDocText: inside }).unitsError).toMatch(/^malformed: line too long/);
  });

  it('rejects a blank line over the cap inside the units block as well', () => {
    expect(build(GRAPH_STATE, { dependencyDocText: doc(`  - name: a\n${' '.repeat(5000)}`) }).unitsError).toMatch(/^malformed: line too long/);
  });
});

describe('lifecycle model: bounded work on hostile input', () => {
  // These inputs took seconds to hours with the lazy `(.+?)\s*$` captures and the multiline
  // `units:` test (a whitespace run followed by a lone CR defeats `.`: 12.7 s for one 4 KB line).
  // The point is the BOUND, not the exact number: the limit is generous so that CI on three
  // operating systems stays stable, and a regression is still off by orders of magnitude.
  const LIMIT_MS = 2000;
  const MB = 1024 * 1024;

  const elapsed = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  // Spaces and quotes, then `a`, a lone CR and `b`: the CR survives the line split and stops `.`.
  const hostile = (size: number) => `${' "'.repeat(Math.floor(size / 2))}a\rb`;

  it.each([
    ['  - name:'],
    ['    kind:'],
    ['    depends_on:'],
    ['  -'],
    ['  - name: x\n  -'],
    ['  units:'],
  ])('a 4 KB line of spaces and quotes after %j in the units block', (prefix) => {
    // 4000 characters + prefix stays under the 4096 line cap: the expressions themselves must be linear.
    const text = doc(`  - name: a\n${prefix}${hostile(3900)}`);
    const ms = elapsed(() => { build(GRAPH_STATE, { dependencyDocText: text }); });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('a 4 KB line of spaces only (the measured 12.7 s case)', () => {
    const text = doc(`  - name: a\n  - ${' '.repeat(4000)}a\rb`);
    const result = build(GRAPH_STATE, { dependencyDocText: text });
    expect(result.unitsError).toMatch(/^malformed: /);
    expect(elapsed(() => { build(GRAPH_STATE, { dependencyDocText: text }); })).toBeLessThan(LIMIT_MS);
  });

  it('a 2 MB unit document of blank lines inside a fence, and one 2 MB line', () => {
    const blank = `\`\`\`yaml\n${'\n'.repeat(MB)}units:\n  - name: a\n\`\`\`\n`;
    expect(elapsed(() => { build(GRAPH_STATE, { dependencyDocText: blank }); })).toBeLessThan(LIMIT_MS);

    const oneLine = `\`\`\`yaml\nunits:\n${hostile(2 * MB - 100)}\n\`\`\`\n`;
    expect(elapsed(() => { build(GRAPH_STATE, { dependencyDocText: oneLine }); })).toBeLessThan(LIMIT_MS);

    const manyFences = '```yaml\nother: 1\n```\n'.repeat(80000);
    expect(elapsed(() => { build(GRAPH_STATE, { dependencyDocText: manyFences }); })).toBeLessThan(LIMIT_MS);
  });

  it('a 2 MB state file of long lines (under and over the line cap)', () => {
    const under = hostile(900); // under the 1024 cap: reaches the expressions
    const over = hostile(4000); // over the cap: blanked before any expression
    const lines: string[] = ['## Project Information'];
    let size = 0;
    const push = (line: string) => { lines.push(line); size += line.length + 1; };
    for (let i = 0; i < 100; i++) { push(`- **Project**:${under}`); }
    lines.push('## Runtime State');
    for (let i = 0; i < 100; i++) { push(`- **Revision Count**:${over}`); }
    lines.push('## Stage Progress', '### IDEATION PHASE');
    for (let i = 0; size < 2 * MB - 150000; i++) {
      push(`- [S] stage-${i} — SKIP:${i % 2 === 0 ? under : over}`);
    }
    lines.push('## Current Status');
    for (let i = 0; i < 100; i++) { push(`- **Current Stage**:${under}`); }
    const text = lines.join('\n');
    expect(text.length).toBeLessThanOrEqual(2 * MB);

    let model: ReturnType<typeof build> | undefined;
    const ms = elapsed(() => { model = build(text, { stageGraphText: GRAPH }); });
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(model!.phases.length).toBeGreaterThan(0);
  });

  it('a 2 MB state file that is one line, and one of blank lines', () => {
    for (const text of [`## Stage Progress\n- [S] a — SKIP:${hostile(2 * MB - 100)}`, `## Stage Progress\n${'\n'.repeat(2 * MB - 100)}`]) {
      expect(elapsed(() => { build(text); })).toBeLessThan(LIMIT_MS);
    }
  });
});
