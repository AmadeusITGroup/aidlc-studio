import * as vscode from 'vscode';

export class DocsPanel {
  public static currentPanel: DocsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );
  }

  static show(): void {
    if (DocsPanel.currentPanel) {
      DocsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'amadeus-aidlc.docs',
      'AIDLC Studio — Documentation',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    DocsPanel.currentPanel = new DocsPanel(panel);
    panel.webview.html = DocsPanel.getHtml();
  }

  private handleMessage(msg: { command: string; url?: string }): void {
    if (msg.command === 'openExternal' && msg.url) {
      vscode.env.openExternal(vscode.Uri.parse(msg.url));
    }
  }

  private dispose(): void {
    DocsPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private static getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #ccc); max-width: 860px; margin: 0 auto; line-height: 1.6; }

  h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; color: var(--vscode-foreground, #eee); }
  .subtitle { font-size: 14px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 28px; }
  h2 { font-size: 16px; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c); color: var(--vscode-foreground, #eee); }
  h3 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; color: var(--vscode-foreground, #ddd); }
  p { margin-bottom: 12px; font-size: 13px; }
  ul, ol { margin: 8px 0 16px 20px; font-size: 13px; }
  li { margin-bottom: 6px; }
  code { background: var(--vscode-textCodeBlock-background, #2d2d2d); padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; }
  pre { background: var(--vscode-textCodeBlock-background, #2d2d2d); padding: 12px 16px; border-radius: 6px; overflow-x: auto; margin: 8px 0 16px; font-size: 12px; line-height: 1.5; }
  pre code { background: none; padding: 0; }

  .tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid var(--vscode-editorWidget-border, #3c3c3c); }
  .tab { padding: 10px 20px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--vscode-descriptionForeground, #888); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s; }
  .tab:hover { color: var(--vscode-foreground, #eee); }
  .tab.active { color: var(--vscode-textLink-foreground, #3794ff); border-bottom-color: var(--vscode-textLink-foreground, #3794ff); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 20px; }
  .card { background: var(--vscode-editorWidget-background, #252526); border: 1px solid var(--vscode-editorWidget-border, #3c3c3c); border-radius: 8px; padding: 14px 16px; }
  .card-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; color: var(--vscode-foreground, #eee); }
  .card-desc { font-size: 12px; color: var(--vscode-descriptionForeground, #999); }

  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0 16px; }
  th { text-align: left; padding: 8px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground, #888); border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--vscode-editorWidget-border, #2a2a2a); }

  .tip { background: #3794ff15; border-left: 3px solid #3794ff; padding: 10px 14px; border-radius: 4px; margin: 12px 0; font-size: 12px; }
  .tip-label { font-weight: 600; color: #3794ff; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }

  .link { color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; text-decoration: none; }
  .link:hover { text-decoration: underline; }

  .kbd { display: inline-block; background: var(--vscode-editorWidget-background, #333); border: 1px solid var(--vscode-editorWidget-border, #555); border-radius: 3px; padding: 1px 6px; font-size: 11px; font-family: monospace; }

  @media (max-width: 600px) { .card-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<script>
  const vscode = acquireVsCodeApi();
  function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    document.getElementById('content-' + id).classList.add('active');
  }
  function openUrl(url) { vscode.postMessage({ command: 'openExternal', url }); }
</script>

<h1>AIDLC Studio</h1>
<p class="subtitle">Your AI Development Workflow, Visualized</p>

<div class="tabs">
  <div class="tab active" id="tab-guide" onclick="switchTab('guide')">Getting Started</div>
  <div class="tab" id="tab-sidebar" onclick="switchTab('sidebar')">Sidebar Views</div>
  <div class="tab" id="tab-commands" onclick="switchTab('commands')">Commands</div>
  <div class="tab" id="tab-workflow" onclick="switchTab('workflow')">AIDLC Workflow</div>
  <div class="tab" id="tab-reference" onclick="switchTab('reference')">Quick Reference</div>
</div>

<!-- TAB: Getting Started -->
<div class="tab-content active" id="content-guide">
  <h2>Getting Started</h2>

  <h3>1. Initial Setup</h3>
  <p>Look at the <strong>System</strong> panel in the sidebar. If Setup shows "Not installed", click it. The extension will:</p>
  <ol>
    <li>Install <code>bun</code> (JavaScript runtime for AIDLC hooks) if missing</li>
    <li>Install the AI-DLC framework for your chosen variant</li>
    <li>Copy the framework into your workspace (<code>.kiro/</code> and <code>aidlc/</code>)</li>
    <li>Run <code>/aidlc --doctor</code> to verify everything works</li>
  </ol>

  <div class="tip">
    <div class="tip-label">Tip</div>
    After setup, all four System items should be green. If any are red, click them to fix.
  </div>

  <h3>2. Start a Workflow</h3>
  <p>Once setup is complete, start your first AIDLC workflow:</p>
  <ol>
    <li>Click <strong>"Start New Workflow"</strong> in the Workflow Progress panel</li>
    <li>Describe what you want to build</li>
    <li>Optionally pick a scope (or let AIDLC auto-detect)</li>
    <li>The command is copied to your clipboard — paste it in Kiro chat</li>
    <li>The framework takes over from there</li>
  </ol>

  <h3>3. Track Progress</h3>
  <p>As the workflow runs in chat, the sidebar updates automatically:</p>
  <ul>
    <li><strong>Workflow Progress</strong> — shows your current position and a progress bar</li>
    <li><strong>Stages</strong> — every stage with live status icons</li>
    <li><strong>Artifacts</strong> — files generated by each stage (only real files on disk)</li>
  </ul>

  <h3>4. Approve Stages</h3>
  <p>When a stage needs your approval:</p>
  <ul>
    <li>The artifact file opens automatically with <strong>CodeLens</strong> at the top: [Approve] [Request Changes] [Skip]</li>
    <li>Or use the inline buttons in the Stages sidebar</li>
    <li>"Request Changes" lets you add feedback and sends the stage back</li>
  </ul>
</div>

<!-- TAB: Sidebar Views -->
<div class="tab-content" id="content-sidebar">
  <h2>Sidebar Views</h2>

  <div class="card-grid">
    <div class="card">
      <div class="card-title">System</div>
      <div class="card-desc">Setup status, bun, health check, version with auto-update, analytics dashboard, and this documentation. Every item is click-to-act.</div>
    </div>
    <div class="card">
      <div class="card-title">Workflow Progress</div>
      <div class="card-desc">Intent name, scope, depth, current phase/stage, progress bar, lead agent, and contextual action hints (approve, continue in chat).</div>
    </div>
    <div class="card">
      <div class="card-title">Stages</div>
      <div class="card-desc">All stages grouped by phase. Icons show status: completed, active, awaiting approval, revised, skipped, pending. Inline approve/skip buttons.</div>
    </div>
    <div class="card">
      <div class="card-title">Artifacts</div>
      <div class="card-desc">Files on disk, grouped by stage. Reviewable artifacts show approval status. Framework files (memory.md) are dimmed and labeled.</div>
    </div>
    <div class="card">
      <div class="card-title">Intents</div>
      <div class="card-desc">List of all intents. Click an inactive intent to switch (with confirmation). Active intent marked with a star.</div>
    </div>
    <div class="card">
      <div class="card-title">Analytics Dashboard</div>
      <div class="card-desc">Opens as a tab. Shows intent overview, scope distribution, progress bars, stage pipeline visualization, time analytics, and per-stage timing.</div>
    </div>
  </div>

  <h3>Stage Status Icons</h3>
  <table>
    <tr><th>Icon</th><th>Status</th><th>Meaning</th></tr>
    <tr><td>○</td><td>Pending</td><td>Not started yet</td></tr>
    <tr><td>▶</td><td>Active</td><td>Currently being worked on</td></tr>
    <tr><td>🔔</td><td>Awaiting Approval</td><td>Done, needs your sign-off</td></tr>
    <tr><td>✓</td><td>Completed</td><td>Approved and done</td></tr>
    <tr><td>↩</td><td>Revised</td><td>Sent back for changes</td></tr>
    <tr><td>⏭</td><td>Skipped</td><td>Excluded by scope or user choice</td></tr>
  </table>
</div>

<!-- TAB: Commands -->
<div class="tab-content" id="content-commands">
  <h2>All Commands</h2>
  <p>Open the Command Palette (<span class="kbd">Ctrl+Shift+P</span>) and type "AIDLC Studio".</p>

  <h3>Setup & System</h3>
  <table>
    <tr><th>Command</th><th>What it does</th></tr>
    <tr><td><code>Set Up AIDLC in Workspace</code></td><td>One-click framework installation</td></tr>
    <tr><td><code>/aidlc --doctor</code></td><td>Run health check</td></tr>
    <tr><td><code>/aidlc --doctor --export</code></td><td>Export diagnostic report</td></tr>
    <tr><td><code>Check for Updates</code></td><td>Check if newer version is available</td></tr>
    <tr><td><code>Update AIDLC Rules</code></td><td>Pull and install latest version</td></tr>
    <tr><td><code>Open Analytics Dashboard</code></td><td>Open the analytics webview</td></tr>
  </table>

  <h3>Workflow</h3>
  <table>
    <tr><th>Command</th><th>What it does</th></tr>
    <tr><td><code>/aidlc [description]</code></td><td>Compose a start workflow command and copy to clipboard</td></tr>
    <tr><td><code>/aidlc — Resume</code></td><td>Resume an interrupted workflow</td></tr>
    <tr><td><code>/aidlc --status</code></td><td>Show full status report</td></tr>
    <tr><td><code>/aidlc --stage</code></td><td>Jump to a specific stage</td></tr>
    <tr><td><code>/aidlc --phase</code></td><td>Jump to a phase</td></tr>
    <tr><td><code>/aidlc --scope</code></td><td>Change workflow scope</td></tr>
    <tr><td><code>/aidlc --depth</code></td><td>Change depth level</td></tr>
    <tr><td><code>/aidlc compose</code></td><td>Adaptive composer for tailored plans</td></tr>
  </table>

  <h3>Approval</h3>
  <table>
    <tr><th>Command</th><th>What it does</th></tr>
    <tr><td><code>Approve Stage</code></td><td>Approve the current stage</td></tr>
    <tr><td><code>Request Changes</code></td><td>Send stage back with feedback</td></tr>
    <tr><td><code>Skip Stage</code></td><td>Skip the current stage</td></tr>
    <tr><td><code>Review Artifact</code></td><td>Open the artifact file for the awaiting stage</td></tr>
  </table>
</div>

<!-- TAB: AIDLC Workflow -->
<div class="tab-content" id="content-workflow">
  <h2>AIDLC Workflow Overview</h2>
  <p>AIDLC (AI-Driven Development Life Cycle) structures development into <strong>5 phases</strong> and up to <strong>33 stages</strong>, guided by <strong>14 specialized agents</strong>.</p>

  <h3>Phases</h3>
  <table>
    <tr><th>#</th><th>Phase</th><th>Purpose</th></tr>
    <tr><td>0</td><td>Initialization</td><td>Bootstrap workspace, detect context, create intent (automatic)</td></tr>
    <tr><td>1</td><td>Ideation</td><td>Capture intent, validate feasibility, define scope</td></tr>
    <tr><td>2</td><td>Inception</td><td>Requirements, user stories, architecture, delivery planning</td></tr>
    <tr><td>3</td><td>Construction</td><td>Design, code generation, build, test</td></tr>
    <tr><td>4</td><td>Operation</td><td>Deploy, monitor, optimize (conditional)</td></tr>
  </table>

  <h3>Scopes</h3>
  <p>Scopes determine how many stages run. Choose based on your task:</p>
  <table>
    <tr><th>Scope</th><th>Use When</th><th>Stages</th></tr>
    <tr><td><code>feature</code></td><td>New feature in existing codebase</td><td>~25</td></tr>
    <tr><td><code>enterprise</code></td><td>Large-scale, multi-team</td><td>33</td></tr>
    <tr><td><code>mvp</code></td><td>Minimum viable product</td><td>~18</td></tr>
    <tr><td><code>bugfix</code></td><td>Fix a known defect</td><td>~10</td></tr>
    <tr><td><code>refactor</code></td><td>Code improvement</td><td>~12</td></tr>
    <tr><td><code>express</code></td><td>Quick task, minimal ceremony</td><td>~5</td></tr>
    <tr><td><code>poc</code></td><td>Proof of concept</td><td>~12</td></tr>
    <tr><td><code>spike</code></td><td>Research/exploration</td><td>~8</td></tr>
  </table>

  <div class="tip">
    <div class="tip-label">Tip</div>
    Not sure? Use "Auto-detect" when starting a workflow — AIDLC will pick the scope from your description.
  </div>

  <h3>How It Works</h3>
  <ol>
    <li>You describe what you want to build</li>
    <li>AIDLC auto-detects scope and initializes the workflow</li>
    <li>Each stage runs with a specialized agent (product, architect, developer, etc.)</li>
    <li>After each stage, you review and approve at a gate</li>
    <li>All artifacts are stored in the intent's record directory</li>
  </ol>

  <h3>Key Commands in Kiro Chat</h3>
  <table>
    <tr><th>Command</th><th>What it does</th></tr>
    <tr><td><code>/aidlc Build a REST API</code></td><td>Start with auto-detect scope</td></tr>
    <tr><td><code>/aidlc bugfix Fix the login timeout</code></td><td>Start with explicit scope</td></tr>
    <tr><td><code>/aidlc</code></td><td>Resume existing workflow</td></tr>
    <tr><td><code>/aidlc --status</code></td><td>Check progress</td></tr>
    <tr><td><code>/aidlc --doctor</code></td><td>Health check</td></tr>
  </table>

  <h3>External Resources</h3>
  <p>
    <span class="link" onclick="openUrl('https://awslabs.github.io/aidlc-workflows/guide/00-introduction/')">AIDLC Documentation</span> ·
    <span class="link" onclick="openUrl('https://awslabs.github.io/aidlc-workflows/guide/02-your-first-workflow/')">Your First Workflow</span> ·
    <span class="link" onclick="openUrl('https://awslabs.github.io/aidlc-workflows/guide/12-cli-commands/')">CLI Commands Reference</span>
  </p>
</div>

<!-- TAB: Quick Reference -->
<div class="tab-content" id="content-reference">
  <h2>Quick Reference</h2>

  <h3>Keyboard Shortcuts</h3>
  <table>
    <tr><th>Shortcut</th><th>Action</th></tr>
    <tr><td><span class="kbd">Ctrl+Shift+P</span></td><td>Open Command Palette → type "AIDLC Studio"</td></tr>
    <tr><td><span class="kbd">Ctrl+Shift+X</span></td><td>Open Extensions view</td></tr>
  </table>

  <h3>File Locations</h3>
  <table>
    <tr><th>Path</th><th>What</th></tr>
    <tr><td><code>.kiro/skills/aidlc/</code></td><td>AIDLC skill definition (makes /aidlc work)</td></tr>
    <tr><td><code>.kiro/tools/</code></td><td>Framework bun-based CLI tools</td></tr>
    <tr><td><code>.kiro/hooks/</code></td><td>Framework hooks (audit, sensors, gates)</td></tr>
    <tr><td><code>.kiro/agents/</code></td><td>14 agent persona definitions</td></tr>
    <tr><td><code>aidlc/spaces/default/intents/</code></td><td>Intent record directories</td></tr>
    <tr><td><code>aidlc/spaces/default/intents/active-intent</code></td><td>Pointer to current intent</td></tr>
    <tr><td><code>aidlc/spaces/default/intents/intents.json</code></td><td>Intent metadata list</td></tr>
    <tr><td><code>&lt;intent&gt;/aidlc-state.md</code></td><td>Workflow state (source of truth)</td></tr>
    <tr><td><code>&lt;intent&gt;/runtime-graph.json</code></td><td>Runtime execution graph</td></tr>
    <tr><td><code>&lt;intent&gt;/audit/</code></td><td>Decision audit trail shards</td></tr>
    <tr><td><code>&lt;intent&gt;/ideation/</code></td><td>Ideation phase artifacts</td></tr>
    <tr><td><code>&lt;intent&gt;/inception/</code></td><td>Inception phase artifacts</td></tr>
    <tr><td><code>&lt;intent&gt;/construction/</code></td><td>Construction phase artifacts</td></tr>
  </table>

  <h3>Settings</h3>
  <table>
    <tr><th>Setting</th><th>Default</th><th>Description</th></tr>
    <tr><td><code>amadeus-aidlc.rulesSource</code></td><td><code>""</code></td><td>Custom repo URL for AIDLC rules</td></tr>
    <tr><td><code>amadeus-aidlc.defaultScope</code></td><td><code>feature</code></td><td>Default scope for new workflows</td></tr>
    <tr><td><code>amadeus-aidlc.defaultDepth</code></td><td><code>standard</code></td><td>Default depth level</td></tr>
    <tr><td><code>amadeus-aidlc.autoDetectSetup</code></td><td><code>true</code></td><td>Prompt setup on workspace open</td></tr>
    <tr><td><code>amadeus-aidlc.autoCheckUpdates</code></td><td><code>true</code></td><td>Check for updates on startup</td></tr>
  </table>

  <h3>Troubleshooting</h3>
  <table>
    <tr><th>Problem</th><th>Fix</th></tr>
    <tr><td>/aidlc not recognized in chat</td><td>Run Setup from the System panel — it installs the SKILL.md</td></tr>
    <tr><td>Setup fails with auth error</td><td>For the Amadeus variant, ensure you have access to its repo; the AWS variant needs no auth</td></tr>
    <tr><td>Sidebar shows empty</td><td>Check that aidlc/spaces/default/intents/ has an intent directory with aidlc-state.md</td></tr>
    <tr><td>Stages show wrong status</td><td>Click Refresh in the sidebar title bar — or check the aidlc-state.md file directly</td></tr>
    <tr><td>Hook blocking error in chat</td><td>Type any message in chat (e.g., "continue") to trigger the HUMAN_TURN mint hook</td></tr>
    <tr><td>bun not found after install</td><td>Restart Kiro IDE — the PATH needs to refresh</td></tr>
  </table>
</div>

</body></html>`;
  }
}
