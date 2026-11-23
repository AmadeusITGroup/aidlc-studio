import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbHealth } from '../services/documentKbReader';

// --- Test doubles the mocks read from ---
interface FakePanel {
  webview: { html: string; onDidReceiveMessage: (cb: (msg: unknown) => void) => { dispose(): void } };
  onDidDispose: (cb: () => void) => { dispose(): void };
  reveal: () => void;
  dispose: () => void;
}

let messageHandler: ((msg: unknown) => void) | undefined;
let panelHtml: () => string;
let kb: KbHealth;
const executed: unknown[][] = [];

const GLOBAL = {
  totalIntents: 0,
  activeIntents: 0,
  completedIntents: 0,
  intents: [],
  scopeDistribution: {},
  totalStagesAcrossAll: 0,
  totalCompletedAcrossAll: 0,
  totalArtifactsAcrossAll: 0,
};

vi.mock('vscode', () => {
  return {
    ViewColumn: { One: 1 },
    Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
    workspace: { workspaceFolders: [{ uri: { path: '/ws', fsPath: '/ws' } }] },
    commands: {
      executeCommand: async (...args: unknown[]) => { executed.push(args); },
    },
    window: {
      createWebviewPanel: (): FakePanel => {
        const webview = {
          html: '',
          onDidReceiveMessage: (cb: (msg: unknown) => void) => {
            messageHandler = cb;
            return { dispose: () => undefined };
          },
        };
        panelHtml = () => webview.html;
        return {
          webview,
          onDidDispose: () => ({ dispose: () => undefined }),
          reveal: () => undefined,
          dispose: () => undefined,
        };
      },
    },
  };
});

vi.mock('../services/analyticsCollector', () => ({
  AnalyticsCollector: class {
    async collectGlobal() { return GLOBAL; }
  },
}));

vi.mock('../services/graphDataCollector', () => ({
  GraphDataCollector: class {
    async collect() { return null; }
  },
}));

vi.mock('../services/documentKbReader', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/documentKbReader')>();
  return { ...original, readKbHealth: async () => kb };
});

import { AnalyticsPanel } from './analyticsPanel';

function send(msg: unknown): void {
  if (!messageHandler) { throw new Error('the panel registered no message handler'); }
  messageHandler(msg);
}

beforeEach(async () => {
  executed.length = 0;
  kb = {
    state: 'ok',
    space: 'default',
    documents: [{
      id: '11111111-1111-4111-8111-111111111111',
      sourceKind: 'managed',
      sourcePath: 'docs/<b>guide</b>.md',
      displayName: 'guide.md',
      extraction: 'extracted',
      remedy: null,
      scope: 'space',
      intentIds: [],
      tags: [],
      summary: 'absent',
      removed: false,
      indexedAt: '2026-03-04T10:20:30Z',
    }],
    active: 1,
    extracted: 1,
    extractable: 1,
    knowledgePct: 100,
    needsRemedy: 0,
    intentScoped: 0,
    spaceWide: 1,
    summarized: 0,
    tombstones: 0,
  };
  await AnalyticsPanel.show();
});

afterEach(() => {
  AnalyticsPanel.currentPanel = undefined;
  messageHandler = undefined;
});

describe('AnalyticsPanel Pod Brain tab', () => {
  it('buildPage adds the Pod Brain top tab and its content next to the existing ones', () => {
    const html = panelHtml();
    expect(html).toContain('id="tt-podbrain" onclick="showTopTab(\'podbrain\')">Pod Brain</div>');
    expect(html).toContain('<div class="top-content" id="tc-podbrain">');
    // the existing tabs are still there, and the new one comes after them
    const order = ['tt-overview', 'tt-graph', 'tt-timeline', 'tt-agents', 'tt-podbrain'].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders the catalog inside #tc-podbrain, escaped, and ships the tab CSS', () => {
    const html = panelHtml();
    const tab = html.slice(html.indexOf('id="tc-podbrain"'));
    expect(tab).toContain('<strong>guide.md</strong>');
    expect(tab).toContain('docs/&lt;b&gt;guide&lt;/b&gt;.md');
    expect(tab).not.toContain('<b>guide</b>');
    expect(html).toContain('/* Pod Brain */');
  });

  it('renders the unreadable state of the catalog in the tab', () => {
    kb = { ...kb, state: 'unreadable', error: 'index.json is not valid JSON', documents: [] };
    return AnalyticsPanel.currentPanel?.refresh().then(() => {
      expect(panelHtml()).toContain('Catalog unreadable');
    });
  });

  it('podBrainKnowledge runs amadeus-aidlc.knowledge and nothing else', () => {
    send({ command: 'podBrainKnowledge' });
    expect(executed).toEqual([['amadeus-aidlc.knowledge']]);
  });

  it('podBrainKnowledge ignores any argument the page adds', () => {
    send({ command: 'podBrainKnowledge', intentDir: 'x', args: ['--force'], target: 'amadeus-aidlc.setup' });
    expect(executed).toEqual([['amadeus-aidlc.knowledge']]);
  });

  it('never runs a command named by the page', () => {
    send({ command: 'amadeus-aidlc.knowledge' });
    send({ command: 'amadeus-aidlc.setup' });
    send({ command: 'workbench.action.reloadWindow' });
    send({ command: 'executeCommand', id: 'amadeus-aidlc.knowledge' });
    expect(executed).toEqual([]);
  });

  it('the existing messages still refresh the panel without running a command', async () => {
    send({ command: 'refresh' });
    send({ command: 'showOverview' });
    send({ command: 'openIntent', intentDir: 'some-intent' });
    await Promise.resolve();
    expect(executed).toEqual([]);
  });
});
