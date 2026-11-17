import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class ThemeColor { constructor(public id: string) {} }
  class ThemeIcon { constructor(public id: string, public color?: ThemeColor) {} }
  class TreeItem {
    description?: string;
    iconPath?: unknown;
    contextValue?: string;
    tooltip?: string;
    command?: unknown;
    constructor(public label: string, public collapsibleState?: number) {}
  }
  class EventEmitter {
    listeners: Array<() => void> = [];
    event = (listener: () => void) => { this.listeners.push(listener); };
    fire() { this.listeners.forEach((l) => l()); }
  }
  return { ThemeColor, ThemeIcon, TreeItem, EventEmitter, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 } };
});

import { OverviewItem, OverviewProvider } from './overviewProvider';
import { absentKbHealth, parseKbIndex, unreadableKbHealth } from '../services/documentKbReader';
import type { KbHealth } from '../services/documentKbReader';
import type { OverviewModel } from '../services/overviewCollector';

const SHA = 'a'.repeat(64);

function kb(): KbHealth {
  const doc = (n: number, state: string, extra: Record<string, unknown> = {}) => ({
    id: `0190a1b2-c3d4-7e5f-8a6b-00000000000${n}`,
    source: { kind: 'managed', path: `docs/${n}.pdf` },
    sha256: SHA, bytes: 1, indexed_at: '2026-01-02T03:04:05Z',
    // A record the framework's validator accepts (see documentKbReader.test.ts).
    extraction: { state, extractor: { name: 'text', version: '1' }, source_revision: SHA, chars: 5, truncated: false, ...extra },
    summary: { state: 'absent' },
  });
  return parseKbIndex(JSON.stringify({
    schema_version: 1,
    documents: [
      doc(1, 'extracted'),
      doc(2, 'extracted', { source_revision: 'b'.repeat(64) }),
      { ...doc(3, 'extracted'), related_intent_ids: ['0190a1b2-c3d4-7e5f-8a6b-0000000000aa'] },
    ],
  }));
}

function model(overrides: Partial<OverviewModel> = {}): OverviewModel {
  return {
    space: 'default',
    needsAttention: [],
    lifecycle: {
      hasIntent: true, intentLabel: 'checkout', progressDone: 3, progressTotal: 10, complete: false,
      phase: 'Inception', now: 'Requirements', gatesOpen: 0,
    },
    pod: { intentsRunning: 1, intentsTotal: 2, gatesOpen: 0, codeMaps: ['api', 'web'], knowledge: kb() },
    ...overrides,
  };
}

async function groups(m: OverviewModel): Promise<OverviewItem[]> {
  return new OverviewProvider({ collect: async () => m }).getChildren();
}

function icon(item: OverviewItem): { id: string; color?: { id: string } } {
  return item.iconPath as { id: string; color?: { id: string } };
}

function child(group: OverviewItem, label: string): OverviewItem {
  const found = group.children?.find((c) => c.label === label);
  if (!found) { throw new Error(`no child ${label}`); }
  return found;
}

describe('OverviewProvider', () => {
  it('shows the lifecycle and pod groups, expanded, when nothing needs attention', async () => {
    const roots = await groups(model());
    expect(roots.map((r) => r.label)).toEqual(['AI-DLC lifecycle', 'AI pod']);
    expect(roots.every((r) => r.collapsibleState === 2)).toBe(true);
    expect(icon(roots[0]).id).toBe('git-merge');
    expect(icon(roots[1]).id).toBe('organization');
  });

  it('puts Needs attention first, with the bell, only when there is something', async () => {
    const roots = await groups(model({
      needsAttention: [
        { kind: 'gate', label: 'Gate: 2.1 Requirements', stageId: '2.1' },
        { kind: 'rework', label: 'Rework: 2.2 Stories', stageId: '2.2' },
        { kind: 'kb-remedy', label: '1 knowledge document needs a remedy' },
        { kind: 'kb-unreadable', label: 'Knowledge catalog unreadable', detail: 'index.json is missing: /aidlc knowledge sync rebuilds it' },
        { kind: 'no-code-map', label: 'No code map yet' },
      ],
    }));
    expect(roots.map((r) => r.label)).toEqual(['Needs attention', 'AI-DLC lifecycle', 'AI pod']);
    const attention = roots[0];
    expect(icon(attention).id).toBe('bell');
    expect(attention.collapsibleState).toBe(2);
    expect(attention.description).toBe('5');
    expect(attention.children).toHaveLength(5);
    for (const item of attention.children ?? []) {
      expect(icon(item)).toMatchObject({ id: 'warning', color: { id: 'charts.yellow' } });
    }
    const [gate, rework, remedy, unreadable, codeMap] = attention.children ?? [];
    expect(gate.command).toEqual({ command: 'amadeus-aidlc.reviewArtifact', title: 'Review Artifact', arguments: ['2.1'] });
    expect(rework.command).toMatchObject({ command: 'amadeus-aidlc.copyAndContinue' });
    expect(remedy.command).toMatchObject({ command: 'amadeus-aidlc.knowledge' });
    expect(unreadable.command).toMatchObject({ command: 'amadeus-aidlc.knowledge' });
    expect(unreadable.label).toBe('Knowledge catalog unreadable');
    expect(unreadable.tooltip).toContain('index.json is missing: /aidlc knowledge sync rebuilds it');
    expect(codeMap.command).toBeUndefined();
  });

  it('lists the lifecycle rows with their icons and values', async () => {
    const [life] = await groups(model());
    expect(life.description).toBe('checkout');
    expect(life.command).toEqual({ command: 'amadeus-aidlc.openAnalytics', title: 'Open Analytics' });
    expect((life.children ?? []).map((c) => c.label)).toEqual(['Progress', 'Phase', 'Now', 'Gates open']);
    expect(child(life, 'Progress')).toMatchObject({ description: '3/10' });
    expect(icon(child(life, 'Progress')).id).toBe('checklist');
    expect(child(life, 'Phase')).toMatchObject({ description: 'Inception' });
    expect(icon(child(life, 'Phase')).id).toBe('layers');
    expect(child(life, 'Now')).toMatchObject({ description: 'Requirements' });
    expect(icon(child(life, 'Now')).id).toBe('play');
  });

  it('uses the eye in yellow for open gates and the check in green for none, always with the count', async () => {
    const open = await groups(model({
      lifecycle: { ...model().lifecycle, gatesOpen: 2 },
      pod: { ...model().pod, gatesOpen: 3 },
    }));
    expect(child(open[0], 'Gates open')).toMatchObject({ description: '2' });
    expect(icon(child(open[0], 'Gates open'))).toMatchObject({ id: 'eye', color: { id: 'charts.yellow' } });
    expect(child(open[1], 'Gates open (space)')).toMatchObject({ description: '3' });
    expect(icon(child(open[1], 'Gates open (space)'))).toMatchObject({ id: 'eye', color: { id: 'charts.yellow' } });

    const none = await groups(model());
    expect(child(none[0], 'Gates open')).toMatchObject({ description: '0' });
    expect(icon(child(none[0], 'Gates open'))).toMatchObject({ id: 'pass', color: { id: 'charts.green' } });
    expect(icon(child(none[1], 'Gates open (space)'))).toMatchObject({ id: 'pass', color: { id: 'charts.green' } });
  });

  it('names the scope of the two gate counts, in the label and in the tooltip', async () => {
    const [life, pod] = await groups(model());
    expect(child(life, 'Gates open').tooltip).toBe('Stages of the active intent that are awaiting your approval.');
    expect(child(pod, 'Gates open (space)').tooltip)
      .toBe('Stages awaiting approval, summed over every intent of the "default" space.');
    expect(child(life, 'Gates open').contextValue).toBe('overview-gates');
    expect(child(pod, 'Gates open (space)').contextValue).toBe('overview-gates-space');
  });

  it('shows a single info row, that copies the prompt, when there is no intent', async () => {
    const [life] = await groups(model({
      lifecycle: {
        hasIntent: false, intentLabel: null, progressDone: 0, progressTotal: 0, complete: false,
        phase: null, now: null, gatesOpen: 0,
      },
    }));
    expect(life.children).toHaveLength(1);
    const row = (life.children ?? [])[0];
    expect(row.label).toBe('No AI-DLC workflow yet');
    expect(icon(row).id).toBe('info');
    expect(row.command).toEqual({ command: 'amadeus-aidlc.startWorkflow', title: 'Start New Workflow' });
  });

  it('says so when the scope is not decided or the workflow is complete', async () => {
    const [undecided] = await groups(model({
      lifecycle: { ...model().lifecycle, progressTotal: 0, progressDone: 0, phase: null, now: null },
    }));
    expect(child(undecided, 'Phase').description).toBe('Scope not decided yet');
    expect(child(undecided, 'Now').description).toBe('-');

    const [done] = await groups(model({ lifecycle: { ...model().lifecycle, complete: true, now: null } }));
    expect(child(done, 'Now').description).toBe('All stages finished');
  });

  it('lists the pod rows: intents, gates, code maps and knowledge', async () => {
    const roots = await groups(model());
    const pod = roots[1];
    expect(pod.command).toEqual({ command: 'amadeus-aidlc.openAnalytics', title: 'Open Analytics' });
    expect((pod.children ?? []).map((c) => c.label)).toEqual(['Intents running', 'Gates open (space)', 'Code maps', 'Knowledge']);

    expect(child(pod, 'Intents running')).toMatchObject({ description: '1 of 2' });
    expect(icon(child(pod, 'Intents running')).id).toBe('run');

    const maps = child(pod, 'Code maps');
    expect(maps.description).toBe('2');
    expect(maps.tooltip).toBe('api\nweb');
    expect(icon(maps).id).toBe('file-code');

    const knowledge = child(pod, 'Knowledge');
    expect(knowledge.description).toBe('66%'); // 2 of 3, floored
    expect(icon(knowledge).id).toBe('book');
    expect(knowledge.command).toEqual({ command: 'amadeus-aidlc.knowledge', title: 'Knowledge' });
    expect(knowledge.tooltip).toBe([
      'Active documents: 3',
      'Extracted: 2 of 3',
      'Need a remedy: 1',
      'Intent-scoped: 1',
      'Space-wide: 2',
      'Summarized: 0',
    ].join('\n'));
  });

  it('shows a dash for Knowledge when there is no percentage, and says when the index is unreadable', async () => {
    const absent = await groups(model({ pod: { ...model().pod, codeMaps: [], knowledge: absentKbHealth('default') } }));
    const row = child(absent[1], 'Knowledge');
    expect(row.description).toBe('-');
    expect(row.tooltip).toBe('No DocumentKB in this space yet');
    expect(child(absent[1], 'Code maps')).toMatchObject({ description: '0', tooltip: 'No code map under codekb/ yet' });

    const broken = await groups(model({ pod: { ...model().pod, knowledge: unreadableKbHealth('schema_version must be 1') } }));
    const bad = child(broken[1], 'Knowledge');
    expect(bad.description).toBe('unreadable');
    expect(bad.tooltip).toBe('Knowledge index unreadable: schema_version must be 1');
  });

  it('returns the children of a group and nothing for a leaf', async () => {
    const provider = new OverviewProvider({ collect: async () => model() });
    const [life] = await provider.getChildren();
    expect(await provider.getChildren(life)).toBe(life.children);
    expect(await provider.getChildren((life.children ?? [])[0])).toEqual([]);
    expect(provider.getTreeItem(life)).toBe(life);
  });

  it('shows nothing when the model cannot be built, and fires on refresh', async () => {
    const provider = new OverviewProvider({ collect: async () => { throw new Error('boom'); } });
    expect(await provider.getChildren()).toEqual([]);
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    provider.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
