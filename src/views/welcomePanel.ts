import * as vscode from 'vscode';

export class WelcomePanel {
  public static currentPanel: WelcomePanel | undefined;
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

  static show(context: vscode.ExtensionContext): void {
    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'amadeus-aidlc.welcome',
      'Welcome to AIDLC Studio',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );
    WelcomePanel.currentPanel = new WelcomePanel(panel);
    const logoUri = context.extensionUri
      ? panel.webview.asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, 'resources', 'AIDLC Studio Logo.png')
        ).toString()
      : undefined;
    panel.webview.html = WelcomePanel.getHtml(WelcomePanel.getVersion(context), logoUri);
  }

  /** Read the installed extension version so the welcome badge is never stale. */
  private static getVersion(context: vscode.ExtensionContext): string {
    const version = context.extension.packageJSON.version as string | undefined;
    return version ?? '';
  }

  private handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'setup':
        vscode.commands.executeCommand('amadeus-aidlc.setup');
        break;
      case 'doctor':
        vscode.commands.executeCommand('amadeus-aidlc.doctor');
        break;
      case 'startWorkflow':
        vscode.commands.executeCommand('amadeus-aidlc.startWorkflow');
        break;
      case 'openDocs':
        vscode.commands.executeCommand('amadeus-aidlc.openDocs');
        break;
      case 'openAnalytics':
        vscode.commands.executeCommand('amadeus-aidlc.openAnalytics');
        break;
      case 'dontShowAgain':
        vscode.workspace.getConfiguration('amadeus-aidlc')
          .update('showWelcomeOnStartup', false, vscode.ConfigurationTarget.Global);
        this.panel.dispose();
        break;
    }
  }

  private dispose(): void {
    WelcomePanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private static getHtml(version: string, logoUri?: string): string {
    const versionBadge = version
      ? `<span class="version">v${version}</span>`
      : '';
    const brand = logoUri
      ? `<img class="brand-logo" src="${logoUri}" alt="AIDLC Studio">`
      : '<h1>AIDLC Studio</h1>';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#ccc);overflow-x:hidden}

/* Hero */
.hero{text-align:center;padding:48px 24px 36px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:600px;height:600px;background:radial-gradient(circle,#3794ff08 0%,transparent 70%);pointer-events:none}
.hero h1{font-size:32px;font-weight:700;color:var(--vscode-foreground,#eee);margin-bottom:8px;animation:fadeUp .6s ease-out}
.brand-logo{display:block;width:min(100%,360px);max-height:88px;object-fit:contain;margin:0 auto 18px;animation:fadeUp .6s ease-out}
.hero .tagline{font-size:15px;color:var(--vscode-descriptionForeground,#999);max-width:500px;margin:0 auto 24px;animation:fadeUp .6s ease-out .1s both}
.hero .version{display:inline-block;background:#3794ff22;color:#3794ff;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:600;letter-spacing:.5px;animation:fadeUp .6s ease-out .2s both}

/* Steps */
.steps{max-width:700px;margin:0 auto;padding:0 24px 40px}
.step{display:flex;gap:20px;margin-bottom:32px;opacity:0;animation:fadeUp .5s ease-out forwards}
.step:nth-child(1){animation-delay:.3s}
.step:nth-child(2){animation-delay:.45s}
.step:nth-child(3){animation-delay:.6s}
.step:nth-child(4){animation-delay:.75s}
.step-num{flex-shrink:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3794ff,#60a5fa);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;box-shadow:0 2px 12px #3794ff33}
.step-body{flex:1;padding-top:4px}
.step-body h3{font-size:15px;font-weight:600;color:var(--vscode-foreground,#eee);margin-bottom:4px}
.step-body p{font-size:13px;color:var(--vscode-descriptionForeground,#999);line-height:1.5}
.step-body .action{margin-top:10px}

/* Features grid */
.features{max-width:760px;margin:0 auto;padding:0 24px 40px}
.features h2{text-align:center;font-size:14px;text-transform:uppercase;letter-spacing:1.5px;color:var(--vscode-descriptionForeground,#777);margin-bottom:20px;animation:fadeUp .5s ease-out .9s both}
.feature-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.feature{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:10px;padding:18px;text-align:center;cursor:default;transition:border-color .2s,transform .2s;opacity:0;animation:fadeUp .4s ease-out forwards}
.feature:nth-child(1){animation-delay:1s}
.feature:nth-child(2){animation-delay:1.1s}
.feature:nth-child(3){animation-delay:1.2s}
.feature:nth-child(4){animation-delay:1.3s}
.feature:nth-child(5){animation-delay:1.4s}
.feature:nth-child(6){animation-delay:1.5s}
.feature:hover{border-color:#3794ff44;transform:translateY(-2px)}
.feature-icon{font-size:28px;margin-bottom:8px;display:block}
.feature h4{font-size:13px;font-weight:600;color:var(--vscode-foreground,#eee);margin-bottom:4px}
.feature p{font-size:11px;color:var(--vscode-descriptionForeground,#888);line-height:1.4}

/* Buttons */
.btn{display:inline-block;padding:8px 18px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
.btn-primary{background:#3794ff;color:#fff}.btn-primary:hover{background:#2a7be4}
.btn-secondary{background:transparent;border:1px solid #555;color:#ccc}.btn-secondary:hover{background:#333}
.btn-ghost{background:none;border:none;color:var(--vscode-textLink-foreground,#3794ff);padding:8px 4px;font-size:12px;cursor:pointer}.btn-ghost:hover{text-decoration:underline}

/* Footer */
.footer{text-align:center;padding:20px 24px 32px;border-top:1px solid var(--vscode-editorWidget-border,#2a2a2a);opacity:0;animation:fadeUp .5s ease-out 1.7s both}
.footer p{font-size:11px;color:var(--vscode-descriptionForeground,#666);margin-bottom:8px}

/* Animations */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

@media(max-width:600px){.feature-grid{grid-template-columns:1fr 1fr}.hero h1{font-size:24px}}
</style>
</head>
<body>
<script>const vscode=acquireVsCodeApi();</script>

<div class="hero">
  ${brand}
  <p class="tagline">Your AI development lifecycle, visualized. Set up in one click, then track every stage from your sidebar.</p>
  ${versionBadge}
</div>

<div class="steps">

  <div class="step">
    <div class="step-num">1</div>
    <div class="step-body">
      <h3>Install the Framework</h3>
      <p>Open the <strong>System</strong> panel in the sidebar. Click <strong>Setup</strong> to install the AIDLC framework. It clones the repo, copies the tools, hooks, and agents into your workspace, and verifies with <code>/aidlc --doctor</code>.</p>
      <div class="action">
        <button class="btn btn-primary" onclick="vscode.postMessage({command:'setup'})">Run Setup Now</button>
        <button class="btn btn-secondary" onclick="vscode.postMessage({command:'doctor'})" style="margin-left:8px">Run Health Check</button>
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div class="step-body">
      <h3>Start a Workflow</h3>
      <p>Click <strong>Start New Workflow</strong> in the sidebar, describe what you want to build, and paste the command in Kiro chat. The framework auto-detects scope and guides you through each stage.</p>
      <div class="action">
        <button class="btn btn-primary" onclick="vscode.postMessage({command:'startWorkflow'})">Start Workflow</button>
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <h3>Track & Approve</h3>
      <p>Watch progress in the sidebar as stages complete. When a stage needs your approval, the artifact opens automatically with <strong>Approve / Request Changes / Skip</strong> actions right in the editor.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">4</div>
    <div class="step-body">
      <h3>Analyze & Iterate</h3>
      <p>Open the <strong>Analytics Dashboard</strong> for a birds-eye view: Gantt timeline, dependency graph, agent activity, time breakdowns, and per-stage sensor results.</p>
      <div class="action">
        <button class="btn btn-primary" onclick="vscode.postMessage({command:'openAnalytics'})">Open Analytics</button>
        <button class="btn btn-secondary" onclick="vscode.postMessage({command:'openDocs'})" style="margin-left:8px">Read Docs</button>
      </div>
    </div>
  </div>

</div>

<div class="features">
  <h2>What You Get</h2>
  <div class="feature-grid">
    <div class="feature">
      <span class="feature-icon">&#9889;</span>
      <h4>One-Click Setup</h4>
      <p>Installs framework, bun, and verifies with doctor. Zero manual steps.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">&#128202;</span>
      <h4>Live Progress</h4>
      <p>Sidebar tracks every stage with status icons. Auto-refreshes on state changes.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">&#128200;</span>
      <h4>Analytics Dashboard</h4>
      <p>Timing breakdowns, scope distribution, stage pipeline, and per-agent activity.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">&#128268;</span>
      <h4>Dependency Graph</h4>
      <p>Interactive force-directed graph of stage dependencies. Drag, hover, explore.</p>
    </div>
  </div>
</div>

<div class="footer">
  <button class="btn-ghost" onclick="vscode.postMessage({command:'dontShowAgain'})">Don't show this again</button>
</div>

</body>
</html>`;
  }
}
