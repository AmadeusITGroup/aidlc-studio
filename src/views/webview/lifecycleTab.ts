import type {
  LifecycleModel,
  LifecycleResult,
  LifecycleStage,
  LifecycleStatus,
  UnitCell,
  UnitCellState,
} from '../../services/lifecycleModel';

/**
 * Render helpers of the Analytics "Lifecycle" tab. Pure: no vscode import, no I/O.
 *
 * The model comes from `LifecycleCollector.collectResult` (framework files, so untrusted text):
 *  - every value goes through `esc`, which also escapes single quotes, and every
 *    attribute is double-quoted;
 *  - the markup has no inline event handler: buttons carry `data-action` / `data-arg`
 *    and one delegated listener posts the message. The page never builds a command
 *    from data: the host re-validates each message against the model
 *    (`lifecycleActionFor`) and runs a fixed `amadeus-aidlc.*` command.
 *
 * The tab writes nothing: its buttons open a file or run the existing commands that
 * copy the answer for the chat.
 */

// --- Messages page -> host ---

export type LifecycleAction =
  | { kind: 'open'; path: string }
  | { kind: 'approve'; stage: string }
  | { kind: 'requestChanges'; stage: string };

/**
 * Validates a webview message against the model and returns the action to run, or
 * null (ignored). Only three commands are accepted, each with a string argument that
 * matches the model: `path` is an artifact of one of its stages, `stage` is a gate.
 */
export function lifecycleActionFor(model: LifecycleModel | null, msg: unknown): LifecycleAction | null {
  if (model === null || typeof msg !== 'object' || msg === null) { return null; }
  const m = msg as Record<string, unknown>;
  if (m.command === 'lifecycleOpen' && typeof m.path === 'string') {
    const path = m.path;
    const known = model.phases.some((p) => p.stages.some((s) => s.artifacts.includes(path)));
    return known ? { kind: 'open', path } : null;
  }
  if ((m.command === 'lifecycleApprove' || m.command === 'lifecycleRequestChanges') && typeof m.stage === 'string') {
    const stage = m.stage;
    if (!model.gates.some((g) => g.slug === stage)) { return null; }
    return { kind: m.command === 'lifecycleApprove' ? 'approve' : 'requestChanges', stage };
  }
  return null;
}

// --- Escaping ---

/** Escapes text for an HTML text node or a double-quoted attribute (single quote included). */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A number the model should hold; anything else prints as 0. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// --- Labels ---

interface StatusInfo { label: string; glyph: string; pill: string; cls: string; badge: string }

const STATUS: Record<LifecycleStatus, StatusInfo> = {
  'completed': { label: 'Completed', glyph: '✓', pill: 'pill-done', cls: 'lc-s-done', badge: 'status-done' },
  'active': { label: 'Active', glyph: '▶', pill: 'pill-active', cls: 'lc-s-active', badge: 'status-active' },
  'awaiting-approval': { label: 'Awaiting approval', glyph: '◆', pill: 'pill-await', cls: 'lc-s-await', badge: 'lc-badge-await' },
  'revised': { label: 'Revising', glyph: '↻', pill: 'pill-revised', cls: 'lc-s-revised', badge: 'lc-badge-revised' },
  'skipped': { label: 'Skipped', glyph: '–', pill: 'pill-skip', cls: 'lc-s-skip', badge: 'status-other' },
  'pending': { label: 'Pending', glyph: '○', pill: 'pill-pending', cls: 'lc-s-pending', badge: 'status-other' },
};

const CELL: Record<UnitCellState, { label: string; glyph: string; cls: string }> = {
  'done': { label: 'Done', glyph: '✓', cls: 'lc-c-done' },
  'in-progress': { label: 'In progress', glyph: '●', cls: 'lc-c-active' },
  'pending': { label: 'Pending', glyph: '○', cls: 'lc-c-pending' },
  'not-applicable': { label: 'N/A', glyph: '–', cls: 'lc-c-na' },
};

function statusInfo(status: LifecycleStatus): StatusInfo {
  return STATUS[status] ?? STATUS.pending;
}

/** `aidlc-architect-agent` -> `architect`, as the Agents tab shows it. */
function agentLabel(agent: string): string {
  return agent.replace('aidlc-', '').replace('-agent', '');
}

/** Deterministic, timezone-free: `2026-01-01 10:05 UTC`. An unparsable value is shown as text. */
function formatTime(iso: string | null): string {
  if (iso === null) { return '–'; }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) { return iso; }
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function stageTitle(stage: LifecycleStage): string {
  return [stage.number, stage.name].filter((p) => p !== '').join(' ');
}

/** Path shown on a button: relative to the intent's record directory when it is under it. */
function shortPath(model: LifecycleModel, path: string): string {
  const prefix = `${model.intentDir}/`;
  return model.intentDir !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

// --- Pieces ---

function card(value: string | number, label: string, cls = ''): string {
  return `<div class="card ${cls}"><div class="card-value">${esc(value)}</div><div class="card-label">${esc(label)}</div></div>`;
}

function detail(label: string, valueHtml: string): string {
  return `<div class="detail"><span class="detail-label">${esc(label)}</span><span class="detail-value lc-detail-value">${valueHtml}</span></div>`;
}

function fileButton(model: LifecycleModel, path: string): string {
  const shown = shortPath(model, path);
  return `<button type="button" class="btn btn-sm lc-file" data-action="open" data-arg="${esc(path)}" title="${esc(path)}" aria-label="${esc(`Open ${shown}`)}">${esc(shown)}</button>`;
}

function kpiCards(model: LifecycleModel): string {
  const { done, total, completed, skipped } = model.totals;
  const pct = total > 0 ? Math.round((num(done) / total) * 100) : 0;
  const current = model.current ? stageTitle(model.current) : '-';
  const sub = num(skipped) > 0 ? ` · ${num(skipped)} skipped` : '';
  const title = `${num(completed)} completed and ${num(skipped)} skipped of ${num(total)} stages. `
    + 'The percentage counts completed and skipped stages, as the framework does; '
    + 'the count beside it, like the Overview tab, is completed stages only.';
  return `<div class="cards">
  <div class="card card-done" title="${esc(title)}"><div class="card-value">${num(completed)}/${num(total)}</div><div class="card-label">${esc(`Progress ${pct}%${sub}`)}</div></div>
  ${card(current, 'Current stage', 'card-active lc-card-text')}
  ${card(model.gates.length, 'Gates waiting', model.gates.length > 0 ? 'card-gen' : '')}
  ${model.units.length > 0 ? card(model.units.length, 'Units') : ''}
</div>`;
}

function nowSection(model: LifecycleModel): string {
  const s = model.current;
  if (!s) {
    return '<div class="section"><h2>Now</h2><p class="hint">No stage is running now.</p></div>';
  }
  const info = statusInfo(s.status);
  const agent = s.leadAgent !== '' ? esc(agentLabel(s.leadAgent)) : '–';
  const sensors = model.hasRuntimeGraph
    ? `${num(s.sensors.passed)} passed · ${num(s.sensors.failed)} failed · ${num(s.sensors.other)} other`
    : '–';
  const files = s.artifacts.length > 0
    ? `<div class="lc-files">${s.artifacts.map((a) => fileButton(model, a)).join('')}</div>`
    : '<p class="hint">No artifacts on disk yet.</p>';
  return `<div class="section"><h2>Now</h2>
<div class="details-grid">
  ${detail('Stage', esc(stageTitle(s)))}
  ${detail('Lead agent', `<span class="lc-agent">${agent}</span>`)}
  ${detail('Status', `<span class="badge ${info.badge}">${info.glyph} ${info.label}</span>`)}
  ${detail('Started', esc(formatTime(s.startedAt)))}
  ${model.revisionCount !== null ? detail('Revisions', esc(model.revisionCount)) : ''}
  ${detail('Sensors', esc(sensors))}
</div>
${files}</div>`;
}

/**
 * `amadeus-aidlc.approveStage` copies a bare `approve` for the Kiro chat: it names no stage, so
 * the chat applies it to the stage the framework is waiting on.
 */
const APPROVE_TITLE = 'Copies "approve" for the Kiro chat. It applies to the stage the framework is waiting on, which may not be this one.';

function gatesSection(model: LifecycleModel): string {
  if (model.gates.length === 0) {
    return '<div class="section"><h2>Gates waiting</h2><p class="hint">No gate is waiting.</p></div>';
  }
  const rows = model.gates.map((g) => {
    const first = g.artifacts[0];
    const open = first !== undefined
      ? `<button type="button" class="btn btn-sm" data-action="open" data-arg="${esc(first)}" title="${esc(first)}" aria-label="${esc(`Open artifact of ${stageTitle(g)}`)}">Open artifact</button>`
      : `<button type="button" class="btn btn-sm" disabled title="This stage has no artifact on disk yet" aria-label="${esc(`Open artifact of ${stageTitle(g)}: none yet`)}">Open artifact</button>`;
    const names = g.artifacts.length > 0
      ? `<span title="${esc(g.artifacts.join('\n'))}">${esc(g.artifacts.map((a) => a.slice(a.lastIndexOf('/') + 1)).join(', '))}</span>`
      : '<span class="dim">None yet</span>';
    return `<tr>
  <td><strong>${esc(stageTitle(g))}</strong></td>
  <td class="lc-artifacts">${names}</td>
  <td class="lc-actions">${open}
    <button type="button" class="btn btn-sm" data-action="approve" data-arg="${esc(g.slug)}" title="${esc(APPROVE_TITLE)}" aria-label="Copy approve for the chat">Copy approve</button>
    <button type="button" class="btn btn-sm" data-action="request-changes" data-arg="${esc(g.slug)}" title="Asks for your feedback and copies it for the chat" aria-label="${esc(`Request changes on ${stageTitle(g)}`)}">Request changes</button></td>
</tr>`;
  }).join('');
  return `<div class="section"><h2>Gates waiting</h2>
<table><thead><tr><th>Stage</th><th>Artifacts</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>
<p class="hint">Approving and requesting changes are answered in the chat: the buttons copy the answer for it. "Copy approve" names no stage: it answers the stage the framework is waiting on.</p></div>`;
}

function stageCard(s: LifecycleStage): string {
  const info = statusInfo(s.status);
  const dim = s.inPlan ? '' : ' dim';
  const title = s.skipReason !== undefined
    ? `${stageTitle(s)} – ${info.label}: ${s.skipReason}`
    : `${stageTitle(s)} – ${info.label}`;
  const tags = [
    s.perUnit ? '<span class="lc-tag">per unit</span>' : '',
    s.inPlan ? '' : '<span class="lc-tag">Not in plan</span>',
  ].join('');
  const reason = s.inPlan && s.skipReason !== undefined
    ? `<div class="lc-reason">${esc(s.skipReason)}</div>`
    : '';
  return `<li class="lc-stage ${info.cls}${dim}" title="${esc(title)}">
  <div class="lc-stage-head">${s.number !== '' ? `<span class="lc-num">${esc(s.number)}</span>` : ''}<span class="lc-name">${esc(s.name)}</span></div>
  <div class="lc-stage-status"><span class="pill ${info.pill}" aria-hidden="true"></span><span>${info.glyph} ${info.label}</span></div>
  ${tags !== '' ? `<div class="lc-tags">${tags}</div>` : ''}${reason}
</li>`;
}

function phasesSection(model: LifecycleModel): string {
  if (model.phases.length === 0) {
    return '<div class="section"><h2>Phases</h2><p class="hint">No stages found in the state file.</p></div>';
  }
  const lanes = model.phases.map((p) => {
    const total = num(p.total);
    const pct = total > 0 ? Math.round((num(p.done) / total) * 100) : 0;
    return `<div class="lc-lane">
  <div class="lc-lane-head"><h3 class="lc-lane-title">${esc(p.name)}</h3><span class="sm">${num(p.done)}/${total} done</span>
    <div class="mini-bar"><div class="mini-fill${total > 0 && num(p.done) === total ? ' fill-green' : ''}" style="width:${pct}%"></div></div></div>
  <ul class="lc-stages">${p.stages.map(stageCard).join('')}</ul>
</div>`;
  }).join('');
  return `<div class="section"><h2>Phases</h2>${lanes}</div>`;
}

function unitsSection(model: LifecycleModel): string {
  const hasUnits = model.units.length > 0;
  if (!hasUnits && model.unitsError === undefined) { return ''; }

  const parts: string[] = [];
  if (model.unitsError !== undefined) {
    parts.push(`<p class="hint">Units unavailable: ${esc(model.unitsError)}</p>`);
  }
  if (hasUnits && model.unitStages.length === 0) {
    parts.push('<p class="hint">Per-unit stages need the installed stage graph (.kiro/tools/data/stage-graph.json).</p>');
  }
  if (hasUnits) {
    const cells = new Map<string, UnitCell>();
    for (const c of model.unitCells) { cells.set(`${c.unit}\u0000${c.stageSlug}`, c); }
    const head = model.unitStages
      .map((st) => `<th scope="col">${esc([st.number, st.name].filter((p) => p !== '').join(' '))}</th>`)
      .join('');
    const rows = model.units.map((u) => {
      const tds = model.unitStages.map((st) => {
        const c = cells.get(`${u.name}\u0000${st.slug}`);
        const info = CELL[c?.state ?? 'not-applicable'] ?? CELL['not-applicable'];
        const files = c !== undefined && c.files.length > 0 ? c.files.join('\n') : 'No files';
        return `<td class="lc-cell ${info.cls}" title="${esc(files)}"><span class="lc-cell-state">${info.glyph} ${info.label}</span> <span class="sm">${num(c?.present)}/${num(c?.expected)}</span></td>`;
      }).join('');
      return `<tr><th scope="row" class="lc-unit">${esc(u.name)}</th><td>${u.kind !== null ? esc(u.kind) : '–'}</td><td>B${num(u.batch)}</td>${tds}</tr>`;
    }).join('');
    parts.push(`<div class="lc-scroll"><table class="lc-matrix"><thead><tr><th scope="col">Unit</th><th scope="col">Kind</th><th scope="col">Batch</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`);
    parts.push('<p class="hint">Cells show the files on disk against the files the stage expects for the unit. The approval gate belongs to the stage.</p>');
  }
  return `<div class="section"><h2>Units</h2>${parts.join('')}</div>`;
}

function notes(model: LifecycleModel): string {
  const out: string[] = [];
  if (!model.hasStageGraph) {
    out.push('<p class="hint">No stage graph is installed: stage numbers and lead agents come from Studio\'s defaults, and stages outside the plan are not listed.</p>');
  }
  if (!model.hasRuntimeGraph) {
    out.push('<p class="hint">Sensors and times appear once the framework compiles runtime-graph.json.</p>');
  }
  return out.join('');
}

// --- Page script (one delegated listener) ---

/**
 * Posts one of three fixed messages for a button's `data-action`. It runs after the panel's
 * own script, which declares `vscode` (acquireVsCodeApi).
 */
export const LIFECYCLE_SCRIPT = `(function(){
document.addEventListener('click',function(ev){
  var t=ev.target;
  var b=t&&t.closest?t.closest('.lc button[data-action]'):null;
  if(!b||b.disabled)return;
  var a=b.getAttribute('data-action'),v=b.getAttribute('data-arg');
  if(typeof v!=='string')return;
  if(a==='open')vscode.postMessage({command:'lifecycleOpen',path:v});
  else if(a==='approve')vscode.postMessage({command:'lifecycleApprove',stage:v});
  else if(a==='request-changes')vscode.postMessage({command:'lifecycleRequestChanges',stage:v});
});
})();`;

// --- Public entry ---

const HINT_NONE = '<div class="lc"><div class="section"><p class="hint">No active intent.</p></div></div>';

/**
 * Content of the `tc-lifecycle` pane, from the collector's result: `none` -> "No active intent.",
 * `unreadable` -> a hint with the (escaped) reason, `ok` -> the tab.
 */
export function renderLifecycleTab(result: LifecycleResult): string {
  if (result.kind === 'none') { return HINT_NONE; }
  if (result.kind === 'unreadable') {
    return `<div class="lc"><div class="section"><p class="hint">Lifecycle unavailable: ${esc(result.reason)}</p></div></div>`;
  }
  const model = result.model;
  const scope = model.scope !== '' ? ` · ${esc(model.scope)}` : '';
  return `<div class="lc">
<p class="lc-intent"><strong>${esc(model.intentLabel)}</strong>${scope}</p>
${kpiCards(model)}
${nowSection(model)}
${gatesSection(model)}
${phasesSection(model)}
${unitsSection(model)}
${notes(model)}
<script>${LIFECYCLE_SCRIPT}</script>
</div>`;
}

// --- CSS (the panel's palette and variables only) ---

export const LIFECYCLE_CSS = `
/* Lifecycle tab */
.lc-intent{font-size:12px;color:var(--vscode-descriptionForeground,#999);margin-bottom:12px}
.lc-intent strong{font-size:14px;color:var(--vscode-foreground,#eee)}
.lc-card-text .card-value{font-size:15px;line-height:1.3;overflow-wrap:anywhere}
.lc-detail-value{overflow-wrap:anywhere}
.lc-agent{text-transform:capitalize}
.lc-badge-await{background:#3794ff22;color:var(--vscode-charts-blue,#3794ff)}.lc-badge-revised{background:#e67e2222;color:var(--vscode-charts-orange,#e67e22)}
.lc .status-active{color:var(--vscode-charts-yellow,#dca63a)}.lc .status-done{color:var(--vscode-charts-green,#4caf50)}
.lc-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.lc .btn:disabled{opacity:.5;cursor:not-allowed}
.lc .btn:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}
.lc .lc-file{background:transparent;color:var(--vscode-textLink-foreground,#3794ff);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.lc .lc-file:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}
.lc-actions{display:flex;flex-wrap:wrap;gap:6px}
.lc-artifacts{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground,#999)}
.lc-lane{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.lc-lane-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.lc-lane-title{font-size:13px;font-weight:600;color:var(--vscode-foreground,#eee)}
.lc-stages{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.lc-stage{background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-left:3px solid #666;border-radius:6px;padding:8px 10px;font-size:12px;min-width:0}
.lc-s-done{border-left-color:#4caf50}.lc-s-active{border-left-color:#dca63a}.lc-s-await{border-left-color:#3794ff}.lc-s-revised{border-left-color:#e67e22}.lc-s-skip{border-left-color:#666}.lc-s-pending{border-left-color:#555}
.lc-stage-head{display:flex;gap:6px;align-items:baseline;margin-bottom:4px}
.lc-num{font-size:11px;font-weight:700;color:var(--vscode-descriptionForeground,#888);flex-shrink:0}
.lc-name{font-weight:600;color:var(--vscode-foreground,#ddd);overflow-wrap:anywhere}
.lc-stage-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground,#999)}
.lc-stage .pill{width:10px;height:10px;flex-shrink:0}
.lc-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.lc-tag{font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid var(--vscode-editorWidget-border,#444);color:var(--vscode-descriptionForeground,#999)}
.lc-reason{font-size:10px;margin-top:4px;color:var(--vscode-descriptionForeground,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-scroll{overflow-x:auto}
.lc-matrix th[scope=row]{text-transform:none;letter-spacing:0;font-size:12px;color:var(--vscode-foreground,#ddd)}
.lc-cell{white-space:nowrap}
.lc-cell-state{font-weight:600}
.lc-c-done .lc-cell-state{color:var(--vscode-charts-green,#4caf50)}.lc-c-active .lc-cell-state{color:var(--vscode-charts-yellow,#dca63a)}.lc-c-pending .lc-cell-state,.lc-c-na .lc-cell-state{color:var(--vscode-descriptionForeground,#888)}
/* Light themes: VS Code sets vscode-light / vscode-high-contrast-light on the body. The gold, blue, orange and green states
   are darkened (a plain colour first, then color-mix for engines that have it) so the text keeps its contrast on white. */
.vscode-light .lc .status-active,.vscode-high-contrast-light .lc .status-active,.vscode-light .lc-c-active .lc-cell-state,.vscode-high-contrast-light .lc-c-active .lc-cell-state{color:var(--vscode-charts-yellow,#946b00);color:color-mix(in srgb,var(--vscode-charts-yellow,#946b00) 60%,#000)}
.vscode-light .lc .status-done,.vscode-high-contrast-light .lc .status-done,.vscode-light .lc-c-done .lc-cell-state,.vscode-high-contrast-light .lc-c-done .lc-cell-state{color:var(--vscode-charts-green,#2e7d32);color:color-mix(in srgb,var(--vscode-charts-green,#2e7d32) 65%,#000)}
.vscode-light .lc-badge-await,.vscode-high-contrast-light .lc-badge-await{color:var(--vscode-charts-blue,#0b5cad);color:color-mix(in srgb,var(--vscode-charts-blue,#0b5cad) 65%,#000)}
.vscode-light .lc-badge-revised,.vscode-high-contrast-light .lc-badge-revised{color:var(--vscode-charts-orange,#b35a00);color:color-mix(in srgb,var(--vscode-charts-orange,#b35a00) 60%,#000)}
`;
