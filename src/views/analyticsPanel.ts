import * as vscode from 'vscode';
import { AnalyticsCollector, GlobalAnalytics, IntentAnalytics } from '../services/analyticsCollector';
import { GraphDataCollector, GraphData } from '../services/graphDataCollector';

export class AnalyticsPanel {
  public static currentPanel: AnalyticsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly collector: AnalyticsCollector;
  private readonly graphCollector: GraphDataCollector;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.collector = new AnalyticsCollector();
    this.graphCollector = new GraphDataCollector();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );
  }

  static async show(intentFilter?: string): Promise<void> {
    const column = vscode.ViewColumn.One;
    if (AnalyticsPanel.currentPanel) {
      AnalyticsPanel.currentPanel.panel.reveal(column);
      await AnalyticsPanel.currentPanel.refresh(intentFilter);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'amadeus-aidlc.analytics', 'AIDLC Analytics', column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    AnalyticsPanel.currentPanel = new AnalyticsPanel(panel);
    await AnalyticsPanel.currentPanel.refresh(intentFilter);
  }

  async refresh(intentFilter?: string): Promise<void> {
    const wf = vscode.workspace.workspaceFolders?.[0];
    if (!wf) { this.panel.webview.html = '<body style="padding:24px;color:#ccc">No workspace open.</body>'; return; }
    try {
      const analytics = await this.collector.collectGlobal(wf.uri);
      const graphData = await this.graphCollector.collect(wf.uri);
      this.panel.webview.html = this.buildPage(analytics, graphData, intentFilter);
    } catch (e) {
      this.panel.webview.html = `<body style="padding:24px;color:#ccc">Error: ${e instanceof Error ? e.message : e}</body>`;
    }
  }

  private handleMessage(msg: { command: string; intentDir?: string; tab?: string }): void {
    if (msg.command === 'openIntent' && msg.intentDir) { this.refresh(msg.intentDir); }
    else if (msg.command === 'showOverview') { this.refresh(); }
    else if (msg.command === 'refresh') { this.refresh(); }
  }

  private dispose(): void {
    AnalyticsPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  // ──────────────────── Page Builder ────────────────────

  private buildPage(data: GlobalAnalytics, graphData: GraphData | null, intentFilter?: string): string {
    const intent = intentFilter ? data.intents.find((i) => i.dirName === intentFilter) : null;
    const overviewHtml = intent ? this.intentDetailContent(intent) : this.overviewContent(data);
    const graphJson = graphData ? JSON.stringify(graphData) : 'null';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>${this.css()}</style></head><body>
<script>const vscode=acquireVsCodeApi();const GRAPH_DATA=${graphJson};
function showTopTab(id){
  document.querySelectorAll('.top-tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.top-content').forEach(function(t){t.classList.remove('active')});
  document.getElementById('tt-'+id).classList.add('active');
  document.getElementById('tc-'+id).classList.add('active');
  if(id==='graph'&&GRAPH_DATA){setTimeout(function(){initGraph(GRAPH_DATA)},100);}
}</script>

<div class="header">
  <h1>AIDLC Analytics</h1>
  <button class="btn" onclick="vscode.postMessage({command:'refresh'})">Refresh</button>
</div>

<div class="top-tabs">
  <div class="top-tab active" id="tt-overview" onclick="showTopTab('overview')">
    ${intent ? '← Overview' : 'Overview'}
  </div>
  <div class="top-tab" id="tt-graph" onclick="showTopTab('graph')">Dependency Graph</div>
  <div class="top-tab" id="tt-timeline" onclick="showTopTab('timeline')">Timeline</div>
  <div class="top-tab" id="tt-agents" onclick="showTopTab('agents')">Agents</div>
</div>

<div class="top-content active" id="tc-overview">${overviewHtml}</div>
<div class="top-content" id="tc-graph">
  <div id="graph-container">
    <div class="graph-toolbar">
      <span class="graph-legend">
        <span class="gl"><span class="dot dot-done"></span>Done</span>
        <span class="gl"><span class="dot dot-active"></span>Active</span>
        <span class="gl"><span class="dot dot-await"></span>Awaiting</span>
        <span class="gl"><span class="dot dot-pending"></span>Pending</span>
        <span class="gl"><span class="dot dot-skip"></span>Skipped</span>
      </span>
      <div class="btn-group">
        <button class="btn btn-sm" onclick="fitGraph()">Fit</button>
        <button class="btn btn-sm" onclick="resetGraph()">Reset</button>
      </div>
    </div>
    <svg id="graph-svg" width="100%" height="600"></svg>
  </div>
  <div id="graph-tooltip" class="graph-tip"></div>
</div>
<div class="top-content" id="tc-timeline">${this.timelineContent(graphData)}</div>
<div class="top-content" id="tc-agents">${this.agentContent(graphData)}</div>

<script>${this.graphScript()}</script>
</body></html>`;
  }

  // ──────────────────── Overview Tab ────────────────────

  private overviewContent(data: GlobalAnalytics): string {
    const scopeBars = Object.entries(data.scopeDistribution)
      .map(([s, c]) => { const p = data.totalIntents > 0 ? Math.round((c / data.totalIntents) * 100) : 0; return `<div class="bar-row"><span class="bar-label">${this.e(s)}</span><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div><span class="bar-value">${c}</span></div>`; }).join('');

    const rows = data.intents.map((i) => {
      const sc = i.status === 'in-flight' ? 'status-active' : i.status === 'completed' ? 'status-done' : 'status-other';
      return `<tr class="intent-row" onclick="vscode.postMessage({command:'openIntent',intentDir:'${this.e(i.dirName)}'})">
        <td><strong>${this.e(i.slug)}</strong></td><td><span class="badge ${sc}">${this.e(i.status)}</span></td><td>${this.e(i.scope)}</td>
        <td><div class="mini-bar"><div class="mini-fill" style="width:${i.progressPercent}%"></div></div><span class="sm">${i.progressPercent}%</span></td>
        <td>${i.stagesCompleted}/${i.stagesTotal}</td><td>${i.totalArtifacts}</td><td>${i.currentStage?this.e(i.currentStage):'—'}</td></tr>`;
    }).join('');

    return `
<div class="cards">
  ${this.card(data.totalIntents, 'Total Intents')} ${this.card(data.activeIntents, 'Active', 'card-active')}
  ${this.card(data.completedIntents, 'Completed', 'card-done')} ${this.card(`${data.totalCompletedAcrossAll}/${data.totalStagesAcrossAll}`, 'Stages Done')}
  ${this.card(data.totalArtifactsAcrossAll, 'Artifacts')}
</div>
<div class="section"><h2>Scope Distribution</h2><div class="chart">${scopeBars}</div></div>
<div class="section"><h2>Intents</h2>
<table><thead><tr><th>Intent</th><th>Status</th><th>Scope</th><th>Progress</th><th>Stages</th><th>Artifacts</th><th>Current</th></tr></thead><tbody>${rows}</tbody></table>
<p class="hint">Click a row for details.</p></div>`;
  }

  // ──────────────────── Intent Detail ────────────────────

  private intentDetailContent(i: IntentAnalytics): string {
    const fmt = (m: number | null) => { if (m === null) return '—'; if (m < 1) return '<1m'; if (m < 60) return `${m}m`; const h = Math.floor(m / 60), r = Math.round(m % 60); return r > 0 ? `${h}h ${r}m` : `${h}h`; };

    const phaseRows = i.phases.map((p) => {
      const pct = p.total > 0 ? Math.round(((p.completed + p.skipped) / p.total) * 100) : 0;
      const ic = p.done ? '✓' : p.active > 0 ? '▶' : '○';
      return `<tr><td>${ic} Phase ${p.id}: ${this.e(p.name)}</td><td><div class="mini-bar"><div class="mini-fill ${p.done ? 'fill-green' : ''}" style="width:${pct}%"></div></div></td>
        <td>${p.completed}</td><td>${p.skipped}</td><td>${p.active}</td><td>${p.awaiting}</td><td>${p.revised}</td><td>${p.pending}</td></tr>`;
    }).join('');

    const pills = i.phases.flatMap((p) => [
      ...Array(p.completed).fill('<span class="pill pill-done"></span>'),
      ...Array(p.skipped).fill('<span class="pill pill-skip"></span>'),
      ...Array(p.active).fill('<span class="pill pill-active"></span>'),
      ...Array(p.awaiting).fill('<span class="pill pill-await"></span>'),
      ...Array(p.revised).fill('<span class="pill pill-revised"></span>'),
      ...Array(p.pending).fill('<span class="pill pill-pending"></span>'),
    ]).join('');

    const timingRows = i.stageTimings.length > 0 ? i.stageTimings.map((s) =>
      `<tr class="${s.completedAt ? '' : 'dim'}"><td>${this.e(s.name)}</td><td>${s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : '—'}</td><td>${s.completedAt ? new Date(s.completedAt).toLocaleTimeString() : '—'}</td><td><strong>${fmt(s.durationMinutes)}</strong></td></tr>`
    ).join('') : '<tr><td colspan="4" class="dim">No timing data</td></tr>';

    return `
<button class="btn btn-back" onclick="vscode.postMessage({command:'showOverview'})">← All Intents</button>
<h2 style="margin-top:8px">${this.e(i.projectName)}</h2>
<div class="cards">
  ${this.card(i.scope, 'Scope')} ${this.card(i.status, 'Status', i.status === 'in-flight' ? 'card-active' : 'card-done')}
  ${this.card(`${i.progressPercent}%`, 'Progress')} ${this.card(`${i.stagesCompleted}/${i.stagesTotal}`, 'Stages')}
  ${this.card(i.totalArtifacts, 'Artifacts')}
  ${this.card(fmt(i.totalElapsedMinutes), 'Total Time', 'card-time')}
  ${this.card(fmt(i.generationMinutes), 'AIDLC Gen', 'card-gen')}
  ${this.card(fmt(i.waitMinutes), 'Human/Wait')}
</div>
<div class="section"><h2>Progress</h2><div class="big-bar"><div class="big-fill" style="width:${i.progressPercent}%"></div><span class="big-label">${i.progressPercent}%</span></div></div>
<div class="section"><h2>Pipeline</h2><div class="pipeline">${pills}</div>
<div class="legend"><span class="gl"><span class="pill pill-done"></span>Done</span><span class="gl"><span class="pill pill-skip"></span>Skip</span><span class="gl"><span class="pill pill-active"></span>Active</span><span class="gl"><span class="pill pill-await"></span>Await</span><span class="gl"><span class="pill pill-revised"></span>Revise</span><span class="gl"><span class="pill pill-pending"></span>Pending</span></div></div>
<div class="section"><h2>Phases</h2><table><thead><tr><th>Phase</th><th>Progress</th><th>Done</th><th>Skip</th><th>Act</th><th>Await</th><th>Rev</th><th>Pend</th></tr></thead><tbody>${phaseRows}</tbody></table></div>
<div class="section"><h2>Details</h2><div class="details-grid">
  ${this.detail('Phase', i.currentPhase ?? '—')} ${this.detail('Stage', i.currentStage ?? '—')} ${this.detail('Started', i.startDate ?? '—')}
  ${this.detail('Updated', i.lastUpdated ?? '—')} ${this.detail('Revisions', i.stagesRevised)} ${this.detail('Skipped', i.stagesSkipped)}
</div></div>
<div class="section"><h2>Stage Timing</h2><table><thead><tr><th>Stage</th><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>${timingRows}</tbody></table></div>`;
  }

  // ──────────────────── Timeline Tab ────────────────────

  private timelineContent(graphData: GraphData | null): string {
    if (!graphData || graphData.nodes.length === 0) {
      return '<div class="section"><p class="hint">No runtime data available yet. Run a workflow to see the timeline.</p></div>';
    }

    const stages = graphData.nodes.filter((n) => n.startedAt).sort(
      (a, b) => new Date(a.startedAt!).getTime() - new Date(b.startedAt!).getTime()
    );
    if (stages.length === 0) {
      return '<div class="section"><p class="hint">No stages have started yet.</p></div>';
    }

    const agentColors: Record<string, string> = {
      'orchestrator': '#666', 'aidlc-product-agent': '#3794ff',
      'aidlc-architect-agent': '#9c27b0', 'aidlc-developer-agent': '#4caf50',
      'aidlc-delivery-agent': '#ff9800', 'aidlc-design-agent': '#e91e63',
      'aidlc-qa-agent': '#00bcd4', 'aidlc-devops-agent': '#795548',
      'aidlc-security-agent': '#f44336', 'aidlc-pipeline-deploy-agent': '#795548',
    };

    const allTimes: number[] = [];
    stages.forEach((s) => {
      allTimes.push(new Date(s.startedAt!).getTime());
      if (s.completedAt) { allTimes.push(new Date(s.completedAt).getTime()); }
    });
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const rangeMs = Math.max(maxTime - minTime, 60000);

    const fmt = (m: number | null): string => {
      if (m === null || m === 0) return '< 1s';
      if (m < 1) return '< 1m';
      if (m < 60) return Math.round(m) + 'm';
      const h = Math.floor(m / 60);
      const r = Math.round(m % 60);
      return r > 0 ? h + 'h ' + r + 'm' : h + 'h';
    };

    const fmtTime = (iso: string): string => {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Build time markers
    const totalMin = rangeMs / 60000;
    const intervalMs = totalMin < 60 ? 600000 : totalMin < 180 ? 1800000 : 3600000;
    const firstMark = Math.ceil(minTime / intervalMs) * intervalMs;
    let markersHtml = '';
    for (let t = firstMark; t <= maxTime + intervalMs; t += intervalMs) {
      const pct = ((t - minTime) / rangeMs) * 100;
      if (pct >= 0 && pct <= 100) {
        markersHtml += '<div class="tl-marker" style="left:' + pct + '%"><span>' + fmtTime(new Date(t).toISOString()) + '</span></div>';
      }
    }

    // Build stage rows
    let rowsHtml = '';
    stages.forEach((s, i) => {
      const startMs = new Date(s.startedAt!).getTime();
      const endMs = s.completedAt ? new Date(s.completedAt).getTime() : maxTime;
      const leftPct = ((startMs - minTime) / rangeMs) * 100;
      const widthPct = Math.max(((endMs - startMs) / rangeMs) * 100, 0.5);
      const color = agentColors[s.agent] || '#3794ff';
      const isRunning = !s.completedAt;
      const agentLabel = s.agent.replace('aidlc-', '').replace('-agent', '');
      const durLabel = fmt(s.durationMinutes);
      const barClass = isRunning ? 'tl-bar tl-bar-running' : 'tl-bar';
      const evenOdd = i % 2 === 0 ? 'tl-row-even' : '';

      rowsHtml += '<div class="tl-row ' + evenOdd + '">'
        + '<div class="tl-label">'
        + '<span class="tl-num">' + this.e(s.number) + '</span>'
        + '<span class="tl-name">' + this.e(s.name) + '</span>'
        + '<span class="tl-agent" style="color:' + color + '">' + this.e(agentLabel) + '</span>'
        + '</div>'
        + '<div class="tl-track">'
        + '<div class="' + barClass + '" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + color + '">'
        + '<span class="tl-bar-label">' + durLabel + '</span>'
        + '</div>'
        + '</div>'
        + '<div class="tl-meta">'
        + '<span class="tl-time">' + fmtTime(s.startedAt!) + '</span>'
        + '</div>'
        + '</div>';
    });

    // Legend
    const agents = [...new Set(stages.map((s) => s.agent))];
    const legendHtml = agents.map((a) => {
      const c = agentColors[a] || '#3794ff';
      const label = a.replace('aidlc-', '').replace('-agent', '');
      return '<span class="gl"><span class="dot" style="background:' + c + '"></span>' + this.e(label) + '</span>';
    }).join('');

    // Summary stats
    const totalElapsed = fmt(rangeMs / 60000);
    const completedCount = stages.filter((s) => s.completedAt).length;
    const runningCount = stages.filter((s) => !s.completedAt).length;

    return '<div class="section"><h2>Workflow Timeline</h2>'
      + '<div class="tl-summary">'
      + '<span>Total elapsed: <strong>' + totalElapsed + '</strong></span>'
      + '<span>' + completedCount + ' completed</span>'
      + (runningCount > 0 ? '<span>' + runningCount + ' running</span>' : '')
      + '</div>'
      + '<div class="graph-legend" style="margin-bottom:14px">' + legendHtml + '</div>'
      + '</div>'
      + '<div class="tl-container">'
      + '<div class="tl-header"><div class="tl-label tl-label-header">Stage</div><div class="tl-track"><div class="tl-markers">' + markersHtml + '</div></div><div class="tl-meta tl-meta-header">Info</div></div>'
      + rowsHtml
      + '</div>'
      + '<p class="hint" style="margin-top:10px">Bar width shows actual duration. Dashed bars are still running. Gaps between bars represent human review or idle time.</p>';
  }

  // ──────────────────── Agents Tab ────────────────────

  private agentContent(graphData: GraphData | null): string {
    if (!graphData || graphData.nodes.length === 0) {
      return '<div class="section"><p class="hint">No runtime data available.</p></div>';
    }

    const AGENT_COLORS: Record<string, string> = {
      'orchestrator': '#666',
      'aidlc-product-agent': '#3794ff',
      'aidlc-architect-agent': '#9c27b0',
      'aidlc-developer-agent': '#4caf50',
      'aidlc-delivery-agent': '#ff9800',
      'aidlc-design-agent': '#e91e63',
      'aidlc-qa-agent': '#00bcd4',
      'aidlc-devops-agent': '#795548',
      'aidlc-security-agent': '#f44336',
    };

    // Aggregate per agent
    const agentMap = new Map<string, { stages: string[]; totalMinutes: number; sensors: number; completed: number }>();
    graphData.nodes.forEach((n) => {
      const a = n.agent;
      if (!agentMap.has(a)) { agentMap.set(a, { stages: [], totalMinutes: 0, sensors: 0, completed: 0 }); }
      const entry = agentMap.get(a)!;
      entry.stages.push(`${n.number} ${n.name}`);
      if (n.durationMinutes) { entry.totalMinutes += n.durationMinutes; }
      entry.sensors += n.sensorsPassed + n.sensorsFailed;
      if (n.status === 'completed') { entry.completed++; }
    });

    const maxMinutes = Math.max(...[...agentMap.values()].map((v) => v.totalMinutes), 1);

    // Build handoff sequence (agent transitions)
    const handoffs: Array<{ from: string; to: string }> = [];
    const sorted = graphData.nodes.filter((n) => n.startedAt).sort((a, b) =>
      new Date(a.startedAt!).getTime() - new Date(b.startedAt!).getTime()
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].agent !== sorted[i - 1].agent) {
        handoffs.push({ from: sorted[i - 1].agent, to: sorted[i].agent });
      }
    }

    // Agent cards
    const fmt = (m: number) => { if (m < 1) return '<1m'; if (m < 60) return `${Math.round(m)}m`; const h = Math.floor(m / 60); const r = Math.round(m % 60); return r > 0 ? `${h}h ${r}m` : `${h}h`; };

    const agentCards = [...agentMap.entries()].sort((a, b) => b[1].totalMinutes - a[1].totalMinutes)
      .map(([agent, data]) => {
        const c = AGENT_COLORS[agent] ?? '#3794ff';
        const label = agent.replace('aidlc-', '').replace('-agent', '');
        const pct = Math.round((data.totalMinutes / maxMinutes) * 100);
        const stagePills = data.stages.map((s) => '<span class="agent-stage-pill">' + this.e(s) + '</span>').join('');
        return '<div class="agent-card">'
          + '<div class="agent-header"><span class="dot" style="background:' + c + '"></span><strong>' + this.e(label) + '</strong><span class="agent-time">' + fmt(data.totalMinutes) + '</span></div>'
          + '<div class="agent-bar-track"><div class="agent-bar-fill" style="width:' + pct + '%;background:' + c + '"></div></div>'
          + '<div class="agent-meta"><span>' + data.stages.length + ' stages</span><span>' + data.completed + ' completed</span><span>' + data.sensors + ' sensor checks</span></div>'
          + '<div class="agent-stages">' + stagePills + '</div>'
          + '</div>';
      }).join('');

    // Agent sequence (which agent ran after which, in execution order)
    const handoffHtml = handoffs.length > 0 ? handoffs.map((h) => {
      const fc = AGENT_COLORS[h.from] ?? '#666';
      const tc = AGENT_COLORS[h.to] ?? '#666';
      const fl = h.from.replace('aidlc-', '').replace('-agent', '');
      const tl = h.to.replace('aidlc-', '').replace('-agent', '');
      return '<span class="handoff"><span class="dot" style="background:' + fc + '"></span>' + this.e(fl) + ' <span class="handoff-arrow">\u2192</span> <span class="dot" style="background:' + tc + '"></span>' + this.e(tl) + '</span>';
    }).join('') : '<span class="hint">No agent transitions yet</span>';

    return `
<div class="section">
  <h2>Agent Activity</h2>
  <div class="agent-grid">${agentCards}</div>
</div>
<div class="section">
  <h2>Agent Sequence</h2>
  <p class="hint" style="margin-bottom:8px">Shows each time a different agent took over the workflow, in execution order.</p>
  <div class="handoff-chain">${handoffHtml}</div>
</div>`;
  }

  // ──────────────────── Graph Script ────────────────────

  private graphScript(): string {
    // Vanilla JS force-directed layout — no external dependencies
    return `
let nodes=[],edges=[],svgEl=null,w=0,h=0,dragging=null,animId=null;

const PHASE_COLORS={initialization:'#666',ideation:'#3794ff',inception:'#9c27b0',construction:'#4caf50',operation:'#ff9800'};
const STATUS_COLORS={completed:'#4caf50',active:'#dca63a','awaiting-approval':'#3794ff',revised:'#e67e22',skipped:'#555',pending:'#393939'};
const PHASE_Y={initialization:0,ideation:1,inception:2,construction:3,operation:4};
const PHASE_LABELS={initialization:'INITIALIZATION',ideation:'IDEATION',inception:'INCEPTION',construction:'CONSTRUCTION',operation:'OPERATION'};

function initGraph(data){
  if(!data||!data.nodes.length)return;
  if(animId){cancelAnimationFrame(animId);animId=null;}

  svgEl=document.getElementById('graph-svg');
  var rect=svgEl.parentElement.getBoundingClientRect();
  w=Math.max(rect.width||900,900);
  // Height based on number of phases present
  var phaseCount=data.phases?data.phases.length:5;
  h=Math.max(phaseCount*160+80,600);
  svgEl.setAttribute('viewBox','0 0 '+w+' '+h);
  svgEl.style.height=h+'px';

  // Group by phase and spread horizontally with generous spacing
  var byPhase={};
  data.nodes.forEach(function(n){if(!byPhase[n.phase])byPhase[n.phase]=[];byPhase[n.phase].push(n);});

  nodes=data.nodes.map(function(n){
    var pi=PHASE_Y[n.phase]!=null?PHASE_Y[n.phase]:0;
    var siblings=byPhase[n.phase]||[];
    var idx=siblings.indexOf(n);
    var count=siblings.length;
    // Wide horizontal spread per phase
    var margin=80;
    var avail=w-margin*2;
    var gap=count>1?avail/(count-1):0;
    var x=count===1?w/2:margin+idx*gap;
    var y=70+pi*150;
    return{slug:n.slug,number:n.number,name:n.name,phase:n.phase,agent:n.agent,status:n.status,
      durationMinutes:n.durationMinutes,sensorsPassed:n.sensorsPassed,sensorsFailed:n.sensorsFailed,
      outcome:n.outcome,x:x,y:y,vx:0,vy:0,pinned:false};
  });

  edges=data.edges.map(function(e){
    return{from:e.from,to:e.to,source:nodes.find(function(n){return n.slug===e.from}),
      target:nodes.find(function(n){return n.slug===e.to})};
  }).filter(function(e){return e.source&&e.target});

  // Run a gentle simulation to untangle overlaps
  simulate(0.8);
  setupHover();
}

function simulate(startAlpha){
  var alpha=startAlpha||0.5;
  var REPULSION=3500;   // Strong push apart
  var LINK_DIST=160;    // Long links
  var LINK_STR=0.08;    // Weak pull (don't collapse)
  var GRAVITY=0.005;    // Very gentle centering
  var PHASE_STR=0.06;   // Phase lane pull
  var DAMPING=0.85;     // High damping = slow, smooth movement
  var DECAY=0.015;      // Slow cooldown

  function tick(){
    alpha*=(1-DECAY);
    if(alpha<0.0005){render();return;}

    // Repulsion (Coulomb)
    for(var i=0;i<nodes.length;i++){
      if(nodes[i].pinned)continue;
      for(var j=i+1;j<nodes.length;j++){
        if(nodes[j].pinned)continue;
        var dx=nodes[j].x-nodes[i].x;var dy=nodes[j].y-nodes[i].y;
        var d2=dx*dx+dy*dy;if(d2<1)d2=1;
        var d=Math.sqrt(d2);
        var f=REPULSION/d2*alpha;
        var fx=dx/d*f;var fy=dy/d*f;
        nodes[i].vx-=fx;nodes[i].vy-=fy;
        nodes[j].vx+=fx;nodes[j].vy+=fy;
      }
    }
    // Link spring
    edges.forEach(function(e){
      if(!e.source||!e.target)return;
      var dx=e.target.x-e.source.x;var dy=e.target.y-e.source.y;
      var d=Math.sqrt(dx*dx+dy*dy)||1;
      var f=(d-LINK_DIST)*LINK_STR*alpha;
      var fx=dx/d*f;var fy=dy/d*f;
      if(!e.source.pinned){e.source.vx+=fx;e.source.vy+=fy;}
      if(!e.target.pinned){e.target.vx-=fx;e.target.vy-=fy;}
    });
    // Gravity
    nodes.forEach(function(n){
      if(n.pinned)return;
      n.vx+=(w/2-n.x)*GRAVITY*alpha;
      n.vy+=(h/2-n.y)*GRAVITY*alpha;
    });
    // Phase Y lane (gentle)
    nodes.forEach(function(n){
      if(n.pinned)return;
      var ty=70+(PHASE_Y[n.phase]!=null?PHASE_Y[n.phase]:0)*150;
      n.vy+=(ty-n.y)*PHASE_STR*alpha;
    });
    // Apply velocity with strong damping
    nodes.forEach(function(n){
      if(n.pinned){n.vx=0;n.vy=0;return;}
      n.vx*=DAMPING;n.vy*=DAMPING;
      n.x+=n.vx;n.y+=n.vy;
      n.x=Math.max(50,Math.min(w-50,n.x));
      n.y=Math.max(40,Math.min(h-40,n.y));
    });
    // Collision resolution — enforce minimum distance between all node pairs
    var MIN_DIST=65;
    for(var ci=0;ci<3;ci++){  // Multiple passes for dense clusters
      for(var i=0;i<nodes.length;i++){
        for(var j=i+1;j<nodes.length;j++){
          var ni=nodes[i],nj=nodes[j];
          var cdx=nj.x-ni.x,cdy=nj.y-ni.y;
          var cd=Math.sqrt(cdx*cdx+cdy*cdy);
          if(cd<MIN_DIST&&cd>0.1){
            var overlap=(MIN_DIST-cd)/2;
            var ox=cdx/cd*overlap;var oy=cdy/cd*overlap;
            if(!ni.pinned){ni.x-=ox;ni.y-=oy;}
            if(!nj.pinned){nj.x+=ox;nj.y+=oy;}
          }else if(cd<0.1){
            // Nodes on top of each other — nudge randomly
            if(!ni.pinned){ni.x+=Math.random()*20-10;ni.y+=Math.random()*20-10;}
            if(!nj.pinned){nj.x+=Math.random()*20-10;nj.y+=Math.random()*20-10;}
          }
        }
      }
    }
    // Re-clamp after collision
    nodes.forEach(function(n){
      if(n.pinned)return;
      n.x=Math.max(50,Math.min(w-50,n.x));
      n.y=Math.max(40,Math.min(h-40,n.y));
    });
    render();
    animId=requestAnimationFrame(tick);
  }
  animId=requestAnimationFrame(tick);
}

function render(){
  if(!svgEl)return;
  var svg='<defs><marker id="arr" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="7" markerHeight="5" orient="auto"><path d="M0,0 L10,3 L0,6Z" fill="#555"/></marker></defs>';

  // Phase lane labels (faint background)
  var seenPhases={};
  nodes.forEach(function(n){
    if(seenPhases[n.phase])return;seenPhases[n.phase]=true;
    var py=70+(PHASE_Y[n.phase]!=null?PHASE_Y[n.phase]:0)*150;
    var label=PHASE_LABELS[n.phase]||n.phase.toUpperCase();
    svg+='<text x="12" y="'+(py-28)+'" fill="#333" font-size="10" font-weight="700" letter-spacing="1.5">'+label+'</text>';
    svg+='<line x1="0" y1="'+(py-20)+'" x2="'+w+'" y2="'+(py-20)+'" stroke="#262626" stroke-width="1"/>';
  });

  // Edges — curved for clarity
  edges.forEach(function(e){
    if(!e.source||!e.target)return;
    var dx=e.target.x-e.source.x;var dy=e.target.y-e.source.y;
    var d=Math.sqrt(dx*dx+dy*dy)||1;
    var r=24;
    var sx=e.source.x+dx/d*r;var sy=e.source.y+dy/d*r;
    var tx=e.target.x-dx/d*(r+8);var ty=e.target.y-dy/d*(r+8);
    // Slight curve for overlapping edges
    var mx=(sx+tx)/2;var my=(sy+ty)/2;
    var nx=-dy/d*15;var ny=dx/d*15;
    svg+='<path d="M'+sx+','+sy+' Q'+(mx+nx)+','+(my+ny)+' '+tx+','+ty+'" fill="none" stroke="#3a3a3a" stroke-width="1.2" marker-end="url(#arr)" opacity="0.7"/>';
  });

  // Nodes
  nodes.forEach(function(n){
    var sc=STATUS_COLORS[n.status]||'#393939';
    var pc=PHASE_COLORS[n.phase]||'#666';
    var r=n.durationMinutes?Math.min(30,Math.max(18,12+Math.sqrt(n.durationMinutes)*1.5)):20;

    svg+='<g class="node" onmousedown="startDrag(event,&apos;'+n.slug+'&apos;)" onmouseenter="showTip(&apos;'+n.slug+'&apos;)" onmouseleave="hideTip()">';
    // Phase ring
    svg+='<circle cx="'+n.x+'" cy="'+n.y+'" r="'+(r+4)+'" fill="none" stroke="'+pc+'" stroke-width="2" opacity="0.5"/>';
    // Status fill
    svg+='<circle cx="'+n.x+'" cy="'+n.y+'" r="'+r+'" fill="'+sc+'" stroke="#1a1a1a" stroke-width="1.5"/>';
    // Pinned indicator
    if(n.pinned){svg+='<circle cx="'+n.x+'" cy="'+n.y+'" r="'+(r+7)+'" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="3,3" opacity="0.3"/>';}
    // Number label
    svg+='<text x="'+n.x+'" y="'+(n.y+4)+'" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" pointer-events="none">'+n.number+'</text>';
    // Name below
    var nameText=n.name.length>20?n.name.substring(0,18)+'..':n.name;
    svg+='<text x="'+n.x+'" y="'+(n.y+r+15)+'" text-anchor="middle" fill="#777" font-size="9" pointer-events="none">'+nameText+'</text>';
    svg+='</g>';
  });

  svgEl.innerHTML=svg;
  // Keep tooltip positioned on the hovered node even as it moves
  if(hoveredNode){positionTip(hoveredNode);}
}

function showTip(ev,slug){
  var n=nodes.find(function(x){return x.slug===slug});if(!n)return;
  var tip=document.getElementById('graph-tooltip');
  var dur=n.durationMinutes?(n.durationMinutes<1?'<1 min':n.durationMinutes+'min'):'not started';
  tip.innerHTML='<strong>'+n.number+' '+n.name+'</strong><br>'
    +'<span style="color:'+PHASE_COLORS[n.phase]+'">'+n.phase+'</span><br>'
    +'Agent: <strong>'+n.agent+'</strong><br>'
    +'Status: '+n.status+'<br>'
    +'Duration: '+dur+'<br>'
    +'Sensors: <span style="color:#4caf50">'+n.sensorsPassed+' passed</span>'
    +(n.sensorsFailed?' <span style="color:#f44336">'+n.sensorsFailed+' failed</span>':'');
  tip.style.display='block';
  tip.style.left=(ev.clientX+14)+'px';tip.style.top=(ev.clientY-14)+'px';
}
function hideTip(){document.getElementById('graph-tooltip').style.display='none';}

var dragOffX=0,dragOffY=0;

function startDrag(ev,slug){
  ev.preventDefault();ev.stopPropagation();
  var n=nodes.find(function(x){return x.slug===slug});if(!n)return;
  dragging=n;
  n.pinned=true;
  if(animId){cancelAnimationFrame(animId);animId=null;}

  // Calculate offset between cursor and node center so it doesn't jump
  var pt=svgCoords(ev);
  dragOffX=n.x-pt.x;
  dragOffY=n.y-pt.y;

  document.addEventListener('mousemove',onDrag);
  document.addEventListener('mouseup',endDrag);
}
function onDrag(ev){
  if(!dragging||!svgEl)return;
  var pt=svgCoords(ev);
  dragging.x=Math.max(50,Math.min(w-50,pt.x+dragOffX));
  dragging.y=Math.max(40,Math.min(h-40,pt.y+dragOffY));
  render();
}
function endDrag(){
  if(dragging){
    dragging.vx=0;dragging.vy=0;
  }
  dragging=null;dragOffX=0;dragOffY=0;
  document.removeEventListener('mousemove',onDrag);
  document.removeEventListener('mouseup',endDrag);
  simulate(0.15);
}

// Convert mouse event to SVG viewBox coordinates
function svgCoords(ev){
  var rect=svgEl.getBoundingClientRect();
  var vb=svgEl.viewBox.baseVal;
  return{
    x:(ev.clientX-rect.left)/rect.width*vb.width,
    y:(ev.clientY-rect.top)/rect.height*vb.height
  };
}

function fitGraph(){
  // Unpin all and re-simulate
  nodes.forEach(function(n){n.pinned=false;});
  if(GRAPH_DATA)initGraph(GRAPH_DATA);
}
function resetGraph(){
  nodes.forEach(function(n){n.pinned=false;});
  if(GRAPH_DATA)initGraph(GRAPH_DATA);
}

// --- Mouse-tracking tooltip (works during animation) ---
var hoveredNode=null;

function setupHover(){
  // Hide tooltip on scroll so it doesn't stick at wrong position
  window.addEventListener('scroll',function(){if(hoveredNode){hoveredNode=null;hideTip();}});
}

function showTip(slug){
  if(dragging)return;
  var n=nodes.find(function(x){return x.slug===slug});if(!n)return;
  hoveredNode=n;
  var tip=document.getElementById('graph-tooltip');
  var dur=n.durationMinutes?(n.durationMinutes<1?'<1 min':Math.round(n.durationMinutes)+' min'):'not started';
  tip.innerHTML='<strong>'+n.number+' '+n.name+'</strong><br>'
    +'<span style="color:'+PHASE_COLORS[n.phase]+'">'+n.phase+'</span><br>'
    +'Agent: <strong>'+n.agent+'</strong><br>'
    +'Status: '+n.status+'<br>'
    +'Duration: '+dur+'<br>'
    +'Sensors: <span style="color:#4caf50">'+n.sensorsPassed+' passed</span>'
    +(n.sensorsFailed?' <span style="color:#f44336">'+n.sensorsFailed+' failed</span>':'');
  tip.style.display='block';
  positionTip(n);
}
function positionTip(n){
  if(!svgEl)return;
  var tip=document.getElementById('graph-tooltip');
  if(!tip||tip.style.display==='none')return;
  var rect=svgEl.getBoundingClientRect();
  var vb=svgEl.viewBox.baseVal;
  if(!vb||!vb.width)return;
  // Convert node SVG coords to page-absolute coords
  var scaleX=rect.width/vb.width;
  var scaleY=rect.height/vb.height;
  var pageX=rect.left+window.scrollX+n.x*scaleX;
  var pageY=rect.top+window.scrollY+n.y*scaleY;
  tip.style.left=Math.round(pageX+28)+'px';
  tip.style.top=Math.round(pageY-10)+'px';
}
function hideTip(){
  hoveredNode=null;
  var tip=document.getElementById('graph-tooltip');
  if(tip)tip.style.display='none';
}
`;
  }

  // ──────────────────── Helpers ────────────────────

  private e(s: string | number): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  private card(v: string | number, label: string, cls = ''): string { return `<div class="card ${cls}"><div class="card-value">${this.e(v)}</div><div class="card-label">${label}</div></div>`; }
  private detail(label: string, value: string | number): string { return `<div class="detail"><span class="detail-label">${label}</span><span class="detail-value">${this.e(value)}</span></div>`; }

  // ──────────────────── CSS ────────────────────

  private css(): string {
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#ccc)}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.header h1{font-size:22px;font-weight:600;color:var(--vscode-foreground,#eee)}
.btn{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px}
.btn:hover{background:var(--vscode-button-hoverBackground,#1177bb)}
.btn-sm{padding:4px 10px;font-size:11px}
.btn-back{background:transparent;color:var(--vscode-textLink-foreground,#3794ff);padding:4px 0;cursor:pointer;border:none;font-size:13px}
.btn-back:hover{text-decoration:underline}

/* Top tabs */
.top-tabs{display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border,#3c3c3c);margin-bottom:20px}
.top-tab{padding:10px 24px;cursor:pointer;font-size:13px;font-weight:600;color:var(--vscode-descriptionForeground,#888);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.top-tab:hover{color:var(--vscode-foreground,#eee)}
.top-tab.active{color:var(--vscode-textLink-foreground,#3794ff);border-bottom-color:var(--vscode-textLink-foreground,#3794ff)}
.top-content{display:none}.top-content.active{display:block}

.cards{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.card{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;padding:16px 20px;min-width:100px;flex:1}
.card-value{font-size:22px;font-weight:700;color:var(--vscode-foreground,#eee)}
.card-label{font-size:10px;color:var(--vscode-descriptionForeground,#888);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
.card-active{border-left:3px solid #dca63a}.card-done{border-left:3px solid #4caf50}
.card-time{border-left:3px solid #9c27b0}.card-gen{border-left:3px solid #3794ff}
.section{margin-bottom:28px}
.section h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--vscode-descriptionForeground,#999);margin-bottom:12px}
.chart{display:flex;flex-direction:column;gap:6px}
.bar-row{display:flex;align-items:center;gap:10px}.bar-label{width:100px;font-size:12px;text-align:right;color:var(--vscode-descriptionForeground,#999)}
.bar-track{flex:1;height:18px;background:var(--vscode-editorWidget-background,#2d2d2d);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;background:linear-gradient(90deg,#3794ff,#60a5fa);border-radius:4px;min-width:2px}.bar-value{width:30px;font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground,#888);border-bottom:1px solid var(--vscode-editorWidget-border,#3c3c3c)}
td{padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border,#2a2a2a)}
.intent-row{cursor:pointer}.intent-row:hover{background:var(--vscode-list-hoverBackground,#2a2d2e)}
.badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.status-active{background:#dca63a22;color:#dca63a}.status-done{background:#4caf5022;color:#4caf50}.status-other{background:#88888822;color:#888}
.mini-bar{height:6px;background:var(--vscode-editorWidget-background,#2d2d2d);border-radius:3px;overflow:hidden;display:inline-block;width:80px;vertical-align:middle}
.mini-fill{height:100%;background:#3794ff;border-radius:3px}.mini-fill.fill-green{background:#4caf50}
.sm{font-size:11px;margin-left:6px;color:var(--vscode-descriptionForeground,#999)}
.big-bar{position:relative;height:32px;background:var(--vscode-editorWidget-background,#2d2d2d);border-radius:8px;overflow:hidden}
.big-fill{height:100%;background:linear-gradient(90deg,#3794ff,#60a5fa);border-radius:8px}
.big-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.pipeline{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px}
.pill{display:inline-block;width:18px;height:18px;border-radius:3px}
.pill-done{background:#4caf50}.pill-skip{background:#666}.pill-active{background:#dca63a}.pill-await{background:#3794ff}.pill-revised{background:#e67e22}.pill-pending{background:#333;border:1px solid #555}
.legend,.graph-legend{display:flex;gap:14px;flex-wrap:wrap}
.gl{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--vscode-descriptionForeground,#999)}
.gl .pill{width:10px;height:10px}
.details-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.detail{background:var(--vscode-editorWidget-background,#252526);border-radius:6px;padding:12px 16px}
.detail-label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground,#888);margin-bottom:4px}
.detail-value{font-size:15px;font-weight:600;color:var(--vscode-foreground,#eee)}
.dim{opacity:.5}.hint{font-size:11px;color:var(--vscode-descriptionForeground,#777);margin-top:8px;font-style:italic}

/* Graph */
#graph-container{position:relative;background:var(--vscode-editorWidget-background,#1a1a1a);border-radius:8px;border:1px solid var(--vscode-editorWidget-border,#3c3c3c);overflow:hidden}
.graph-toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border,#333)}
.graph-toolbar .btn-group{display:flex;gap:4px}
#graph-svg{display:block;cursor:grab}
#graph-svg:active{cursor:grabbing}
.graph-tip{display:none;position:absolute;background:#252526;border:1px solid #555;border-radius:6px;padding:10px 14px;font-size:12px;line-height:1.5;color:#ccc;z-index:100;pointer-events:none;max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,.5)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%}
.dot-done{background:#4caf50}.dot-active{background:#dca63a}.dot-await{background:#3794ff}.dot-pending{background:#444;border:1px solid #666}.dot-skip{background:#555}
.node{cursor:grab}.node:active{cursor:grabbing}

/* Timeline */
.tl-summary{display:flex;gap:20px;font-size:12px;color:var(--vscode-descriptionForeground,#999);margin-bottom:10px}
.tl-summary strong{color:var(--vscode-foreground,#eee)}
.tl-container{background:var(--vscode-editorWidget-background,#1a1a1a);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;overflow:hidden;margin-bottom:8px}
.tl-header{display:flex;align-items:center;border-bottom:1px solid #333;padding:8px 0}
.tl-label-header{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666}
.tl-meta-header{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666;text-align:center}
.tl-row{display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #222;transition:background .1s}
.tl-row:last-child{border-bottom:none}
.tl-row:hover{background:#ffffff06}
.tl-row-even{background:#ffffff03}
.tl-label{width:220px;flex-shrink:0;padding:0 12px;display:flex;align-items:center;gap:6px}
.tl-num{font-size:11px;font-weight:700;color:#888;min-width:24px}
.tl-name{font-size:12px;color:var(--vscode-foreground,#ccc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.tl-agent{font-size:10px;font-weight:600;margin-left:auto;flex-shrink:0}
.tl-track{flex:1;position:relative;height:28px;margin:0 8px}
.tl-markers{position:absolute;top:0;left:0;right:0;bottom:0}
.tl-marker{position:absolute;top:0;bottom:0;border-left:1px solid #2a2a2a}
.tl-marker span{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:9px;color:#555;white-space:nowrap}
.tl-bar{position:absolute;top:2px;height:24px;border-radius:5px;min-width:4px;display:flex;align-items:center;justify-content:center;transition:opacity .15s;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.tl-bar:hover{opacity:1!important;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.tl-bar-running{opacity:.5;background-image:repeating-linear-gradient(-45deg,transparent,transparent 4px,rgba(255,255,255,.08) 4px,rgba(255,255,255,.08) 8px)!important}
.tl-bar-label{font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:nowrap;padding:0 6px}
.tl-meta{width:80px;flex-shrink:0;display:flex;align-items:center;gap:6px;justify-content:center;padding:0 8px}
.tl-status{font-size:12px}
.tl-time{font-size:10px;color:#666}

/* Agent cards */
.agent-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.agent-card{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;padding:14px 16px}
.agent-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.agent-header .dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.agent-header strong{flex:1;font-size:13px;text-transform:capitalize}
.agent-time{font-size:14px;font-weight:700;color:var(--vscode-foreground,#eee)}
.agent-bar-track{height:6px;background:#2d2d2d;border-radius:3px;overflow:hidden;margin-bottom:8px}
.agent-bar-fill{height:100%;border-radius:3px;transition:width .3s}
.agent-meta{display:flex;gap:12px;font-size:11px;color:var(--vscode-descriptionForeground,#888);margin-bottom:8px}
.agent-stages{display:flex;flex-wrap:wrap;gap:4px}
.agent-stage-pill{background:#333;border:1px solid #444;border-radius:4px;padding:2px 8px;font-size:10px;color:#999}

/* Handoff chain */
.handoff-chain{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.handoff{display:flex;align-items:center;gap:4px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:6px;padding:4px 10px;font-size:11px}
.handoff .dot{width:8px;height:8px;border-radius:50%}
.handoff-arrow{color:#555;font-size:13px}

@media(max-width:600px){.cards{flex-direction:column}.details-grid{grid-template-columns:1fr 1fr}.agent-grid{grid-template-columns:1fr}}
`;
  }
}
