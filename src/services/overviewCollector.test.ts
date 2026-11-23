import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEntry { type: number; data?: string }
const fake = vi.hoisted(() => ({
  entries: new Map<string, FakeEntry>(),
  reads: [] as string[],
  listed: [] as string[],
  folders: [{ uri: { path: '/ws', fsPath: '/ws' } }] as Array<{ uri: { path: string; fsPath: string } }> | undefined,
}));

vi.mock('vscode', () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const file = (path: string) => ({ path, fsPath: path });
  return {
    FileType,
    Uri: {
      file,
      joinPath: (base: { path: string }, ...segments: string[]) => file([base.path, ...segments].join('/')),
    },
    workspace: {
      get workspaceFolders() { return fake.folders; },
      asRelativePath: (uri: { path: string }) => uri.path,
      fs: {
        // Nothing under documentkb/ in these tests: the catalog is absent.
        stat: async (uri: { path: string }) => {
          throw Object.assign(new Error(`ENOENT ${uri.path}`), { code: 'FileNotFound' });
        },
        readFile: async (uri: { path: string }) => {
          fake.reads.push(uri.path);
          const entry = fake.entries.get(uri.path);
          if (!entry || entry.data === undefined) { throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' }); }
          return Buffer.from(entry.data, 'utf-8');
        },
        readDirectory: async (uri: { path: string }) => {
          fake.listed.push(uri.path);
          if (!fake.entries.has(uri.path)) { throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' }); }
          const prefix = `${uri.path}/`;
          const children: [string, number][] = [];
          for (const [path, entry] of fake.entries) {
            if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
              children.push([path.slice(prefix.length), entry.type]);
            }
          }
          return children;
        },
      },
    },
  };
});

import { OverviewCollector, buildOverviewModel, parseIntentRegistry, readCodeMaps, readOverviewIntents } from './overviewCollector';
import { absentKbHealth, parseKbIndex, unreadableKbHealth } from './documentKbReader';
import type { KbHealth } from './documentKbReader';
import { StateParser } from './stateParser';
import type { Stage, StageStatus, WorkflowState } from '../types';

function stage(id: string, name: string, status: StageStatus, phase: 0 | 1 | 2 | 3 | 4 = 2): Stage {
  return { id, name, phase, leadAgent: 'product', status, artifacts: [] };
}

function workflow(stages: Stage[], overrides: Partial<WorkflowState> = {}, type: 'greenfield' | 'brownfield' = 'greenfield'): WorkflowState {
  return {
    intent: {
      label: 'checkout', createdAt: '2026-01-01', space: 'default', directory: 'x',
      scope: 'feature', depth: 'standard', testStrategy: 'standard',
    },
    workspace: { type, languages: [], frameworks: [], hasExistingAidlc: true },
    currentPhase: 2,
    currentStageId: stages[0]?.id ?? '',
    stagesCompleted: stages.filter((s) => s.status === 'completed').length,
    stagesTotal: stages.length,
    stages,
    ...overrides,
  };
}

const SHA = 'a'.repeat(64);
// Extraction records the framework's validator accepts (documentKbReader.parity.test.ts proves it).
const EXTRACTION: Record<string, Record<string, unknown>> = {
  extracted: { extractor: { name: 'text', version: '1' }, source_revision: SHA, chars: 5, truncated: false },
  no_extractable_text: { extractor: { name: 'pdf', version: '2' }, source_revision: SHA },
  extraction_failed: { extractor: { name: 'pdf', version: '2' }, reason: 'timeout', detectedType: 'application/pdf' },
  unsupported_type: { detectedType: 'image/png' },
  invalidated: { source_revision: SHA },
};
function kbWith(extractionState: string, extra: Record<string, unknown> = {}): KbHealth {
  return parseKbIndex(JSON.stringify({
    schema_version: 1,
    documents: [{
      id: '0190a1b2-c3d4-7e5f-8a6b-000000000001',
      source: { kind: 'managed', path: 'docs/a.pdf' },
      sha256: SHA, bytes: 1, indexed_at: '2026-01-02T03:04:05Z',
      extraction: { state: extractionState, ...EXTRACTION[extractionState], ...extra },
      summary: { state: 'absent' },
    }],
  }));
}

const BASE = { space: 'default', intents: [], knowledge: absentKbHealth('default'), codeMaps: [] as string[] };

describe('buildOverviewModel: needs attention', () => {
  it('is empty when nothing needs attention', () => {
    const model = buildOverviewModel({
      ...BASE,
      state: workflow([stage('2.1', 'Requirements', 'active')]),
      knowledge: kbWith('extracted'),
    });
    expect(model.needsAttention).toEqual([]);
  });

  it('is empty with no intent and no knowledge', () => {
    expect(buildOverviewModel({ ...BASE, state: null }).needsAttention).toEqual([]);
  });

  it('lists every gate awaiting approval, with its stage id', () => {
    const model = buildOverviewModel({
      ...BASE,
      state: workflow([
        stage('2.1', 'Requirements', 'awaiting-approval'),
        stage('2.2', 'Stories', 'completed'),
        stage('2.3', 'Design', 'awaiting-approval'),
      ]),
    });
    expect(model.needsAttention).toEqual([
      { kind: 'gate', label: 'Gate: 2.1 Requirements', stageId: '2.1' },
      { kind: 'gate', label: 'Gate: 2.3 Design', stageId: '2.3' },
    ]);
    expect(model.lifecycle.gatesOpen).toBe(2);
  });

  it('flags a stage in revised as rework', () => {
    const model = buildOverviewModel({ ...BASE, state: workflow([stage('2.1', 'Requirements', 'revised')]) });
    expect(model.needsAttention).toEqual([{ kind: 'rework', label: 'Rework: 2.1 Requirements', stageId: '2.1' }]);
  });

  it('reports an unreadable knowledge index with a short label and the message as detail', () => {
    const model = buildOverviewModel({ ...BASE, state: null, knowledge: unreadableKbHealth('index.json is missing: /aidlc knowledge sync rebuilds it') });
    expect(model.needsAttention).toEqual([
      { kind: 'kb-unreadable', label: 'Knowledge catalog unreadable', detail: 'index.json is missing: /aidlc knowledge sync rebuilds it' },
    ]);
  });

  it('keeps the label short and truncates a long error in the detail', () => {
    const long = `index.json is not valid: ${'x'.repeat(600)}`;
    const [item] = buildOverviewModel({ ...BASE, state: null, knowledge: unreadableKbHealth(long) }).needsAttention;
    expect(item.label).toBe('Knowledge catalog unreadable');
    expect(item.detail?.length).toBeLessThanOrEqual(303);
    expect(item.detail?.endsWith('...')).toBe(true);
  });

  it('reports a catalog the framework refuses as unreadable, not as healthy', () => {
    const refused = parseKbIndex(JSON.stringify({
      schema_version: 1,
      documents: [{
        id: '0190a1b2-c3d4-7e5f-8a6b-000000000001',
        source: { kind: 'managed', path: 'docs/a.pdf' },
        sha256: SHA, bytes: 1, indexed_at: '2026-01-02T03:04:05Z',
        extraction: { state: 'extracted', source_revision: SHA },
        summary: { state: 'absent' },
      }],
    }));
    const model = buildOverviewModel({ ...BASE, state: null, knowledge: refused });
    expect(model.needsAttention.map((i) => i.kind)).toEqual(['kb-unreadable']);
  });

  it('counts the documents that need a remedy, singular and plural', () => {
    const one = buildOverviewModel({ ...BASE, state: null, knowledge: kbWith('extraction_failed') });
    expect(one.needsAttention.map((i) => i.label)).toEqual(['1 knowledge document needs a remedy']);

    const stale = buildOverviewModel({ ...BASE, state: null, knowledge: kbWith('invalidated') });
    expect(stale.needsAttention[0]).toMatchObject({ kind: 'kb-remedy' });

    const many: KbHealth = { ...kbWith('extracted'), needsRemedy: 3 };
    expect(buildOverviewModel({ ...BASE, state: null, knowledge: many }).needsAttention.map((i) => i.label))
      .toEqual(['3 knowledge documents need a remedy']);
  });

  it('does not flag unsupported_type or extracted documents', () => {
    expect(buildOverviewModel({ ...BASE, state: null, knowledge: kbWith('unsupported_type') }).needsAttention).toEqual([]);
  });

  it('flags a missing code map only for a brownfield workspace with an intent', () => {
    const stages = [stage('2.1', 'Requirements', 'active')];
    expect(buildOverviewModel({ ...BASE, state: workflow(stages, {}, 'brownfield') }).needsAttention)
      .toEqual([{ kind: 'no-code-map', label: 'No code map yet' }]);
    expect(buildOverviewModel({ ...BASE, state: workflow(stages, {}, 'greenfield') }).needsAttention).toEqual([]);
    expect(buildOverviewModel({ ...BASE, state: null }).needsAttention).toEqual([]);
    expect(buildOverviewModel({ ...BASE, state: workflow(stages, {}, 'brownfield'), codeMaps: ['api'] }).needsAttention).toEqual([]);
  });

  it('orders gates, rework, knowledge, then the code map', () => {
    const model = buildOverviewModel({
      ...BASE,
      state: workflow([
        stage('2.1', 'Requirements', 'revised'),
        stage('2.2', 'Stories', 'awaiting-approval'),
      ], {}, 'brownfield'),
      knowledge: kbWith('no_extractable_text'),
    });
    expect(model.needsAttention.map((i) => i.kind)).toEqual(['gate', 'rework', 'kb-remedy', 'no-code-map']);

    const unreadable = buildOverviewModel({
      ...BASE,
      state: workflow([stage('2.1', 'Requirements', 'awaiting-approval')], {}, 'brownfield'),
      knowledge: unreadableKbHealth('broken'),
    });
    expect(unreadable.needsAttention.map((i) => i.kind)).toEqual(['gate', 'kb-unreadable', 'no-code-map']);
  });
});

describe('buildOverviewModel: lifecycle', () => {
  it('has no intent', () => {
    const model = buildOverviewModel({ ...BASE, state: null });
    expect(model.lifecycle).toEqual({
      hasIntent: false, intentLabel: null, progressDone: 0, progressTotal: 0,
      complete: false, phase: null, now: null, gatesOpen: 0,
    });
  });

  it('reports the same numbers as Workflow Progress', () => {
    const stages = [
      stage('1.1', 'Discovery', 'completed', 1),
      stage('2.1', 'Requirements', 'active', 2),
      stage('2.2', 'Stories', 'pending', 2),
    ];
    const model = buildOverviewModel({ ...BASE, state: workflow(stages, { currentPhase: 2, currentStageId: '2.1' }) });
    expect(model.lifecycle).toEqual({
      hasIntent: true, intentLabel: 'checkout', progressDone: 1, progressTotal: 3,
      complete: false, phase: 'Inception', now: 'Requirements', gatesOpen: 0,
    });
  });

  it('does not invent a phase while the scope is undecided', () => {
    const model = buildOverviewModel({ ...BASE, state: workflow([], { currentPhase: 0, currentStageId: '' }) });
    expect(model.lifecycle).toMatchObject({ hasIntent: true, progressTotal: 0, phase: null, now: null, complete: false });
  });

  it('is complete when every stage is done', () => {
    const stages = [stage('2.1', 'Requirements', 'completed'), stage('2.2', 'Stories', 'completed')];
    const model = buildOverviewModel({ ...BASE, state: workflow(stages, { currentPhase: 4 }) });
    expect(model.lifecycle).toMatchObject({ complete: true, now: null, phase: 'Operation' });
  });
});

describe('buildOverviewModel: AI pod', () => {
  it('counts running intents and the gates open in the space', () => {
    const model = buildOverviewModel({
      ...BASE,
      state: null,
      intents: [
        { status: 'in-flight', stagesAwaiting: 1 },
        { status: 'completed', stagesAwaiting: 0 },
        { status: 'in-flight', stagesAwaiting: 2 },
      ],
      codeMaps: ['api', 'web'],
      knowledge: kbWith('extracted'),
    });
    expect(model.pod).toMatchObject({ intentsRunning: 2, intentsTotal: 3, gatesOpen: 3, codeMaps: ['api', 'web'] });
    expect(model.pod.knowledge.state).toBe('ok');
    expect(model.space).toBe('default');
  });
});

describe('readCodeMaps', () => {
  const root = '/ws/aidlc/spaces/default/codekb';
  const ws = { path: '/ws', fsPath: '/ws' } as never;

  beforeEach(() => {
    fake.entries.clear();
    fake.folders = [{ uri: { path: '/ws', fsPath: '/ws' } }];
  });

  it('is empty without a codekb/ directory', async () => {
    expect(await readCodeMaps(ws)).toEqual([]);
  });

  it('lists the repo directories that hold at least one file, sorted', async () => {
    fake.entries.set(root, { type: 2 });
    fake.entries.set(`${root}/web`, { type: 2 });
    fake.entries.set(`${root}/web/architecture.md`, { type: 1 });
    fake.entries.set(`${root}/api`, { type: 2 });
    fake.entries.set(`${root}/api/overview.md`, { type: 1 });
    fake.entries.set(`${root}/empty`, { type: 2 });
    fake.entries.set(`${root}/only-dirs`, { type: 2 });
    fake.entries.set(`${root}/only-dirs/sub`, { type: 2 });
    fake.entries.set(`${root}/.hidden`, { type: 2 });
    fake.entries.set(`${root}/.hidden/a.md`, { type: 1 });
    fake.entries.set(`${root}/linked`, { type: 2 | 64 });
    fake.entries.set(`${root}/linked/a.md`, { type: 1 });
    fake.entries.set(`${root}/stray.md`, { type: 1 });
    expect(await readCodeMaps(ws)).toEqual(['api', 'web']);
  });
});

const INTENTS = '/ws/aidlc/spaces/default/intents';

function stateMd(project: string, stages: Array<[string, string]>): string {
  return [
    '## Project Information',
    `- **Project**: ${project}`,
    '- **Scope**: feature',
    '',
    '## Stage Progress',
    '### INCEPTION PHASE',
    ...stages.map(([marker, name]) => `- [${marker}] ${name} \u2014 EXECUTE`),
    '',
  ].join('\n');
}

describe('parseIntentRegistry', () => {
  it('keeps the status and a usable dirName of each object entry', () => {
    expect(parseIntentRegistry(JSON.stringify([
      { uuid: 'u1', slug: 'a', dirName: 'a-1234abcd', status: 'in-flight' },
      { slug: 'legacy', status: 'completed' },
      { slug: 'no-status', dirName: 'x' },
    ]))).toEqual([
      { status: 'in-flight', dirName: 'a-1234abcd' },
      { status: 'completed', dirName: null },
      { status: 'unknown', dirName: 'x' },
    ]);
  });

  it('reads anything that is not a JSON array as an empty registry', () => {
    expect(parseIntentRegistry('{ nope')).toEqual([]);
    expect(parseIntentRegistry('{}')).toEqual([]);
    expect(parseIntentRegistry('null')).toEqual([]);
    expect(parseIntentRegistry('"x"')).toEqual([]);
  });

  it('ignores entries that are not objects', () => {
    expect(parseIntentRegistry(JSON.stringify([null, 3, 'x', [], { status: 'in-flight', dirName: 'a' }])))
      .toEqual([{ status: 'in-flight', dirName: 'a' }]);
  });

  it.each(['../x', 'a/b', 'a\\b', '..', '.', '', '/abs', 'a\u0000b', 7, null])('refuses %j as a record directory', (dirName) => {
    expect(parseIntentRegistry(JSON.stringify([{ status: 'in-flight', dirName }]))).toEqual([{ status: 'in-flight', dirName: null }]);
  });
});

describe('readOverviewIntents', () => {
  const ws = { path: '/ws', fsPath: '/ws' } as never;

  beforeEach(() => {
    fake.entries.clear();
    fake.reads = [];
    fake.listed = [];
  });

  it('is empty without a registry', async () => {
    expect(await readOverviewIntents(ws)).toEqual([]);
  });

  it('reads the registry and ONE state file per intent, nothing else', async () => {
    fake.entries.set(`${INTENTS}/intents.json`, {
      type: 1,
      data: JSON.stringify([
        { slug: 'a', dirName: 'a-1111aaaa', status: 'in-flight' },
        { slug: 'b', dirName: 'b-2222bbbb', status: 'completed' },
        { slug: 'c', status: 'in-flight' },
      ]),
    });
    fake.entries.set(`${INTENTS}/a-1111aaaa/aidlc-state.md`, {
      type: 1, data: stateMd('a', [['?', 'requirements'], ['?', 'stories'], ['x', 'design']]),
    });
    // an audit shard and an artifact exist: they must not be read
    fake.entries.set(`${INTENTS}/a-1111aaaa/audit/host-clone.md`, { type: 1, data: 'STAGE_STARTED' });
    fake.entries.set(`${INTENTS}/a-1111aaaa/inception/requirements.md`, { type: 1, data: '# r' });
    fake.entries.set(`${INTENTS}/b-2222bbbb/aidlc-state.md`, { type: 1, data: stateMd('b', [['x', 'requirements']]) });

    const intents = await readOverviewIntents(ws, 'default', new StateParser());

    expect(intents).toEqual([
      { status: 'in-flight', stagesAwaiting: 2 },
      { status: 'completed', stagesAwaiting: 0 },
      { status: 'in-flight', stagesAwaiting: 0 }, // no dirName: no state to read
    ]);
    expect([...fake.reads].sort()).toEqual([
      `${INTENTS}/a-1111aaaa/aidlc-state.md`,
      `${INTENTS}/b-2222bbbb/aidlc-state.md`,
      `${INTENTS}/intents.json`,
    ]);
    expect(fake.listed).toEqual([]); // no directory walk
  });

  it('counts an intent whose state is missing or unparseable with no open gate', async () => {
    fake.entries.set(`${INTENTS}/intents.json`, {
      type: 1,
      data: JSON.stringify([
        { slug: 'a', dirName: 'a-1', status: 'in-flight' },
        { slug: 'b', dirName: 'b-1', status: 'in-flight' },
      ]),
    });
    fake.entries.set(`${INTENTS}/b-1/aidlc-state.md`, { type: 1, data: 'not a state file' });
    expect(await readOverviewIntents(ws, 'default', new StateParser())).toEqual([
      { status: 'in-flight', stagesAwaiting: 0 },
      { status: 'in-flight', stagesAwaiting: 0 },
    ]);
  });

  it('never builds a path out of a hostile dirName', async () => {
    fake.entries.set(`${INTENTS}/intents.json`, {
      type: 1,
      data: JSON.stringify([{ slug: 'x', dirName: '../../../../etc', status: 'in-flight' }]),
    });
    expect(await readOverviewIntents(ws, 'default', new StateParser())).toEqual([{ status: 'in-flight', stagesAwaiting: 0 }]);
    expect(fake.reads).toEqual([`${INTENTS}/intents.json`]);
  });

  it('reads the registry of the space it is given', async () => {
    fake.entries.set('/ws/aidlc/spaces/team/intents/intents.json', { type: 1, data: JSON.stringify([{ slug: 'x', status: 'completed' }]) });
    expect(await readOverviewIntents(ws, 'team')).toEqual([{ status: 'completed', stagesAwaiting: 0 }]);
  });
});

describe('OverviewCollector', () => {
  beforeEach(() => {
    fake.entries.clear();
    fake.reads = [];
    fake.listed = [];
    fake.folders = [{ uri: { path: '/ws', fsPath: '/ws' } }];
  });

  it('builds the model from the registry, one state per intent, the catalog and the code maps', async () => {
    fake.entries.set('/ws/aidlc/spaces/default/codekb', { type: 2 });
    fake.entries.set('/ws/aidlc/spaces/default/codekb/api', { type: 2 });
    fake.entries.set('/ws/aidlc/spaces/default/codekb/api/map.md', { type: 1 });
    fake.entries.set(`${INTENTS}/intents.json`, {
      type: 1,
      data: JSON.stringify([
        { slug: 'a', dirName: 'a-1', status: 'in-flight' },
        { slug: 'b', dirName: 'b-1', status: 'completed' },
      ]),
    });
    fake.entries.set(`${INTENTS}/a-1/aidlc-state.md`, { type: 1, data: stateMd('a', [['?', 'requirements']]) });
    fake.entries.set(`${INTENTS}/b-1/aidlc-state.md`, { type: 1, data: stateMd('b', [['x', 'requirements']]) });
    const state = workflow([stage('2.1', 'Requirements', 'awaiting-approval')], {}, 'brownfield');
    const stateManager = { getCurrentState: async () => state };

    const model = await new OverviewCollector(stateManager as never).collect();

    expect(model.needsAttention.map((i) => i.kind)).toEqual(['gate']);
    expect(model.lifecycle.gatesOpen).toBe(1);
    expect(model.pod).toMatchObject({ intentsRunning: 1, intentsTotal: 2, gatesOpen: 1, codeMaps: ['api'] });
    expect(model.pod.knowledge.state).toBe('absent');
    // The refresh path never reads an audit shard or lists an artifact directory.
    expect(fake.reads.filter((p) => p.includes('/audit'))).toEqual([]);
    expect(fake.listed.filter((p) => p.startsWith(INTENTS))).toEqual([]);
  });

  it('survives failing inputs', async () => {
    const stateManager = { getCurrentState: async () => { throw new Error('boom'); } };
    const reader = { parseStateFile: async () => { throw new Error('boom'); } };
    fake.entries.set(`${INTENTS}/intents.json`, { type: 1, data: JSON.stringify([{ slug: 'a', dirName: 'a-1', status: 'in-flight' }]) });
    const model = await new OverviewCollector(stateManager as never, reader as never).collect();
    expect(model.lifecycle.hasIntent).toBe(false);
    expect(model.pod).toMatchObject({ intentsRunning: 1, intentsTotal: 1, gatesOpen: 0, codeMaps: [] });
  });

  it('returns an empty model without a workspace folder', async () => {
    fake.folders = undefined;
    const stateManager = { getCurrentState: async () => { throw new Error('must not be called'); } };
    const model = await new OverviewCollector(stateManager as never, {} as never).collect();
    expect(model.lifecycle.hasIntent).toBe(false);
    expect(model.pod.knowledge.state).toBe('absent');
  });
});
