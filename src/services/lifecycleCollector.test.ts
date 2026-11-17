import { beforeEach, describe, expect, it, vi } from 'vitest';

// The I/O part: the collector reads through vscode.workspace.fs, mocked here. The pure builder
// has its own suite (lifecycleModel.test.ts) with no mock.
// In-memory workspace the mocked vscode.workspace.fs reads from.
const mem = vi.hoisted(() => ({
  files: new Map<string, string>(),
  sizes: new Map<string, number>(),
  /** Entry path -> vscode.FileType, for entries that are not plain files or directories (symlinks). */
  types: new Map<string, number>(),
  /** Paths whose read fails. */
  unreadable: new Set<string>(),
}));

vi.mock('vscode', async () => {
  const { posix } = await import('node:path');
  const uri = (p: string) => ({ path: p, fsPath: p });
  const notFound = () => { throw new Error('ENOENT'); };
  return {
    Uri: {
      file: uri,
      joinPath: (base: { path: string }, ...segs: string[]) => uri(posix.join(base.path, ...segs)),
    },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      asRelativePath: (u: { path: string }) => u.path.replace(/^\/ws\//, ''),
      fs: {
        stat: async (u: { path: string }) => {
          if (mem.files.has(u.path)) { return { size: mem.sizes.get(u.path) ?? mem.files.get(u.path)!.length }; }
          if ([...mem.files.keys()].some((k) => k.startsWith(`${u.path}/`))) { return { size: 0 }; }
          return notFound();
        },
        readFile: async (u: { path: string }) => {
          const text = mem.files.get(u.path);
          if (text === undefined || mem.unreadable.has(u.path)) { return notFound(); }
          return new TextEncoder().encode(text);
        },
        readDirectory: async (u: { path: string }) => {
          const prefix = `${u.path}/`;
          const out = new Map<string, number>();
          for (const key of mem.files.keys()) {
            if (!key.startsWith(prefix)) { continue; }
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf('/');
            const name = slash < 0 ? rest : rest.slice(0, slash);
            out.set(name, mem.types.get(prefix + name) ?? (slash < 0 ? 1 : 2));
          }
          if (out.size === 0) { return notFound(); }
          return [...out.entries()];
        },
      },
    },
  };
});

import * as vscode from 'vscode';
import { StateParser } from './stateParser';
import { LifecycleCollector, LifecycleModel, buildLifecycleModel } from './lifecycleCollector';

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

const build = (stateText: string) => buildLifecycleModel({ stateText, recordDir: REC, files: [] });
const allStages = (m: LifecycleModel) => m.phases.flatMap((p) => p.stages);
const bySlug = (m: LifecycleModel, slug: string) => {
  const stage = allStages(m).find((s) => s.slug === slug);
  if (!stage) { throw new Error(`no stage ${slug}`); }
  return stage;
};

const GRAPH = JSON.stringify([
  { slug: 'intent-capture', number: '1.1', name: 'Intent Capture', phase: 'ideation', lead_agent: 'aidlc-product-agent', produces: ['intent-statement'] },
  { slug: 'feasibility', number: '1.3', name: 'Feasibility', phase: 'ideation', lead_agent: 'aidlc-architect-agent', produces: ['feasibility-assessment'] },
  { slug: 'units-generation', number: '2.7', name: 'Units Generation', phase: 'inception', lead_agent: 'aidlc-architect-agent', produces: ['unit-of-work-dependency'] },
  {
    slug: 'functional-design', number: '3.1', name: 'Functional Design', phase: 'construction',
    lead_agent: 'aidlc-architect-agent', for_each: 'unit-of-work',
    produces: ['business-logic-model', 'business-rules', 'domain-entities'],
    produces_kinds: { 'business-logic-model': ['service', 'ui', 'library'], 'business-rules': ['service', 'spec', 'library'] },
  },
]);

const GRAPH_STATE = state(`### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [?] feasibility — EXECUTE
### INCEPTION PHASE
- [x] units-generation — EXECUTE
### CONSTRUCTION PHASE
- [-] functional-design — EXECUTE`, { current: 'functional-design', revision: '2' });

const DOC = `# Unit of work dependency

\`\`\`yaml
units:
  - name: auth
    kind: service
    depends_on: []
  - name: api
    kind: ui
    depends_on: [auth]
\`\`\`
`;

describe('LifecycleCollector and StateParser', () => {
  it('gives the same statuses as StateParser.parseMarkdown', () => {
    const text = state(`### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [-] market-research — EXECUTE
- [?] feasibility — EXECUTE
- [R] scope-definition — EXECUTE
- [S] team-formation — SKIP: not needed
- [ ] rough-mockups — SKIP
- [ ] approval-handoff — EXECUTE
### INCEPTION PHASE
- [X] requirements-analysis — EXECUTE
- [x] user-stories — EXECUTE (done)`);
    const parsed = new StateParser().parseMarkdown(text, vscode.Uri.file(`/ws/${REC}/aidlc-state.md`));
    const model = build(text);
    expect(parsed).not.toBeNull();
    expect(allStages(model).map((s) => s.status)).toEqual(parsed!.stages.map((s) => s.status));
    // StateParser records a reason for every SKIP row; Studio keeps the text when there is one.
    expect(allStages(model).map((s) => s.skipReason !== undefined)).toEqual(parsed!.stages.map((s) => s.skipReason !== undefined));
    expect(bySlug(model, 'rough-mockups').skipReason).toBe('Scope excludes this stage');
    expect(bySlug(model, 'team-formation').skipReason).toBe('not needed');
    expect(model.totals.done).toBe(parsed!.stagesCompleted);
    expect(model.totals.total).toBe(parsed!.stagesTotal);
  });
});

describe('LifecycleCollector', () => {
  const WS = '/ws';
  const INTENTS = `${WS}/aidlc/spaces/default/intents`;
  const dir = '260101-demo';

  beforeEach(() => {
    mem.files.clear();
    mem.sizes.clear();
    mem.types.clear();
    mem.unreadable.clear();
  });

  const seed = () => {
    mem.files.set(`${INTENTS}/active-intent`, dir);
    mem.files.set(`${INTENTS}/${dir}/aidlc-state.md`, GRAPH_STATE);
    mem.files.set(`${WS}/.kiro/tools/data/stage-graph.json`, GRAPH);
    mem.files.set(`${INTENTS}/${dir}/inception/units-generation/unit-of-work-dependency.md`, DOC);
    mem.files.set(`${INTENTS}/${dir}/construction/auth/functional-design/business-rules.md`, '# rules');
    mem.files.set(`${INTENTS}/${dir}/ideation/intent-capture/intent-statement.md`, '# intent');
    mem.files.set(`${INTENTS}/${dir}/audit/shard.md`, 'x');
  };
  const root = () => vscode.Uri.file(WS);

  it('returns null when there is no state file', async () => {
    expect(await new LifecycleCollector().collect(root())).toBeNull();
    expect(await new LifecycleCollector().collect(root(), dir)).toBeNull();
  });

  it('collects the active intent from the files', async () => {
    seed();
    const m = await new LifecycleCollector().collect(root());
    expect(m).not.toBeNull();
    expect(m!.intentDir).toBe(`aidlc/spaces/default/intents/${dir}`);
    expect(m!.hasStageGraph).toBe(true);
    expect(m!.hasRuntimeGraph).toBe(false);
    expect(m!.unitsSource).toBe('dependency-doc');
    expect(bySlug(m!, 'intent-capture').artifacts).toEqual([`aidlc/spaces/default/intents/${dir}/ideation/intent-capture/intent-statement.md`]);
    const cell = m!.unitCells.find((c) => c.unit === 'auth' && c.stageSlug === 'functional-design')!;
    expect(cell.present).toBe(1);
  });

  it('collects the intent named by intentDirName, not the active one', async () => {
    seed();
    mem.files.set(`${INTENTS}/other-intent/aidlc-state.md`, state('### IDEATION PHASE\n- [x] only — EXECUTE'));
    const m = await new LifecycleCollector().collect(root(), 'other-intent');
    expect(allStages(m!).filter((s) => s.inPlan).map((s) => s.slug)).toEqual(['only']);
    expect(m!.intentDir).toBe('aidlc/spaces/default/intents/other-intent');
  });

  it('refuses an unsafe intent directory name or active-intent pointer', async () => {
    seed();
    mem.files.set(`${WS}/aidlc/spaces/default/aidlc-state.md`, GRAPH_STATE);
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '.hidden', '']) {
      expect(await new LifecycleCollector().collect(root(), bad)).toBeNull();
    }
    mem.files.set(`${INTENTS}/active-intent`, '..');
    // The pointer escapes intents/ (to .../default/aidlc-state.md, seeded above): nothing is read.
    expect(await new LifecycleCollector().collect(root())).toBeNull();
  });

  it('refuses a state file over 2 MB and fails closed on an oversized unit document', async () => {
    seed();
    mem.sizes.set(`${INTENTS}/${dir}/aidlc-state.md`, 3 * 1024 * 1024);
    expect(await new LifecycleCollector().collect(root())).toBeNull();

    mem.sizes.delete(`${INTENTS}/${dir}/aidlc-state.md`);
    mem.sizes.set(`${INTENTS}/${dir}/inception/units-generation/unit-of-work-dependency.md`, 3 * 1024 * 1024);
    const m = await new LifecycleCollector().collect(root());
    expect(m!.units).toEqual([]);
    expect(m!.unitsError).toBe('unreadable: file is larger than 2 MB');
  });

  it('ignores an oversized stage graph and still builds from the state', async () => {
    seed();
    mem.sizes.set(`${WS}/.kiro/tools/data/stage-graph.json`, 3 * 1024 * 1024);
    const m = await new LifecycleCollector().collect(root());
    expect(m!.hasStageGraph).toBe(false);
    expect(m!.phases.length).toBeGreaterThan(0);
  });

  describe('collectResult: why there is no model', () => {
    const none = { kind: 'none' };
    const collectResult = (intent?: string) => new LifecycleCollector().collectResult(root(), intent);

    it('is `none` when no intent is active, and null from collect()', async () => {
      expect(await collectResult()).toEqual(none);
      expect(await new LifecycleCollector().collect(root())).toBeNull();
    });

    it('says the state file is missing for an intent that has none', async () => {
      seed();
      expect(await collectResult('no-such-intent')).toEqual({ kind: 'unreadable', reason: 'state file missing' });
      expect(await new LifecycleCollector().collect(root(), 'no-such-intent')).toBeNull();
    });

    it('says the state file is too large', async () => {
      seed();
      mem.sizes.set(`${INTENTS}/${dir}/aidlc-state.md`, 3 * 1024 * 1024);
      expect(await collectResult()).toEqual({ kind: 'unreadable', reason: 'state file too large (over 2 MB)' });
      expect(await collectResult(dir)).toEqual({ kind: 'unreadable', reason: 'state file too large (over 2 MB)' });
    });

    it('says the state file is unreadable when the read fails', async () => {
      seed();
      mem.unreadable.add(`${INTENTS}/${dir}/aidlc-state.md`);
      // stat sees the file, the read throws.
      expect(await collectResult(dir)).toEqual({ kind: 'unreadable', reason: 'state file unreadable' });
    });

    it('names an invalid intent directory or pointer', async () => {
      seed();
      for (const bad of ['..', 'a/b', '.hidden', '']) {
        expect(await collectResult(bad)).toEqual({ kind: 'unreadable', reason: 'intent directory name is not valid' });
      }
      mem.files.set(`${WS}/aidlc/spaces/default/aidlc-state.md`, GRAPH_STATE);
      mem.files.set(`${INTENTS}/active-intent`, '..');
      expect(await collectResult()).toEqual({ kind: 'unreadable', reason: 'active intent is not a directory of intents/' });
    });

    it('gives the model when the intent is readable', async () => {
      seed();
      const result = await collectResult();
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.model.intentDir).toBe(`aidlc/spaces/default/intents/${dir}`);
        expect(result.model).toEqual((await new LifecycleCollector().collect(root()))!);
      }
    });

    it('does not read a missing optional file as an error', async () => {
      seed();
      mem.files.delete(`${INTENTS}/${dir}/inception/units-generation/unit-of-work-dependency.md`);
      const result = await collectResult();
      expect(result.kind).toBe('ok');
    });
  });

  describe('the record walk', () => {
    const REL = `aidlc/spaces/default/intents/${dir}`;
    const IC = `${INTENTS}/${dir}/ideation/intent-capture`;
    const collectModel = async () => (await new LifecycleCollector().collect(root(), dir))!;
    const base = () => {
      mem.files.set(`${INTENTS}/${dir}/aidlc-state.md`, GRAPH_STATE);
      mem.files.set(`${WS}/.kiro/tools/data/stage-graph.json`, GRAPH);
    };

    it('does not follow symbolic links, hidden directories or the audit directory', async () => {
      base();
      mem.files.set(`${IC}/intent-statement.md`, '# ok');
      mem.files.set(`${IC}/linked-file.md`, 'x');
      mem.types.set(`${IC}/linked-file.md`, 65); // File | SymbolicLink
      mem.files.set(`${IC}/linked-dir/inner.md`, 'x');
      mem.types.set(`${IC}/linked-dir`, 66); // Directory | SymbolicLink
      mem.files.set(`${IC}/.hidden/secret.md`, 'x');
      mem.files.set(`${IC}/nested/inner.md`, 'x');
      // A phase directory named audit/ under the record root is never walked...
      mem.files.set(`${INTENTS}/${dir}/audit/shard-stage/x.md`, 'x');
      // ...nor is a hidden one.
      mem.files.set(`${INTENTS}/${dir}/.git/ideation/intent-capture/y.md`, 'x');
      const graph = JSON.stringify([
        ...JSON.parse(GRAPH),
        { slug: 'shard-stage', number: '9.9', name: 'Shard', phase: 'audit', produces: [] },
      ]);
      mem.files.set(`${WS}/.kiro/tools/data/stage-graph.json`, graph);
      mem.files.set(`${INTENTS}/${dir}/aidlc-state.md`, state('### AUDIT PHASE\n- [ ] shard-stage — EXECUTE\n### IDEATION PHASE\n- [x] intent-capture — EXECUTE'));

      const m = await collectModel();
      expect(bySlug(m, 'intent-capture').artifacts).toEqual([
        `${REL}/ideation/intent-capture/intent-statement.md`,
        `${REL}/ideation/intent-capture/nested/inner.md`,
      ]);
      expect(bySlug(m, 'shard-stage').artifacts).toEqual([]);
    });

    it('lists the audit directory when it is not directly under the record root', async () => {
      base();
      // The skip is for the record's own audit/ shard directory only: a stage folder keeps its files.
      mem.files.set(`${IC}/audit/notes.md`, 'x');
      const m = await collectModel();
      expect(bySlug(m, 'intent-capture').artifacts).toEqual([`${REL}/ideation/intent-capture/audit/notes.md`]);
    });

    it('stops below the depth cap: <phase>/<stage>/<sub>/<file> is listed, one level deeper is not', async () => {
      base();
      mem.files.set(`${IC}/sub/listed.md`, 'x');
      mem.files.set(`${IC}/sub/deeper/not-listed.md`, 'x');
      const m = await collectModel();
      expect(bySlug(m, 'intent-capture').artifacts).toEqual([`${REL}/ideation/intent-capture/sub/listed.md`]);
    });

    it('stops at 5000 files', async () => {
      base();
      for (let i = 0; i < 5200; i++) {
        mem.files.set(`${IC}/f${String(i).padStart(4, '0')}.md`, 'x');
      }
      mem.files.set(`${IC}/zz-last.md`, 'x');
      const m = await collectModel();
      const artifacts = bySlug(m, 'intent-capture').artifacts;
      // The walk's 5000 entries include aidlc-state.md, listed first (record root, sorted).
      expect(artifacts).toHaveLength(4999);
      expect(artifacts).not.toContain(`${REL}/ideation/intent-capture/zz-last.md`);
      expect(artifacts).toContain(`${REL}/ideation/intent-capture/f0000.md`);
    });

    it('drops names that are not one safe path segment', async () => {
      base();
      mem.files.set(`${IC}/intent-statement.md`, 'x');
      mem.files.set(`${IC}/bad\u0001name.md`, 'x');
      const m = await collectModel();
      expect(bySlug(m, 'intent-capture').artifacts).toEqual([`${REL}/ideation/intent-capture/intent-statement.md`]);
    });
  });

  describe('the codekb walk', () => {
    const CODEKB = `${WS}/aidlc/spaces/default/codekb`;
    const REL = 'aidlc/spaces/default/codekb';
    const graph = JSON.stringify([
      { slug: 'reverse-engineering', number: '2.1', name: 'Reverse Engineering', phase: 'inception', produces: ['business-overview', 'architecture'] },
    ]);
    const seedCodekb = () => {
      mem.files.set(`${INTENTS}/${dir}/aidlc-state.md`, state('### INCEPTION PHASE\n- [?] reverse-engineering — EXECUTE'));
      mem.files.set(`${WS}/.kiro/tools/data/stage-graph.json`, graph);
    };
    const artifacts = async () => bySlug((await new LifecycleCollector().collect(root(), dir))!, 'reverse-engineering').artifacts;

    it('gives the reverse-engineering gate its codekb files, in produces order', async () => {
      seedCodekb();
      mem.files.set(`${CODEKB}/app/architecture.md`, '# a');
      mem.files.set(`${CODEKB}/app/business-overview.md`, '# b');
      mem.files.set(`${CODEKB}/app/unrelated.md`, '# c');
      mem.files.set(`${CODEKB}/lib/architecture.md`, '# d');
      expect(await artifacts()).toEqual([
        `${REL}/app/business-overview.md`,
        `${REL}/app/architecture.md`,
        `${REL}/lib/architecture.md`,
      ]);
    });

    it('does not follow symbolic links or hidden directories, and stops one level below the repo', async () => {
      seedCodekb();
      mem.files.set(`${CODEKB}/app/architecture.md`, '# a');
      mem.files.set(`${CODEKB}/app/business-overview.md`, '# b');
      mem.types.set(`${CODEKB}/app/business-overview.md`, 65);
      mem.files.set(`${CODEKB}/linked/architecture.md`, '# c');
      mem.types.set(`${CODEKB}/linked`, 66);
      mem.files.set(`${CODEKB}/.hidden/architecture.md`, '# d');
      mem.files.set(`${CODEKB}/app/sub/architecture.md`, '# e');
      expect(await artifacts()).toEqual([`${REL}/app/architecture.md`]);
    });

    it('is empty, not an error, when the space has no codekb', async () => {
      seedCodekb();
      expect(await artifacts()).toEqual([]);
    });
  });
});
