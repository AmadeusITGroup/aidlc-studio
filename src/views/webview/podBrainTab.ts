// Pure render helpers of the "Pod Brain" tab of the Analytics panel: the health of the
// space's AI-DLC DocumentKB catalog. No vscode import: the model comes from
// services/documentKbReader.ts (KbHealth), the panel only places the result in its page.
//
// Every value of KbHealth comes from a committed (untrusted) index.json: it is escaped
// here, whatever the reader validated. Extracted text is never part of the model.
// The tab writes nothing: its one button asks the host to run `amadeus-aidlc.knowledge`.

import type { ExtractionState, KbDocument, KbHealth } from '../../services/documentKbReader';

/** The only message the tab posts to the host (see AnalyticsPanel.handleMessage). */
export const POD_BRAIN_ACTION = 'podBrainKnowledge';

const MAX_TAGS_SHOWN = 5;

/** HTML-escape a value (text and double- or single-quoted attributes). */
export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ExtractionView {
  glyph: string;
  label: string;
  cls: string;
}

// A state is always shown as glyph + text label; the colour only reinforces it.
const EXTRACTION_VIEW: Record<ExtractionState, ExtractionView> = {
  extracted: { glyph: '\u2713', label: 'Extracted', cls: 'status-done' },
  no_extractable_text: { glyph: '\u25CB', label: 'No text layer', cls: 'kb-remedy' },
  extractor_unavailable: { glyph: '\u26A0', label: 'Extractor missing', cls: 'kb-remedy' },
  extraction_failed: { glyph: '\u2715', label: 'Extraction failed', cls: 'kb-remedy' },
  unsupported_type: { glyph: '\u2013', label: 'Not extractable', cls: 'status-other' },
  invalidated: { glyph: '\u21BB', label: 'Out of date', cls: 'kb-remedy' },
};

const SUMMARY_LABEL: Record<KbDocument['summary'], string> = {
  generated: 'Generated',
  invalidated: 'Out of date',
  absent: 'None',
};

/** Label of an extraction state, for tests and tooltips. */
export function extractionLabel(state: ExtractionState): string {
  return EXTRACTION_VIEW[state].label;
}

function byNeed(a: KbDocument, b: KbDocument): number {
  const needA = a.remedy !== null ? 0 : 1;
  const needB = b.remedy !== null ? 0 : 1;
  if (needA !== needB) { return needA - needB; }
  const byName = a.displayName.localeCompare(b.displayName);
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/** Active documents, those needing a remedy first, then by name. Tombstones excluded. */
export function sortByNeed(documents: readonly KbDocument[]): KbDocument[] {
  return documents.filter((d) => !d.removed).sort(byNeed);
}

function card(value: string | number, label: string, cls = '', title = ''): string {
  const tip = title !== '' ? ` title="${escapeHtml(title)}"` : '';
  return `<div class="card ${cls}"${tip}><div class="card-value">${escapeHtml(value)}</div><div class="card-label">${label}</div></div>`;
}

function manageButton(): string {
  return `<button type="button" class="btn btn-sm" data-action="${POD_BRAIN_ACTION}" ` +
    'title="List, onboard and sync the knowledge documents of this space">Manage knowledge</button>';
}

function cards(kb: KbHealth): string {
  const pct = kb.knowledgePct === null ? '-' : `${kb.knowledgePct}%`;
  return '<div class="cards">' +
    card(kb.active, 'Active documents') +
    card(pct, 'Extracted / extractable documents', '',
      `${kb.extracted} of ${kb.extractable} documents that can be extracted. ` +
      'Documents of an unsupported type (nothing to extract) are not counted. Rounded down: 100% means every one is extracted.') +
    card(kb.needsRemedy, 'Need a remedy', kb.needsRemedy > 0 ? 'card-active' : '') +
    card(kb.summarized, 'Summarized') +
    card(`${kb.intentScoped} / ${kb.spaceWide}`, 'Intent-scoped / space-wide') +
    '</div>';
}

function sourceLine(d: KbDocument): string {
  return d.sourceKind === 'linked' && d.alias !== undefined ? `${d.alias}: ${d.sourcePath}` : d.sourcePath;
}

function tagList(tags: readonly string[]): string {
  if (tags.length === 0) { return '-'; }
  const shown = tags.slice(0, MAX_TAGS_SHOWN).map((t) => `<span class="kb-tag">${escapeHtml(t)}</span>`).join('');
  const more = tags.length > MAX_TAGS_SHOWN ? `<span class="sm">+${tags.length - MAX_TAGS_SHOWN}</span>` : '';
  return shown + more;
}

function documentRow(d: KbDocument): string {
  const view = EXTRACTION_VIEW[d.extraction];
  const scope = d.scope === 'intent' ? `Intent (${d.intentIds.length})` : 'Space-wide';
  return '<tr>' +
    `<td><strong>${escapeHtml(d.displayName)}</strong><span class="kb-src">${escapeHtml(sourceLine(d))}</span></td>` +
    `<td><span class="badge ${view.cls}"><span aria-hidden="true">${view.glyph}</span> ${view.label}</span></td>` +
    `<td>${d.remedy !== null ? escapeHtml(d.remedy) : '-'}</td>` +
    `<td>${scope}</td>` +
    `<td>${tagList(d.tags)}</td>` +
    `<td>${SUMMARY_LABEL[d.summary]}</td>` +
    `<td title="${escapeHtml(d.indexedAt)}">${escapeHtml(d.indexedAt.slice(0, 10))}</td>` +
    '</tr>';
}

function documentsSection(kb: KbHealth): string {
  const rows = sortByNeed(kb.documents).map(documentRow).join('');
  const body = rows.length > 0
    ? '<table aria-label="Documents of the catalog"><thead><tr><th>Document</th><th>Extraction</th><th>Remedy</th>' +
      `<th>Scope</th><th>Tags</th><th>Summary</th><th>Indexed</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="hint">The catalog has no active document.</p>';
  return `<div class="section"><div class="kb-head"><h2>Documents</h2>${manageButton()}</div>${body}` +
    `<p class="hint">Extracted text is never shown here. The percentage is extracted documents out of ` +
    `extractable documents: those of an unsupported type, with nothing to extract, are not counted, and it is rounded down. ` +
    `The catalog comes from aidlc/spaces/${escapeHtml(kb.space)}/knowledge/documentkb/index.json.</p></div>`;
}

function removedSection(kb: KbHealth): string {
  const removed = kb.documents.filter((d) => d.removed).sort(byNeed);
  if (removed.length === 0) { return ''; }
  const items = removed
    .map((d) => `<li>${escapeHtml(d.displayName)} <span class="kb-src-inline">${escapeHtml(sourceLine(d))}</span></li>`)
    .join('');
  return `<div class="section kb-removed"><h2>Removed documents</h2><ul>${items}</ul></div>`;
}

function absentSection(): string {
  return '<div class="section"><h2>Pod Brain</h2>' +
    '<p class="hint">This space has no document catalog yet. Documents are indexed with ' +
    '<code>/aidlc knowledge onboard</code>.</p>' +
    `<div class="kb-actions">${manageButton()}</div></div>`;
}

function unreadableSection(kb: KbHealth): string {
  return '<div class="section"><h2>Pod Brain</h2>' +
    '<div class="kb-alert" role="alert"><strong>\u2715 Catalog unreadable</strong>' +
    `<span>${escapeHtml(kb.error ?? 'index.json could not be read')}</span></div>` +
    `<div class="kb-actions">${manageButton()}</div></div>`;
}

// One delegated listener, no data inside: the page never builds a command from data.
// `vscode` is the handle acquired once by the panel's own script.
const SCRIPT =
  `<script>document.addEventListener('click',function(ev){var t=ev.target;` +
  `var b=t&&t.closest?t.closest('[data-action="${POD_BRAIN_ACTION}"]'):null;` +
  `if(b){vscode.postMessage({command:'${POD_BRAIN_ACTION}'});}});</script>`;

/** The content of the Pod Brain tab (the inside of `#tc-podbrain`). */
export function renderPodBrainTab(kb: KbHealth): string {
  let body: string;
  if (kb.state === 'absent') {
    body = absentSection();
  } else if (kb.state === 'unreadable') {
    body = unreadableSection(kb);
  } else {
    body = cards(kb) + documentsSection(kb) + removedSection(kb);
  }
  return body + SCRIPT;
}

/** CSS of the tab; reuses the panel's classes and its --vscode-* variables with dark fallbacks. */
export const POD_BRAIN_CSS = `
/* Pod Brain */
.kb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.kb-head h2{margin-bottom:0}
.kb-actions{margin-top:12px}
#tc-podbrain .btn:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}
.kb-remedy{background:#e67e2222;color:var(--vscode-charts-orange,#e67e22)}
.kb-src{display:block;font-size:11px;font-weight:400;color:var(--vscode-descriptionForeground,#9d9d9d);word-break:break-all}
.kb-src-inline{font-size:11px;color:var(--vscode-descriptionForeground,#9d9d9d);word-break:break-all}
.kb-tag{display:inline-block;background:var(--vscode-editorWidget-background,#333);border:1px solid var(--vscode-editorWidget-border,#444);border-radius:4px;padding:1px 6px;margin:0 4px 2px 0;font-size:10px;color:var(--vscode-descriptionForeground,#999)}
.kb-alert{display:flex;flex-direction:column;gap:4px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-left:3px solid var(--vscode-errorForeground,#f44336);border-radius:6px;padding:12px 16px;font-size:12px;word-break:break-word}
.kb-alert strong{color:var(--vscode-errorForeground,#f44336)}
.kb-removed ul{list-style:none;font-size:11px;display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground,#9d9d9d)}
/* Light themes (VS Code sets these body classes). The charts colours are mid-tones made for graphics: darkened
   30% toward black they reach 4.5:1 as badge text on a light background. */
.vscode-light #tc-podbrain .kb-remedy,.vscode-high-contrast-light #tc-podbrain .kb-remedy{color:color-mix(in srgb,var(--vscode-charts-orange,#e67e22) 70%,#000)}
.vscode-light #tc-podbrain .status-done,.vscode-high-contrast-light #tc-podbrain .status-done{color:color-mix(in srgb,var(--vscode-charts-green,#4caf50) 70%,#000)}
.vscode-light #tc-podbrain .status-other,.vscode-high-contrast-light #tc-podbrain .status-other{color:color-mix(in srgb,var(--vscode-descriptionForeground,#666) 80%,#000)}
`;
