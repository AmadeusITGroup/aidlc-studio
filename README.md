# AIDLC Studio

An extension that makes the **AI-Driven Development Life Cycle (AI-DLC)** easier to install, run, and observe. AIDLC Studio is a thin, read-only companion over the AI-DLC framework — it never modifies the framework's files, it visualizes them.

It works with the open-source [AWS AI-DLC](https://github.com/awslabs/aidlc-workflows) (default) and the Amadeus AIDLC fork.

## What it does

- **One-click setup** — installs the AI-DLC framework, checks for `bun`, and verifies with `/aidlc --doctor`
- **Variant choice** — pick AWS (open source) or Amadeus during setup; each uses its correct install method
- **Live workflow view** — current intent, scope, phase, stage, progress bar, and lead agent in the sidebar
- **Stage tracking** — every stage grouped by phase with status (completed, active, awaiting approval, revised, skipped, pending)
- **Artifacts view** — only real files on disk, with reviewable artifacts clearly separated from framework-internal files
- **In-editor review** — opens the artifact needing approval and surfaces Approve / Request Changes / Skip actions
- **Analytics dashboard** (opens as a tab) — overview, per-intent detail, timing breakdown, dependency graph, Gantt timeline, and agent activity
- **Intent management** — list and switch between intents via the framework's own CLI
- **Health & updates** — framework health check, version visibility, and one-click updates for both the framework and the extension

## Important design principle

AIDLC Studio is **read-only** over the AI-DLC framework. It reads the files the framework writes (`aidlc-state.md`, `runtime-graph.json`, `intents.json`, the audit trail, and artifacts) and visualizes them. It does not write to or modify framework state. Actions like approving a stage or switching an intent are delegated to the framework's own CLI (`/aidlc` / `bun .kiro/tools/*.ts`) or guided back into Kiro chat.

## Getting started

### Prerequisites

- Kiro IDE, or VS Code 1.85+
- Internet access for the initial setup (downloads the framework)
- `bun` — the extension installs it for you if missing and configures PATH for Kiro's shells

### Install the extension

**From a packaged `.vsix`:**

1. `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
2. Select the `.vsix` file
3. Reload the window

**From source (development):**

```bash
git clone https://github.com/AmadeusITGroup/aidlc-studio.git
cd aidlc-studio
npm install
npm run compile
```

Then press `F5` to launch the Extension Development Host.

### Set up AI-DLC in your project

1. Open your project and click the **AIDLC Studio** icon in the activity bar
2. In the **System** panel, click **Setup**
3. Choose a variant (AWS open source is the default)
4. The extension installs the framework and runs `/aidlc --doctor`
5. Type `/aidlc` in Kiro chat to start a workflow

## Sidebar views

| View | Purpose |
|------|---------|
| **System** | Setup, bun, Health, AIDLC Version, Extension version, Analytics, Documentation — each is click-to-act |
| **Workflow Progress** | Intent, scope, depth, current phase/stage, progress bar, lead agent |
| **Stages** | All stages by phase with live status icons and inline approve/skip actions |
| **Artifacts** | Generated files on disk, reviewable vs framework-internal, with approval status |
| **Intents** | List of intents; click to switch (delegates to the framework CLI) |

## Analytics dashboard

Open from the **System → Analytics** row. Tabs:

- **Overview** — all intents, scope distribution, progress; click an intent to drill in
- **Dependency Graph** — interactive force-directed graph of stage dependencies (drag, hover, explore)
- **Timeline** — Gantt chart of stage execution on a real time axis, colored by agent
- **Agents** — time per agent and the agent-handoff sequence

All data comes from the framework's `runtime-graph.json`, `stage-graph.json`, and `aidlc-state.md`.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `amadeus-aidlc.rulesSource` | `""` | Advanced: override the AI-DLC repo URL used during setup |
| `amadeus-aidlc.defaultScope` | `"feature"` | Default workflow scope |
| `amadeus-aidlc.defaultDepth` | `"standard"` | Default depth level |
| `amadeus-aidlc.defaultTestStrategy` | `"standard"` | Default test strategy |
| `amadeus-aidlc.autoDetectSetup` | `true` | Prompt setup on workspace open |
| `amadeus-aidlc.autoCheckUpdates` | `true` | Check for updates on startup |
| `amadeus-aidlc.showWelcomeOnStartup` | `true` | Show the welcome page on first activation |
| `amadeus-aidlc.showProgressNotifications` | `true` | Show toasts on stage transitions |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, follow [SECURITY.md](SECURITY.md). By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
