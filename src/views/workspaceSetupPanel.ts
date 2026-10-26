import * as vscode from 'vscode';

/**
 * Shape of a single repo entry in repos.json.
 * `branch` is optional — when omitted the framework uses the repo default.
 */
interface RepoEntry {
  name: string;
  branch?: string;
}

/**
 * Shape of the repos.json manifest written at the workspace root.
 */
interface ReposManifest {
  org: string;
  repos: RepoEntry[];
}

/**
 * Workspace Setup panel — a form for building a `repos.json` manifest at the
 * workspace root. The manifest declares the GitHub org and the repos that make
 * up this multi-repo workspace.
 *
 * This is a workspace-level manifest, NOT AIDLC framework state, so writing it
 * is in-scope for the extension. The panel pre-fills from any existing
 * repos.json so re-opening it edits rather than overwrites blindly.
 */
export class WorkspaceSetupPanel {
  public static currentPanel: WorkspaceSetupPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.handleMessage(msg),
      null,
      this.disposables
    );
  }

  static async show(): Promise<void> {
    if (WorkspaceSetupPanel.currentPanel) {
      WorkspaceSetupPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'amadeus-aidlc.workspaceSetup',
      'Workspace Setup',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    WorkspaceSetupPanel.currentPanel = new WorkspaceSetupPanel(panel);

    const existing = await WorkspaceSetupPanel.readExistingManifest();
    panel.webview.html = WorkspaceSetupPanel.getHtml(existing);
  }

  /** Resolve the workspace-root repos.json URI, or undefined if no folder is open. */
  private static manifestUri(): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }
    return vscode.Uri.joinPath(workspaceFolder.uri, 'repos.json');
  }

  /** Read and parse an existing repos.json so the form opens pre-filled. */
  private static async readExistingManifest(): Promise<ReposManifest | null> {
    const uri = WorkspaceSetupPanel.manifestUri();
    if (!uri) {
      return null;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'repos' in parsed &&
        Array.isArray((parsed as ReposManifest).repos)
      ) {
        const manifest = parsed as ReposManifest;
        return {
          org: typeof manifest.org === 'string' ? manifest.org : '',
          repos: manifest.repos
            .filter((r) => r && typeof r.name === 'string' && r.name.trim() !== '')
            .map((r) => ({
              name: r.name,
              ...(r.branch && r.branch.trim() !== '' ? { branch: r.branch } : {}),
            })),
        };
      }
    } catch {
      // No existing manifest or invalid JSON — start from a blank form.
    }
    return null;
  }

  private async handleMessage(msg: { command: string; payload?: unknown }): Promise<void> {
    switch (msg.command) {
      case 'save':
        await this.saveManifest(msg.payload);
        break;
      case 'sync':
        await this.syncWorkspace();
        break;
      case 'cancel':
        this.panel.dispose();
        break;
    }
  }

  /**
   * Copy the framework's workspace-sync command to the clipboard so the user
   * can paste it into Kiro chat. The extension never runs framework state
   * changes itself — it hands the command back to the framework via chat.
   */
  private async syncWorkspace(): Promise<void> {
    const command = '/aidlc-workspace-sync';
    await vscode.env.clipboard.writeText(command);
    vscode.window.showInformationMessage(
      `Copied "${command}" to clipboard. Paste it in Kiro chat to sync the workspace.`
    );
  }

  /**
   * Validate and write repos.json to the workspace root.
   * Rules: org required, at least one repo, every repo must have a name.
   * Branch is optional and omitted from the entry when blank.
   */
  private async saveManifest(payload: unknown): Promise<void> {
    const uri = WorkspaceSetupPanel.manifestUri();
    if (!uri) {
      vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
      return;
    }

    const data = (payload ?? {}) as { org?: unknown; repos?: unknown };
    const org = typeof data.org === 'string' ? data.org.trim() : '';
    const rawRepos = Array.isArray(data.repos) ? data.repos : [];

    const errors: string[] = [];
    if (org === '') {
      errors.push('Organization (org) is required.');
    }

    const repos: RepoEntry[] = [];
    rawRepos.forEach((r, i) => {
      const entry = (r ?? {}) as { name?: unknown; branch?: unknown };
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const branch = typeof entry.branch === 'string' ? entry.branch.trim() : '';
      if (name === '') {
        errors.push(`Repo #${i + 1} is missing a name.`);
        return;
      }
      repos.push(branch === '' ? { name } : { name, branch });
    });

    if (repos.length === 0) {
      errors.push('Add at least one repository.');
    }

    if (errors.length > 0) {
      this.panel.webview.postMessage({ command: 'validationError', errors });
      return;
    }

    const manifest: ReposManifest = { org, repos };
    const json = JSON.stringify(manifest, null, 2) + '\n';

    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
      // Reload System panel status so the Workspace Setup row reflects the
      // newly written manifest ("Add repos" → "configured").
      await vscode.commands.executeCommand('amadeus-aidlc.refreshViews');
      vscode.window.showInformationMessage(
        `Added ${repos.length} repo${repos.length === 1 ? '' : 's'} to the workspace.`,
        'Open repos.json'
      ).then((action) => {
        if (action === 'Open repos.json') {
          void vscode.window.showTextDocument(uri);
        }
      });
      this.panel.dispose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to write repos.json: ${message}`);
    }
  }

  private dispose(): void {
    WorkspaceSetupPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private static getHtml(existing: ReposManifest | null): string {
    // Seed the form with existing data, or a single blank repo row.
    const seed: ReposManifest = existing && existing.repos.length > 0
      ? existing
      : { org: existing?.org ?? '', repos: [{ name: '' }] };
    const seedJson = JSON.stringify(seed).replace(/</g, '\\u003c');

    // Sync is only meaningful once repos are actually configured in the
    // workspace, so the hero is rendered only when a saved manifest already
    // has at least one repo. A fresh/empty workspace hides it entirely.
    const reposConfigured = !!existing && existing.repos.length > 0;
    const syncHero = reposConfigured
      ? `
  <div class="sync-hero">
    <div class="sync-info">
      <h2>Sync Workspace</h2>
      <p>Copies <code>/aidlc-workspace-sync</code> to your clipboard — paste it in Kiro chat to sync all repos.</p>
    </div>
    <button class="btn btn-sync" id="sync" title="Copy /aidlc-workspace-sync to clipboard">
      <span class="ico">&#8635;</span> Sync Workspace
    </button>
  </div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#ccc);padding:28px 24px}
h1{font-size:22px;font-weight:700;color:var(--vscode-foreground,#eee);margin-bottom:6px}
.subtitle{font-size:13px;color:var(--vscode-descriptionForeground,#999);margin-bottom:24px;line-height:1.5}
.card{max-width:680px}
label{display:block;font-size:12px;font-weight:600;color:var(--vscode-foreground,#ddd);margin-bottom:6px}
.hint{font-weight:400;color:var(--vscode-descriptionForeground,#888)}
input{width:100%;padding:7px 10px;border-radius:5px;border:1px solid var(--vscode-input-border,#3c3c3c);background:var(--vscode-input-background,#2a2a2a);color:var(--vscode-input-foreground,#eee);font-size:13px}
input:focus{outline:none;border-color:var(--vscode-focusBorder,#3794ff)}
.field{margin-bottom:20px}
.repos-head{display:flex;align-items:center;justify-content:space-between;margin:28px 0 12px}
.repos-head h2{font-size:14px;text-transform:uppercase;letter-spacing:1px;color:var(--vscode-descriptionForeground,#888)}
.repo-row{display:grid;grid-template-columns:1fr 1fr 36px;gap:10px;align-items:end;margin-bottom:12px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#333);border-radius:8px;padding:14px}
.repo-row .col label{margin-bottom:4px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s}
.btn-primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground,#1177bb)}
.btn-secondary{background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-contrastBorder,#555)}
.btn-secondary:hover{background:var(--vscode-button-secondaryHoverBackground,#333)}
.btn-icon{background:transparent;border:1px solid var(--vscode-input-border,#444);color:var(--vscode-errorForeground,#c66);width:36px;height:34px;border-radius:5px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.btn-icon:hover{background:var(--vscode-inputValidation-errorBackground,#3a2222);border-color:var(--vscode-errorForeground,#c66)}

/* Sync — the primary, most-used action. Prominent hero banner at the top. */
.sync-hero{display:flex;align-items:center;gap:16px;background:var(--vscode-textBlockQuote-background,var(--vscode-editorWidget-background,#252526));border:1px solid var(--vscode-focusBorder,#3794ff);border-radius:10px;padding:16px 18px;margin-bottom:26px}
.sync-hero .sync-info{flex:1;min-width:0}
.sync-hero h2{font-size:14px;font-weight:700;color:var(--vscode-foreground,#eee);margin-bottom:8px}
.sync-hero p{font-size:12px;color:var(--vscode-descriptionForeground,#999);line-height:1.45}
.sync-hero p code{background:var(--vscode-textCodeBlock-background,#2a2a2a);color:var(--vscode-textLink-foreground,#5aa9ff);border:1px solid var(--vscode-focusBorder,#3794ff)}
.btn-sync{flex-shrink:0;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);font-size:13px;font-weight:700;padding:11px 22px;border-radius:7px}
.btn-sync:hover{background:var(--vscode-button-hoverBackground,#1177bb);transform:translateY(-1px)}
.btn-sync .ico{font-size:15px}

.actions{display:flex;gap:10px;margin-top:28px;padding-top:20px;border-top:1px solid var(--vscode-editorWidget-border,#2a2a2a)}
.errors{background:var(--vscode-inputValidation-errorBackground,#4a1f1f);border:1px solid var(--vscode-inputValidation-errorBorder,#7a3333);color:var(--vscode-errorForeground,#f3b1b1);border-radius:6px;padding:12px 14px;margin-bottom:18px;font-size:12px;display:none}
.errors ul{margin:0;padding-left:18px}
code{background:var(--vscode-textCodeBlock-background,#2a2a2a);padding:1px 5px;border-radius:3px;font-size:12px}
</style>
</head>
<body>
<script>const vscode=acquireVsCodeApi();</script>
<div class="card">
  <h1>Workspace Setup</h1>
  <p class="subtitle">Declare the repositories that make up this workspace.</p>
${syncHero}
  <div class="errors" id="errors"><ul id="errorList"></ul></div>

  <div class="field">
    <label for="org">GitHub organization <span class="hint">(required)</span></label>
    <input id="org" type="text" placeholder="your-github-org" autocomplete="off">
  </div>

  <div class="repos-head">
    <h2>Repositories</h2>
    <button class="btn btn-secondary" id="addRepo">+ Add repo</button>
  </div>

  <div id="repoList"></div>

  <div class="actions">
    <button class="btn btn-primary" id="save">Save Workspace</button>
    <button class="btn btn-secondary" id="cancel">Cancel</button>
  </div>
</div>

<script>
const seed = JSON.parse('${seedJson}');
const repoList = document.getElementById('repoList');
document.getElementById('org').value = seed.org || '';

function makeRow(repo){
  const row = document.createElement('div');
  row.className = 'repo-row';
  row.innerHTML =
    '<div class="col"><label>Repo name <span class="hint">(required)</span></label>'
    + '<input class="repo-name" type="text" placeholder="checkout-api" autocomplete="off"></div>'
    + '<div class="col"><label>Branch <span class="hint">(optional)</span></label>'
    + '<input class="repo-branch" type="text" placeholder="main" autocomplete="off"></div>'
    + '<button class="btn-icon remove" title="Remove repo">&times;</button>';
  row.querySelector('.repo-name').value = repo.name || '';
  row.querySelector('.repo-branch').value = repo.branch || '';
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    if (repoList.children.length === 0) { addRow({ name:'' }); }
  });
  return row;
}
function addRow(repo){ repoList.appendChild(makeRow(repo)); }

(seed.repos && seed.repos.length ? seed.repos : [{ name:'' }]).forEach(addRow);

document.getElementById('addRepo').addEventListener('click', () => addRow({ name:'' }));

document.getElementById('save').addEventListener('click', () => {
  const org = document.getElementById('org').value;
  const repos = Array.from(repoList.querySelectorAll('.repo-row')).map(r => ({
    name: r.querySelector('.repo-name').value,
    branch: r.querySelector('.repo-branch').value
  }));
  vscode.postMessage({ command:'save', payload:{ org, repos } });
});
const syncBtn = document.getElementById('sync');
if (syncBtn) { syncBtn.addEventListener('click', () => vscode.postMessage({ command:'sync' })); }
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command:'cancel' }));

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'validationError') {
    const box = document.getElementById('errors');
    const list = document.getElementById('errorList');
    list.innerHTML = '';
    msg.errors.forEach(e => { const li = document.createElement('li'); li.textContent = e; list.appendChild(li); });
    box.style.display = 'block';
    box.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
});
</script>
</body>
</html>`;
  }
}
