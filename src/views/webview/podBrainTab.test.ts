import { describe, expect, it } from 'vitest';
import type { ExtractionState, KbDocument, KbHealth } from '../../services/documentKbReader';
import { POD_BRAIN_CSS, escapeHtml, extractionLabel, renderPodBrainTab, sortByNeed } from './podBrainTab';

const REMEDY = 'Run /aidlc knowledge sync (the extracted text predates the current file).';

function doc(over: Partial<KbDocument> = {}): KbDocument {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sourceKind: 'managed',
    sourcePath: 'docs/guide.md',
    displayName: 'guide.md',
    extraction: 'extracted',
    remedy: null,
    scope: 'space',
    intentIds: [],
    tags: [],
    summary: 'absent',
    removed: false,
    indexedAt: '2026-03-04T10:20:30Z',
    ...over,
  };
}

function health(documents: KbDocument[], over: Partial<KbHealth> = {}): KbHealth {
  const active = documents.filter((d) => !d.removed);
  return {
    state: 'ok',
    space: 'default',
    documents,
    active: active.length,
    extracted: active.filter((d) => d.extraction === 'extracted').length,
    extractable: active.length,
    knowledgePct: 50,
    needsRemedy: active.filter((d) => d.remedy !== null).length,
    intentScoped: active.filter((d) => d.scope === 'intent').length,
    spaceWide: active.filter((d) => d.scope === 'space').length,
    summarized: active.filter((d) => d.summary === 'generated').length,
    tombstones: documents.length - active.length,
    ...over,
  };
}

const HOSTILE = `<img src=x onerror="alert('x')">&"'`;
const HOSTILE_ESCAPED = '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&quot;&#39;';

describe('escapeHtml', () => {
  it('escapes & < > " and \'', () => {
    expect(escapeHtml(HOSTILE)).toBe(HOSTILE_ESCAPED);
  });
});

describe('renderPodBrainTab escaping', () => {
  it('escapes every string of a document', () => {
    const html = renderPodBrainTab(health([
      doc({
        displayName: HOSTILE,
        sourcePath: `a/${HOSTILE}`,
        sourceKind: 'linked',
        alias: HOSTILE,
        tags: [HOSTILE],
        remedy: HOSTILE,
        extraction: 'extraction_failed',
        indexedAt: HOSTILE,
      }),
    ], { space: HOSTILE }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain("alert('x')");
    expect(html).toContain(HOSTILE_ESCAPED);
    // linked source: "alias: path"
    expect(html).toContain(`${HOSTILE_ESCAPED}: a/${HOSTILE_ESCAPED}`);
  });

  it('escapes a tombstone name and source', () => {
    const html = renderPodBrainTab(health([
      doc(),
      doc({ id: '22222222-2222-4222-8222-222222222222', displayName: HOSTILE, sourcePath: HOSTILE, removed: true }),
    ]));
    expect(html).not.toContain('<img');
    expect(html).toContain(HOSTILE_ESCAPED);
  });

  it('escapes the error of an unreadable catalog', () => {
    const html = renderPodBrainTab({ ...health([]), state: 'unreadable', error: HOSTILE });
    expect(html).not.toContain('<img');
    expect(html).toContain(HOSTILE_ESCAPED);
  });
});

describe('states', () => {
  it('ok: cards, the table and the hint with the catalog path', () => {
    const html = renderPodBrainTab(health([doc()]));
    expect(html).toContain('class="cards"');
    expect(html).toContain('<table');
    expect(html).toContain('<th>Document</th>');
    expect(html).toContain('Extracted text is never shown here');
    expect(html).toContain('aidlc/spaces/default/knowledge/documentkb/index.json');
    expect(html).toContain('Manage knowledge');
  });

  it('absent: a hint about onboarding, the button, no table', () => {
    const html = renderPodBrainTab({ ...health([]), state: 'absent', knowledgePct: null });
    expect(html).toContain('no document catalog yet');
    expect(html).toContain('/aidlc knowledge onboard');
    expect(html).toContain('data-action="podBrainKnowledge"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('role="alert"');
  });

  it('unreadable: an alert with a text label and the error, the button, no table', () => {
    const html = renderPodBrainTab({ ...health([]), state: 'unreadable', error: 'index.json is not valid JSON' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Catalog unreadable');
    expect(html).toContain('index.json is not valid JSON');
    expect(html).toContain('data-action="podBrainKnowledge"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="cards"');
  });

  it('ok with no active document says so instead of an empty table', () => {
    const html = renderPodBrainTab(health([doc({ removed: true })]));
    expect(html).not.toContain('<table');
    expect(html).toContain('no active document');
    expect(html).toContain('Removed documents');
  });
});

describe('extraction badges', () => {
  const cases: Array<[ExtractionState, string, string]> = [
    ['extracted', 'Extracted', '\u2713'],
    ['no_extractable_text', 'No text layer', '\u25CB'],
    ['extractor_unavailable', 'Extractor missing', '\u26A0'],
    ['extraction_failed', 'Extraction failed', '\u2715'],
    ['unsupported_type', 'Not extractable', '\u2013'],
    ['invalidated', 'Out of date', '\u21BB'],
  ];

  it.each(cases)('%s shows the glyph and the text label', (state, label, glyph) => {
    const html = renderPodBrainTab(health([doc({ extraction: state })]));
    expect(html).toContain(`<span aria-hidden="true">${glyph}</span> ${label}</span>`);
    expect(extractionLabel(state)).toBe(label);
  });

  it('reuses the done colour for extracted and the orange for the remedy states', () => {
    expect(renderPodBrainTab(health([doc()]))).toContain('badge status-done');
    for (const state of ['no_extractable_text', 'extractor_unavailable', 'extraction_failed', 'invalidated'] as const) {
      expect(renderPodBrainTab(health([doc({ extraction: state, remedy: REMEDY })]))).toContain('badge kb-remedy');
    }
    expect(renderPodBrainTab(health([doc({ extraction: 'unsupported_type' })]))).toContain('badge status-other');
  });
});

describe('table content', () => {
  it('shows the remedy or a dash', () => {
    const html = renderPodBrainTab(health([doc({ extraction: 'invalidated', remedy: REMEDY })]));
    expect(html).toContain(`<td>${escapeHtml(REMEDY)}</td>`);
    expect(renderPodBrainTab(health([doc()]))).toContain('<td>-</td>');
  });

  it('shows the scope: space-wide or intent with the count', () => {
    const html = renderPodBrainTab(health([
      doc({ displayName: 'a.md' }),
      doc({ id: '22222222-2222-4222-8222-222222222222', displayName: 'b.md', scope: 'intent', intentIds: ['x', 'y'] }),
    ]));
    expect(html).toContain('<td>Space-wide</td>');
    expect(html).toContain('<td>Intent (2)</td>');
  });

  it('shows the summary state and the indexed date', () => {
    const html = renderPodBrainTab(health([
      doc({ displayName: 'a.md', summary: 'generated' }),
      doc({ id: '22222222-2222-4222-8222-222222222222', displayName: 'b.md', summary: 'invalidated' }),
      doc({ id: '33333333-3333-4333-8333-333333333333', displayName: 'c.md', summary: 'absent' }),
    ]));
    expect(html).toContain('<td>Generated</td>');
    expect(html).toContain('<td>Out of date</td>');
    expect(html).toContain('<td>None</td>');
    expect(html).toContain('>2026-03-04</td>');
  });

  it('truncates tags after 5 with a +n', () => {
    const tags = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    const html = renderPodBrainTab(health([doc({ tags })]));
    expect(html).toContain('>t5<');
    expect(html).not.toContain('>t6<');
    expect(html).toContain('+2');
    const five = renderPodBrainTab(health([doc({ tags: tags.slice(0, 5) })]));
    expect(five).not.toContain('+0');
    expect(five).not.toMatch(/\+\d/);
  });

  it('shows a dash when there is no tag', () => {
    expect(renderPodBrainTab(health([doc()]))).toContain('<td>-</td>');
  });
});

describe('sort order', () => {
  it('lists the documents needing a remedy first, then by name', () => {
    const docs = [
      doc({ id: '1', displayName: 'b-ok.md' }),
      doc({ id: '2', displayName: 'z-bad.md', extraction: 'extraction_failed', remedy: 'Fix or replace the document.' }),
      doc({ id: '3', displayName: 'a-ok.md' }),
      doc({ id: '4', displayName: 'c-bad.md', extraction: 'invalidated', remedy: REMEDY }),
    ];
    expect(sortByNeed(docs).map((d) => d.displayName)).toEqual(['c-bad.md', 'z-bad.md', 'a-ok.md', 'b-ok.md']);
    const html = renderPodBrainTab(health(docs));
    const order = ['c-bad.md', 'z-bad.md', 'a-ok.md', 'b-ok.md'].map((n) => html.indexOf(`<strong>${n}</strong>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('does not mutate its input', () => {
    const docs = [doc({ id: '1', displayName: 'b.md' }), doc({ id: '2', displayName: 'a.md' })];
    sortByNeed(docs);
    expect(docs.map((d) => d.displayName)).toEqual(['b.md', 'a.md']);
  });
});

describe('tombstones', () => {
  const html = renderPodBrainTab(health([
    doc({ displayName: 'live.md' }),
    doc({ id: '22222222-2222-4222-8222-222222222222', displayName: 'gone.md', sourcePath: 'old/gone.md', removed: true }),
  ]));

  it('are listed in their own section with name and source', () => {
    const removed = html.slice(html.indexOf('Removed documents'));
    expect(removed).toContain('gone.md');
    expect(removed).toContain('old/gone.md');
  });

  it('are excluded from the table', () => {
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(table).toContain('live.md');
    expect(table).not.toContain('gone.md');
  });

  it('have no section when there is none', () => {
    expect(renderPodBrainTab(health([doc()]))).not.toContain('Removed documents');
  });
});

describe('cards', () => {
  it('shows the percentage, or a dash when null', () => {
    expect(renderPodBrainTab(health([doc()], { knowledgePct: 67 }))).toContain('<div class="card-value">67%</div>');
    const html = renderPodBrainTab(health([doc()], { knowledgePct: null }));
    expect(html).toContain('<div class="card-value">-</div><div class="card-label">Extracted / extractable documents</div>');
  });

  it('titles the percentage card as extracted / extractable and explains what is excluded', () => {
    const html = renderPodBrainTab(health([doc()], { knowledgePct: 66, extracted: 2, extractable: 3 }));
    expect(html).toContain('<div class="card-value">66%</div><div class="card-label">Extracted / extractable documents</div>');
    expect(html).toContain('title="2 of 3 documents that can be extracted. Documents of an unsupported type (nothing to extract) are not counted.');
    expect(html).toContain('those of an unsupported type, with nothing to extract, are not counted, and it is rounded down');
  });

  it('accents "Need a remedy" only when it is above 0', () => {
    const bad = renderPodBrainTab(health([doc({ extraction: 'invalidated', remedy: REMEDY })]));
    expect(bad).toContain('<div class="card card-active"><div class="card-value">1</div><div class="card-label">Need a remedy');
    const ok = renderPodBrainTab(health([doc()]));
    expect(ok).toContain('<div class="card "><div class="card-value">0</div><div class="card-label">Need a remedy');
  });

  it('shows intent-scoped / space-wide, active and summarized', () => {
    const html = renderPodBrainTab(health([
      doc({ displayName: 'a.md', summary: 'generated' }),
      doc({ id: '22222222-2222-4222-8222-222222222222', displayName: 'b.md', scope: 'intent', intentIds: ['x'] }),
    ]));
    expect(html).toContain('<div class="card-value">1 / 1</div><div class="card-label">Intent-scoped / space-wide');
    expect(html).toContain('<div class="card-value">2</div><div class="card-label">Active documents');
    expect(html).toContain('<div class="card-value">1</div><div class="card-label">Summarized');
  });
});

describe('actions and safety', () => {
  const ALL = [
    renderPodBrainTab(health([doc()])),
    renderPodBrainTab({ ...health([]), state: 'absent' }),
    renderPodBrainTab({ ...health([]), state: 'unreadable', error: 'e' }),
  ];

  it('the only data-action is podBrainKnowledge', () => {
    for (const html of ALL) {
      const actions = [...html.matchAll(/data-action="([^"]*)"/g)].map((m) => m[1]);
      expect(actions.length).toBeGreaterThan(0);
      expect(new Set(actions)).toEqual(new Set(['podBrainKnowledge']));
    }
  });

  it('the action is a labelled <button>, with no inline handler', () => {
    for (const html of ALL) {
      expect(html).toMatch(/<button type="button" class="btn btn-sm" data-action="podBrainKnowledge"[^>]*>Manage knowledge<\/button>/);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it('posts only the fixed message, from a script that embeds no data', () => {
    const script = ALL[0].slice(ALL[0].indexOf('<script>'));
    expect(script).toContain("vscode.postMessage({command:'podBrainKnowledge'})");
    const hostile = renderPodBrainTab(health([doc({ displayName: '</script><script>alert(1)</script>' })]));
    expect(hostile.match(/<script>/g)).toHaveLength(1);
    expect(hostile).not.toContain('</script><script>alert');
  });

  it('every table has headers', () => {
    expect(ALL[0]).toMatch(/<thead><tr><th>/);
  });

  it('the CSS gives the button a visible focus and uses theme variables with fallbacks', () => {
    expect(POD_BRAIN_CSS).toContain(':focus-visible');
    expect(POD_BRAIN_CSS).toContain('var(--vscode-focusBorder,#007fd4)');
    expect(POD_BRAIN_CSS).not.toMatch(/https?:\/\//);
  });

  it('keeps the removed-documents list at full opacity in the theme description colour (contrast)', () => {
    const rule = /\.kb-removed ul\{[^}]*\}/.exec(POD_BRAIN_CSS)?.[0] ?? '';
    expect(rule).toContain('color:var(--vscode-descriptionForeground,#9d9d9d)');
    expect(rule).not.toContain('opacity');
    expect(POD_BRAIN_CSS).not.toMatch(/descriptionForeground,#888\)/);
  });

  it('light-theme overrides use the charts variables, scoped to the light body classes and to the tab', () => {
    const light = POD_BRAIN_CSS.split('\n').filter((l) => l.startsWith('.vscode-light'));
    expect(light).toHaveLength(3);
    for (const line of light) {
      expect(line).toContain('.vscode-high-contrast-light #tc-podbrain');
      expect(line).not.toMatch(/color:#[0-9a-f]{3,6}/i);
    }
    expect(light.join('\n')).toContain('var(--vscode-charts-orange,');
    expect(light.join('\n')).toContain('var(--vscode-charts-green,');
  });
});
