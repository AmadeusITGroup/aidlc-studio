import { describe, expect, it } from 'vitest';
import type { LifecycleModel, LifecycleResult, LifecycleStage, LifecycleStatus, UnitCell } from '../../services/lifecycleModel';
import { LIFECYCLE_CSS, LIFECYCLE_SCRIPT, esc, lifecycleActionFor, renderLifecycleTab } from './lifecycleTab';

const REC = 'aidlc/spaces/default/intents/260101-demo';
const EVIL = `<img src=x onerror="alert('x')">&"'`;

function stage(slug: string, over: Partial<LifecycleStage> = {}): LifecycleStage {
  return {
    slug,
    number: '1.1',
    name: 'Intent Capture',
    phase: 'ideation',
    status: 'pending',
    inPlan: true,
    counted: true,
    leadAgent: 'aidlc-product-agent',
    perUnit: false,
    artifacts: [],
    sensors: { passed: 0, failed: 0, other: 0 },
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

function model(over: Partial<LifecycleModel> = {}): LifecycleModel {
  const done = stage('intent-capture', { status: 'completed' });
  return {
    intentLabel: 'Demo checkout',
    intentDir: REC,
    scope: 'feature',
    current: null,
    revisionCount: null,
    phases: [{ id: 'ideation', name: 'Ideation', stages: [done], done: 1, total: 1 }],
    gates: [],
    units: [],
    unitStages: [],
    unitCells: [],
    unitsSource: null,
    totals: { done: 1, total: 1, completed: 1, skipped: 0 },
    hasStageGraph: true,
    hasRuntimeGraph: true,
    ...over,
  };
}

/** The tab takes the collector's result: wrap a model in `ok`. */
function render(m: LifecycleModel): string {
  return renderLifecycleTab({ kind: 'ok', model: m } satisfies LifecycleResult);
}

const ART = `${REC}/inception/requirements-analysis/requirements.md`;
const GATE = stage('requirements-analysis', {
  number: '2.3', name: 'Requirements Analysis', phase: 'inception', status: 'awaiting-approval', artifacts: [ART],
});

describe('esc', () => {
  it('escapes the five HTML characters, single quote included', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(esc(7)).toBe('7');
  });
});

describe('renderLifecycleTab: empty and partial data', () => {
  it('shows one hint for no active intent and nothing else', () => {
    const html = renderLifecycleTab({ kind: 'none' });
    expect(html).toContain('No active intent.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="cards"');
  });

  it('names the reason, escaped, for an unreadable intent, and not "No active intent."', () => {
    const html = renderLifecycleTab({ kind: 'unreadable', reason: 'state file too large (over 2 MB)' });
    expect(html).toContain('<p class="hint">Lifecycle unavailable: state file too large (over 2 MB)</p>');
    expect(html).not.toContain('No active intent.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<table');
    const evil = renderLifecycleTab({ kind: 'unreadable', reason: EVIL });
    expect(evil).not.toContain('<img');
    expect(evil).toContain('Lifecycle unavailable: &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&quot;&#39;');
  });

  it('renders the tab for an ok result', () => {
    const html = renderLifecycleTab({ kind: 'ok', model: model() });
    expect(html).toContain('Demo checkout');
    expect(html).toContain('class="cards"');
    expect(html).not.toContain('No active intent.');
    expect(html).not.toContain('Lifecycle unavailable');
  });

  it('renders an empty model (no stage, no gate, no unit) without a table or a unit section', () => {
    const html = render(model({
      phases: [], totals: { done: 0, total: 0, completed: 0, skipped: 0 }, hasStageGraph: false, hasRuntimeGraph: false,
    }));
    expect(html).toContain('No stage is running now.');
    expect(html).toContain('No gate is waiting.');
    expect(html).toContain('No stages found in the state file.');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<h2>Units</h2>');
    expect(html).toContain('Progress 0%');
  });

  it('notes the missing stage graph and runtime graph', () => {
    const none = render(model({ hasStageGraph: false, hasRuntimeGraph: false }));
    expect(none).toContain('Studio\'s defaults');
    expect(none).toContain('runtime-graph.json');
    const full = render(model());
    expect(full).not.toContain('Studio\'s defaults');
    expect(full).not.toContain('Sensors and times appear');
  });
});

describe('renderLifecycleTab: KPI cards', () => {
  it('shows progress with its percentage, the current stage, the gates and the units', () => {
    const cur = stage('functional-design', { number: '3.1', name: 'Functional Design', status: 'active', phase: 'construction' });
    const html = render(model({
      totals: { done: 3, total: 4, completed: 1, skipped: 2 }, current: cur, gates: [GATE],
      units: [{ name: 'auth', kind: 'service', batch: 1, dependsOn: [] }],
    }));
    expect(html).toContain('<div class="card-value">1/4</div><div class="card-label">Progress 75% · 2 skipped</div>');
    expect(html).toContain('<div class="card-value">3.1 Functional Design</div>');
    expect(html).toContain('<div class="card-value">1</div><div class="card-label">Gates waiting</div>');
    expect(html).toContain('<div class="card-label">Units</div>');
  });

  it('shows the completed count with the skipped count beside it, and a title that explains both', () => {
    const html = render(model({ totals: { done: 12, total: 32, completed: 9, skipped: 3 } }));
    // Overview agrees: completed only. The percentage is done/total (38%), as the framework computes it.
    expect(html).toContain('<div class="card-value">9/32</div><div class="card-label">Progress 38% · 3 skipped</div>');
    const title = html.match(/<div class="card card-done" title="([^"]*)"/)?.[1] ?? '';
    expect(title).toContain('9 completed and 3 skipped of 32 stages');
    expect(title).toContain('completed and skipped stages, as the framework does');
    expect(title).toContain('Overview tab');
  });

  it('omits the skipped count when no stage is skipped', () => {
    const html = render(model({ totals: { done: 2, total: 4, completed: 2, skipped: 0 } }));
    expect(html).toContain('<div class="card-value">2/4</div><div class="card-label">Progress 50%</div>');
    expect(html).not.toContain('skipped</div>');
  });

  it('shows - without a current stage and hides the Units card without units', () => {
    const html = render(model());
    expect(html).toContain('<div class="card-value">-</div><div class="card-label">Current stage</div>');
    expect(html).not.toContain('<div class="card-label">Units</div>');
  });
});

describe('renderLifecycleTab: Now', () => {
  const cur = stage('functional-design', {
    number: '3.1', name: 'Functional Design', phase: 'construction', status: 'active',
    leadAgent: 'aidlc-architect-agent', startedAt: '2026-01-01T10:05:30Z',
    sensors: { passed: 4, failed: 1, other: 2 },
    artifacts: [`${REC}/construction/auth/functional-design/business-rules.md`],
  });

  it('shows number, name, agent, status, start, revisions, sensors and an open button per artifact', () => {
    const html = render(model({ current: cur, revisionCount: 2 }));
    expect(html).toContain('3.1 Functional Design');
    expect(html).toContain('<span class="lc-agent">architect</span>');
    expect(html).toContain('<span class="badge status-active">▶ Active</span>');
    expect(html).toContain('2026-01-01 10:05 UTC');
    expect(html).toContain('<span class="detail-label">Revisions</span>');
    expect(html).toContain('4 passed · 1 failed · 2 other');
    expect(html).toContain(`data-action="open" data-arg="${REC}/construction/auth/functional-design/business-rules.md"`);
    expect(html).toContain('>construction/auth/functional-design/business-rules.md</button>');
  });

  it('omits the revision count when unknown and shows dashes without a runtime graph', () => {
    const html = render(model({ current: { ...cur, startedAt: null }, revisionCount: null, hasRuntimeGraph: false }));
    expect(html).not.toContain('<span class="detail-label">Revisions</span>');
    expect(html).toContain('<span class="detail-value lc-detail-value">–</span>');
    expect(html).not.toContain('4 passed');
  });
});

describe('renderLifecycleTab: Gates waiting', () => {
  it('has a table row per gate with the three actions', () => {
    const html = render(model({ gates: [GATE] }));
    expect(html).toContain('<th>Stage</th><th>Artifacts</th><th>Actions</th>');
    expect(html).toContain('2.3 Requirements Analysis');
    expect(html).toContain('>requirements.md</span>');
    expect(html).toContain(`data-action="open" data-arg="${ART}"`);
    expect(html).toContain('data-action="approve" data-arg="requirements-analysis"');
    expect(html).toContain('data-action="request-changes" data-arg="requirements-analysis"');
    expect(html).toContain('>Copy approve</button>');
    expect(html).toContain('aria-label="Copy approve for the chat"');
    expect(html).toContain('title="Copies &quot;approve&quot; for the Kiro chat. It applies to the stage the framework is waiting on, which may not be this one."');
    expect(html).not.toContain('Approve in chat');
    expect(html).not.toContain('Approve 2.3');
    expect(html).toContain('>Request changes</button>');
  });

  it('disables Open artifact, with a title, when the gate has no artifact', () => {
    const html = render(model({ gates: [{ ...GATE, artifacts: [] }] }));
    expect(html).toContain('<button type="button" class="btn btn-sm" disabled title="This stage has no artifact on disk yet"');
    expect(html).not.toContain('data-action="open"');
  });

  it('says so when no gate is waiting', () => {
    const html = render(model());
    expect(html).toContain('No gate is waiting.');
    expect(html).not.toContain('Copy approve');
  });
});

describe('renderLifecycleTab: Phases', () => {
  const statuses: [LifecycleStatus, string, string, string][] = [
    ['completed', 'Completed', '✓', 'pill-done'],
    ['active', 'Active', '▶', 'pill-active'],
    ['awaiting-approval', 'Awaiting approval', '◆', 'pill-await'],
    ['revised', 'Revising', '↻', 'pill-revised'],
    ['skipped', 'Skipped', '–', 'pill-skip'],
    ['pending', 'Pending', '○', 'pill-pending'],
  ];

  it.each(statuses)('labels %s with a glyph, a word and the %s pill', (status, label, glyph, pill) => {
    const s = stage(`s-${status}`, { status });
    const html = render(model({
      phases: [{ id: 'ideation', name: 'Ideation', stages: [s], done: 0, total: 1 }],
    }));
    expect(html).toContain(`<span>${glyph} ${label}</span>`);
    expect(html).toContain(`class="pill ${pill}" aria-hidden="true"`);
  });

  it('renders one lane per phase, in model order, with done/total and a bar', () => {
    const a = stage('a', { number: '1.1', name: 'Alpha' });
    const b = stage('b', { number: '2.1', name: 'Beta', phase: 'inception' });
    const html = render(model({
      phases: [
        { id: 'ideation', name: 'Ideation', stages: [a], done: 0, total: 1 },
        { id: 'inception', name: 'Inception', stages: [b], done: 1, total: 2 },
      ],
    }));
    expect(html.indexOf('>Ideation<')).toBeLessThan(html.indexOf('>Inception<'));
    expect(html).toContain('<span class="sm">0/1 done</span>');
    expect(html).toContain('<span class="sm">1/2 done</span>');
    expect(html).toContain('<div class="mini-fill" style="width:50%"></div>');
    expect(html.match(/class="lc-lane"/g)).toHaveLength(2);
  });

  it('puts the skip reason in the card title and marks per-unit stages', () => {
    const s = stage('s', { status: 'skipped', skipReason: 'Scope excludes this stage', perUnit: true });
    const html = render(model({
      phases: [{ id: 'ideation', name: 'Ideation', stages: [s], done: 1, total: 1 }],
    }));
    expect(html).toContain('title="1.1 Intent Capture – Skipped: Scope excludes this stage"');
    expect(html).toContain('<span class="lc-tag">per unit</span>');
  });

  it('dims a stage that is not in the plan and labels it', () => {
    const s = stage('s', { inPlan: false, counted: false, status: 'skipped', skipReason: "not in this intent's plan" });
    const planned = stage('p');
    const html = render(model({
      phases: [{ id: 'ideation', name: 'Ideation', stages: [planned, s], done: 0, total: 1 }],
    }));
    expect(html).toContain('class="lc-stage lc-s-skip dim"');
    expect(html).toContain('<span class="lc-tag">Not in plan</span>');
    expect(html.match(/Not in plan/g)).toHaveLength(1);
    expect(html).not.toContain('class="lc-reason"');
  });
});

describe('renderLifecycleTab: Units', () => {
  const units = [
    { name: 'auth', kind: 'service', batch: 1, dependsOn: [] },
    { name: 'web', kind: null, batch: 2, dependsOn: ['auth'] },
  ];
  const unitStages = [{ slug: 'functional-design', number: '3.1', name: 'Functional Design' }];
  const cell = (unit: string, state: UnitCell['state'], present: number, expected: number, files: string[] = []): UnitCell =>
    ({ unit, stageSlug: 'functional-design', state, present, expected, files });

  it('has units as rows, per-unit stages as columns, and a glyph, a word and present/expected per cell', () => {
    const html = render(model({
      units, unitStages,
      unitCells: [cell('auth', 'done', 2, 2, [`${REC}/construction/auth/functional-design/a.md`, `${REC}/construction/auth/functional-design/b.md`]), cell('web', 'in-progress', 1, 3)],
    }));
    expect(html).toContain('<th scope="col">3.1 Functional Design</th>');
    expect(html).toContain('<th scope="row" class="lc-unit">auth</th><td>service</td><td>B1</td>');
    expect(html).toContain('<th scope="row" class="lc-unit">web</th><td>–</td><td>B2</td>');
    expect(html).toContain('<span class="lc-cell-state">✓ Done</span> <span class="sm">2/2</span>');
    expect(html).toContain('<span class="lc-cell-state">● In progress</span> <span class="sm">1/3</span>');
    expect(html).toContain(`title="${REC}/construction/auth/functional-design/a.md\n${REC}/construction/auth/functional-design/b.md"`);
    expect(html).toContain('<td class="lc-cell lc-c-active" title="No files">');
  });

  it.each([
    ['done', '✓ Done'],
    ['in-progress', '● In progress'],
    ['pending', '○ Pending'],
    ['not-applicable', '– N/A'],
  ] as const)('labels the %s cell', (state, text) => {
    const html = render(model({ units: [units[0]], unitStages, unitCells: [cell('auth', state, 0, 1)] }));
    expect(html).toContain(`<span class="lc-cell-state">${text}</span>`);
  });

  it('renders a missing cell as N/A', () => {
    const html = render(model({ units: [units[0]], unitStages, unitCells: [] }));
    expect(html).toContain('<span class="lc-cell-state">– N/A</span> <span class="sm">0/0</span>');
  });

  it('is absent without units and without an error', () => {
    expect(render(model())).not.toContain('<h2>Units</h2>');
  });

  it('shows the error as a hint, escaped', () => {
    const html = render(model({ unitsError: EVIL }));
    expect(html).toContain('<p class="hint">Units unavailable: &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&quot;&#39;</p>');
    expect(html).not.toContain('<table class="lc-matrix"');
  });

  it('says per-unit stages need the stage graph when the model has units but no per-unit stage', () => {
    const html = render(model({ units, unitStages: [], hasStageGraph: false }));
    expect(html).toContain('Per-unit stages need the installed stage graph');
  });
});

describe('renderLifecycleTab: escaping', () => {
  it('escapes every model string, quotes included', () => {
    const art = `${REC}/inception/x/${EVIL}.md`;
    const s = stage('evil-stage', {
      number: EVIL, name: EVIL, leadAgent: EVIL, status: 'awaiting-approval', skipReason: EVIL, artifacts: [art], startedAt: EVIL,
    });
    const skipped = stage('skipped-stage', { name: EVIL, status: 'skipped', skipReason: EVIL });
    const html = render(model({
      intentLabel: EVIL, scope: EVIL,
      current: s, gates: [s],
      phases: [{ id: 'x', name: EVIL, stages: [s, skipped], done: 0, total: 2 }],
      units: [{ name: EVIL, kind: EVIL, batch: 1, dependsOn: [] }],
      unitStages: [{ slug: 'u', number: EVIL, name: EVIL }],
      unitCells: [{ unit: EVIL, stageSlug: 'u', state: 'done', present: 1, expected: 1, files: [art] }],
      unitsError: EVIL,
    }));
    // The raw payload never appears; every `<` of the page belongs to its own markup.
    expect(html).not.toContain(EVIL);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="alert');
    // No event-handler attribute on any tag (quoted attribute values are stripped first: they are inert text).
    expect(html.replace(/"[^"]*"/g, '""').match(/<[^>]*\son\w+=/)?.[0]).toBeUndefined();
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&quot;&#39;');
    // Attributes stay double-quoted: no value ends an attribute early.
    expect(html).not.toMatch(/data-arg="[^"]*"[^ >]/);
  });
});

describe('renderLifecycleTab: actions and script', () => {
  it('uses only three data-action values and no inline handler', () => {
    const cur = stage('c', { status: 'active', artifacts: [`${REC}/ideation/c/x.md`] });
    const html = render(model({ current: cur, gates: [GATE] }));
    const actions = new Set([...html.matchAll(/data-action="([^"]*)"/g)].map((m) => m[1]));
    expect([...actions].sort()).toEqual(['approve', 'open', 'request-changes']);
    expect(html).not.toMatch(/\sonclick=/);
    expect(html).not.toContain('javascript:');
  });

  it('posts only the three fixed messages and never builds a command from data', () => {
    const commands = [...LIFECYCLE_SCRIPT.matchAll(/command:'([^']*)'/g)].map((m) => m[1]);
    expect(commands.sort()).toEqual(['lifecycleApprove', 'lifecycleOpen', 'lifecycleRequestChanges']);
    expect(LIFECYCLE_SCRIPT).not.toContain('command:v');
    expect(LIFECYCLE_SCRIPT).not.toContain('innerHTML');
    expect(render(model())).toContain(`<script>${LIFECYCLE_SCRIPT}</script>`);
  });
});

describe('LIFECYCLE_CSS', () => {
  it('uses theme variables with fallbacks and a visible focus outline', () => {
    expect(LIFECYCLE_CSS).toContain('var(--vscode-focusBorder,#007fd4)');
    expect(LIFECYCLE_CSS).not.toMatch(/https?:|@import|url\(/);
  });

  it('darkens the gold, green, blue and orange states in both light themes, inside the tab only', () => {
    const light = LIFECYCLE_CSS.split('\n').filter((l) => l.startsWith('.vscode-light'));
    expect(light.length).toBeGreaterThanOrEqual(4);
    for (const line of light) {
      expect(line).toContain('.vscode-high-contrast-light');
      // every selector of the rule is scoped to the tab
      const selectors = line.slice(0, line.indexOf('{')).split(',');
      for (const sel of selectors) { expect(sel).toMatch(/\.lc/); }
      expect(line).toMatch(/var\(--vscode-charts-(yellow|green|blue|orange),#[0-9a-f]{6}\)/);
    }
    expect(light.join('')).toContain('.lc .status-active');
    expect(light.join('')).toContain('.lc-c-active .lc-cell-state');
  });
});

describe('lifecycleActionFor', () => {
  const withGate = model({
    gates: [GATE],
    phases: [{ id: 'inception', name: 'Inception', stages: [GATE], done: 0, total: 1 }],
  });

  it('accepts an artifact path of the model and a gate slug', () => {
    expect(lifecycleActionFor(withGate, { command: 'lifecycleOpen', path: ART })).toEqual({ kind: 'open', path: ART });
    expect(lifecycleActionFor(withGate, { command: 'lifecycleApprove', stage: 'requirements-analysis' }))
      .toEqual({ kind: 'approve', stage: 'requirements-analysis' });
    expect(lifecycleActionFor(withGate, { command: 'lifecycleRequestChanges', stage: 'requirements-analysis' }))
      .toEqual({ kind: 'requestChanges', stage: 'requirements-analysis' });
  });

  it('ignores a path that is not an artifact of the model', () => {
    for (const path of ['../../etc/passwd', `${REC}/other.md`, '/etc/passwd', '', ART + '/..']) {
      expect(lifecycleActionFor(withGate, { command: 'lifecycleOpen', path })).toBeNull();
    }
  });

  it('ignores a stage that is not a gate', () => {
    expect(lifecycleActionFor(withGate, { command: 'lifecycleApprove', stage: 'intent-capture' })).toBeNull();
    expect(lifecycleActionFor(withGate, { command: 'lifecycleRequestChanges', stage: '' })).toBeNull();
  });

  it('ignores other commands, other argument shapes and a missing model', () => {
    expect(lifecycleActionFor(withGate, { command: 'amadeus-aidlc.approveStage', stage: 'requirements-analysis' })).toBeNull();
    expect(lifecycleActionFor(withGate, { command: 'lifecycleOpen', path: 42 })).toBeNull();
    expect(lifecycleActionFor(withGate, { command: 'lifecycleOpen', path: [ART] })).toBeNull();
    expect(lifecycleActionFor(withGate, { command: 'lifecycleApprove' })).toBeNull();
    expect(lifecycleActionFor(withGate, { command: 'lifecycleOpen', stage: 'requirements-analysis' })).toBeNull();
    expect(lifecycleActionFor(withGate, null)).toBeNull();
    expect(lifecycleActionFor(withGate, 'lifecycleOpen')).toBeNull();
    expect(lifecycleActionFor(null, { command: 'lifecycleOpen', path: ART })).toBeNull();
  });
});
