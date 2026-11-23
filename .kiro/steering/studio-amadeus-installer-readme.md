---
inclusion: auto
name: amadeus-aidlc-installer-readme
description: Official Amadeus AI-DLC 2.10 README (machine install, project configure, update, legacy 2.5, versioning, plugins). Use when changing AIDLC Studio install, setup, update, doctor, version-check, or harness logic for the Amadeus variant.
---

# Amadeus AI-DLC 2.10 README (authoritative reference)

Source: the README of the private repo `Amadeus-xDLC/amadeus-aidlc`, pasted by the user. The repo is SSO-gated, so this copy is the only readable source. AIDLC Studio's Amadeus install/update behavior must match it exactly. When this file and older code comments disagree, this file wins.

## 1. Set up your machine

macOS / Linux (bash, process substitution, so it must run under bash):

```bash
bash <(curl -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.sh)
```

Windows (PowerShell, NOT as administrator):

```powershell
$f = Join-Path $env:TEMP "install-aidlc.ps1"; curl.exe -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.ps1 -o $f; powershell -ExecutionPolicy Bypass -File $f; Remove-Item $f
```

This sets up the machine, not a project. It installs whatever is missing:

- Git and Bun.
- The `aidlc` command, with the Amadeus plugins built in.
- Python 3.10 to 3.14 and EVE, the security scanner the sdl gate needs (Amadeus network and SSO access required). It then offers to set up your AMAIISDOM credentials for EVE.

Everything is added to PATH. Afterwards, open a new terminal (macOS / Linux), or quit and reopen Kiro or VS Code (Windows).

| Option (bash) | Option (PowerShell) | Effect |
|---|---|---|
| `--preview` | `-Preview` | Install the latest preview build. Leave it out for the latest release. |
| `--version 2.10.0-1a.1.0.0` | `-Version 2.10.0-1a.1.0.0` | Install an exact build. |
| `--skip-aidlc`, `--skip-bun`, `--skip-eve`, `--skip-credentials` | `-SkipAidlc`, `-SkipBun`, `-SkipEve`, `-SkipCredentials` | Skip a step. |
| `--legacy` | `-Legacy` | Install the legacy 2.5 into a project instead. See Legacy 2.5. |

AIDLC Studio does not support the preview channel, so it never passes `--preview` / `-Preview`.

## 2. Configure a project

From the project root, pick the harness you use:

```bash
cd /path/to/your-project
aidlc config --harness kiro-ide
aidlc doctor
```

- `kiro-ide`: Kiro IDE. Use `kiro` for Kiro CLI, or `copilot` for GitHub Copilot in VS Code.
- `aidlc config` without `--harness` starts the interactive setup.
- Run it once in every project you want to use AI-DLC in.
- If `aidlc doctor` reports that `aidlc` resolves only through the interactive PATH, run `aidlc config runtime` so the IDE's hook shells find it too.

## 3. Start a workflow

In your harness chat, run `/aidlc-express <your intent or use case>`. AI-DLC picks a workflow from the request, asks for missing decisions, and stops at approval gates. Run `/aidlc --doctor` in chat if something looks off.

If you skipped the credentials prompt, run `eve credentials amaiisdom <your-username>` before the first workflow. Opengrep scans need it.

## MCP servers setup

Install the Amadeus AI-DLC MCP collection from AIPH. It sets up the MCP servers for Jira, Confluence, GitHub, SonarQube and ALM Octane.

## Updating

`aidlc update` (or `aidlc use <build>`) updates the CLI only. Projects keep their files until you refresh them. Refresh each project between workflows, from its root:

```bash
aidlc config --dry-run   # shows what would change
aidlc config
```

This updates the AI-DLC and plugin files to the active build. Workflow records under `aidlc/` are kept, and a file you edited locally is reported as a conflict instead of being overwritten. Start a new chat session afterwards so the agent picks up the new files.

`aidlc update` follows releases. To follow previews too, run `aidlc config --channel preview` once (`aidlc config --channel stable` switches back), or `aidlc update --channel preview` for a single run. (AIDLC Studio does not support preview.)

## Installing the legacy Amadeus AI-DLC 2.5

Use this only when a project has to stay on 2.5, for example to finish a workflow that was started on 2.5. For anything new, use the Quick start. AIDLC Studio does not drive this path.

The same installer installs 2.5 with `--legacy`. Unlike the default mode, it works on a project: run it from the project root, or pass `--target`.

macOS / Linux:

```bash
cd /path/to/your-project
bash <(curl -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.sh) --legacy
```

Windows (PowerShell):

```powershell
cd C:\path\to\your-project
$f = Join-Path $env:TEMP "install-aidlc.ps1"; curl.exe -fsSL https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/scripts/install-aidlc.ps1 -o $f; powershell -ExecutionPolicy Bypass -File $f -Legacy; Remove-Item $f
```

It works the way the 2.5 installer did:

- Asks which harness to install: Kiro IDE, Kiro CLI or GitHub Copilot (VS Code).
- Copies the 2.5 harness files into the project and lists them in an install manifest. Kiro IDE and Kiro CLI: `.kiro/`, listed in `.kiro/.aidlc-install-manifest`. GitHub Copilot: `.aidlc/` and `.github/`, listed in `.aidlc/.aidlc-install-manifest`; it also adds the Amadeus MCP servers as `.vscode/mcp.json`, but only when the project has none yet.
- Creates the `aidlc/` workspace, or keeps the existing one.
- Adds the Amadeus AI-DLC section to `AGENTS.md` and keeps the rest of the file.
- Installs Git, Bun, Python and EVE if missing, offers to set up the EVE credentials, then runs the 2.5 doctor.

It does not install the `aidlc` command, because 2.5 hooks run on Bun. The 2.5 archive (AI-DLC 2.5.67 for Kiro, 2.5.69 for Copilot) is downloaded from `generic-prod-aidlc-nce/amadeus-aidlc/legacy/2.5/amadeus-aidlc.zip` and checked against a pinned SHA-256.

| Option (bash) | Option (PowerShell) | Effect |
|---|---|---|
| `--target <dir>` | `-Target <dir>` | Project directory. Defaults to the current directory. |
| `--archive <zip>` | `-Archive <zip>` | Use a local 2.5 `amadeus-aidlc.zip` instead of downloading. |
| `--uninstall` | `-Uninstall` | Remove the 2.5 files and the AGENTS.md section. `aidlc/` and `.vscode/mcp.json` are kept. |
| `--skip-doctor` | `-SkipDoctor` | Do not run the 2.5 doctor. |
| `--skip-bun`, `--skip-eve`, `--skip-credentials` | `-SkipBun`, `-SkipEve`, `-SkipCredentials` | Skip a step. Bun is still required for 2.5. |

Limits:

- For GitHub Copilot, set `JIRA_PAT` in your environment so the MCP servers in `.vscode/mcp.json` can authenticate.
- `--legacy` refuses a project that is already set up with `aidlc config` (2.10).
- Rerun the same command to repair an install. The AGENTS.md section is replaced, not duplicated.
- When the project is ready to move on, follow "Upgrading from 2.5 to 2.10". `aidlc config` recognises an install made with `--legacy`.

## Upgrading from Amadeus AI-DLC 2.5 to 2.10

2.5 was copied into each project by an installer script. 2.10 is a command, `aidlc`, that you install once on your machine and then use to set up each project.

| Step | What you do | Where |
|---|---|---|
| 1 | Finish the 2.5 workflows you still need | Each project |
| 2 | Install the `aidlc` command | Once per machine |
| 3 | Commit the project to git | Each project |
| 4 | Archive the workflows you won't finish | Each project |
| 5 | Run `aidlc config` | Each project |
| 6 | Delete the 2.5 git pre-commit hook | Each clone of the project |
| 7 | Migrate the legacy hooks | Each project |
| 8 | Create the first 2.10 intent from the terminal, check with `aidlc doctor`, and start a new chat | Each project |

1. Finish the 2.5 workflows you still need. A workflow started on 2.5 cannot be continued on 2.10: 2.10 reorganised the stages, so a 2.5 record no longer matches them. `aidlc config` does not check for this and will not warn you. Finish what you need on 2.5; archive the rest in step 4 (the record stays on disk, it just leaves the active list; restart the work as a new intent on 2.10 if you want it later).
2. Install the `aidlc` command: run "Set up your machine", open a new terminal, and check `aidlc --version`. This changes nothing in your projects; 2.5 keeps working until step 5.
3. Commit the project to git. IMPORTANT: the upgrade removes and replaces the AI-DLC files (`.kiro/` on Kiro, `.aidlc/` and `.github/` on Copilot), including any edits you made to them. Commit first so you can review with `git diff`. If the project is not a git repo yet, run `git init` and commit.
4. Archive the workflows you won't finish. From the project root: `aidlc engine intent list`, then `aidlc engine intent archive your-intent --reason "started on Amadeus AI-DLC 2.5"`. The reason is free text. To bring an intent back: `aidlc engine intent unarchive your-intent`. (If the project has more than one space, see the README's multi-space note.)
5. Run `aidlc config`. Preview with `aidlc config --dry-run` (touches nothing), then `aidlc config` (asks before changing anything). It recognises the 2.5 setup, including one made with `--legacy`, lists what it will remove and keep, and asks once: "Remove the 2.5 install and set up kiro-ide? [y/N]". Answer y. Add `--harness kiro` or `--harness copilot` for a different harness. Kept: the `aidlc/` folder (workflow records, CodeKB, memory and knowledge you added), your MCP settings (`mcp.json`), every file you created yourself. Removed: the files the 2.5 installer added (including your edits to them) and the Amadeus AI-DLC section of `AGENTS.md`.
6. Delete the 2.5 git pre-commit hook. 2.5 ran its EVE scan from `.git/hooks/pre-commit`. In 2.10 the scan is a sensor (`sdl-coverage`, from the sdl plugin) that runs at the build-and-test gate. `aidlc config` removes the 2.5 scanner but not the hook, so `git commit` fails with `eve-sdl-precommit.sh: No such file or directory`. Delete `.git/hooks/pre-commit` if it is the 2.5 hook (it mentions `eve-sdl-precommit`). If `core.hooksPath` is set (`git config core.hooksPath`), the hook is in that folder. If you added your own checks, delete only the line that runs `eve-sdl-precommit.sh`. Every developer must do this in their own clone.
7. Migrate the legacy hooks. If your IDE offers to migrate legacy hooks to the new format, accept, then reload the window (Kiro IDE: Agent Hooks, "Migrate legacy hooks to the new format").
8. Create the first 2.10 intent and check. After `aidlc config` the active intent is still a 2.5 one (a completed intent cannot be archived), so `aidlc doctor` and `/aidlc` stop with an "incompatible workflow state" error. Create the first 2.10 intent from the terminal, not the chat:

```bash
aidlc engine intent create --scope <scope> --label "<short name>" --arguments "<what to do>"
aidlc engine intent list   # the new intent is marked with *
aidlc doctor               # passes, no incompatible workflow state error
```

Then start a new chat session and continue with `/aidlc`. Work you did not finish on 2.5 is restated as a new intent. Your `aidlc/` folder stays in place. If `aidlc doctor` still fails with an incompatibility error, follow the README's incompatibility steps.

## Versioning

A release version looks like `2.10.0-1a.1.0.0`:

| Part | Meaning |
|---|---|
| `2.10.0` | The AI-DLC core version the build uses (AIDLC_PIN). |
| `1a` | Marks an Amadeus build. |
| `1.0.0` | The Amadeus version: MAJOR.MINOR.PATCH. |

A preview adds `-preview.<N>`: `2.10.0-1a.1.0.0-preview.3` is the 3rd preview of 1.0.0. It ranks below the release.

The Amadeus version is bumped automatically from Conventional Commits since the last release (semantic-release, see `.releaserc`):

| Commit | Bump |
|---|---|
| `feat!:` or a `BREAKING CHANGE:` footer | MAJOR |
| `feat:` | MINOR |
| `fix:`, `perf:`, `revert:` | PATCH |
| Anything else (`chore:`, `docs:`, `ci:`, ...) | None. If that's all there is since the last release, nothing is built. |

What gets published:

| How | Publishes | Example |
|---|---|---|
| Push to any branch | Preview | `2.10.0-1a.1.0.0-preview.3` |
| Manual run of "Build and publish AI-DLC plugins" on main with release checked, approved on the release environment | Release and a draft GitHub release | `2.10.0-1a.1.0.0` |

Every build is tagged `v<version>`, for example `v2.10.0-1a.1.0.0`. Previews count up (`-preview.1`, `-preview.2`, ...) until that version is released. Builds from the old `2.10.0-<N>` and `~preview.<N>` schemes no longer work with the CLI; reinstall with the installer.

Implication for version comparison: Amadeus build components after `1a.` are numeric (`1.10.0` is newer than `1.9.0`), so compare them numerically, never as strings.

## The plugins

Everything Amadeus-specific comes from these plugins: `amadeus`, `amadeus-telemetry`, `sdl`, `octane`, `sonar`.

- amadeus (`plugins/amadeus/`): the Amadeus platform and governance plugin, the one with the widest reach. Amadeus Platform Agent (`agents/amadeus-platform-agent.md`): a platform engineer persona (OpenShift substrate, managed-service catalogue, network reachability, security zones, data residency, CMDB/ITSM readiness); it carries no estate-specific facts and asks the user for them. Agent binding: a deterministic, reversible post-compose step swaps the core Platform Agent for the Amadeus one across infrastructure-design, environment-provisioning, feasibility, nfr-design, contract-design, domain-design, feedback-optimization. Stage contributions across ideation, inception, construction, and operation. Audit trail: an `amadeus-audit-reconcile` PostToolUse hook plus `amadeus-audit-view.ts` render a human-readable digest of gate approvals. MCP tool grants (Kiro CLI): grants the mcp-gateway (Jira, Confluence, GitHub, SonarQube) and Octane tools per agent; the servers themselves are not provisioned, each developer configures them in their own `mcp.json`.
- amadeus-telemetry (`plugins/amadeus-telemetry/`): per-intent adoption telemetry. Requires `amadeus`. Each intent gets an `amadeus-telemetry/` folder in its record with `telemetry.json` and a rendered `telemetry.md`. Updates as a delta via a per-shard cursor. An advisory, never-failing gate sensor on requirements-analysis and build-and-test, plus a PostToolUse shell hook that runs the same collector (`aidlc engine hook amadeus-telemetry-reconcile`).
- sdl (`plugins/sdl/`): Amadeus security scanning (EVE) wired into build-and-test. Runs local-only EVE secrets + Opengrep scans as a stage step. Wires a BLOCKING, gate-fired `sdl-coverage` sensor: a secret finding (or an unrunnable scan) fails the stage gate; Opengrep findings are advisory. Ships the Amadeus SDL knowledge base for the DevSecOps agent.
- octane (`plugins/octane/`): OpenText ALM Octane test management in build-and-test. Opt-in, asked per build. Generates an Octane test set (`amadeus-octane-test-cases.md`, `amadeus-octane-requirement-traceability.md`, `octane-import.json`), creates the tests through the Octane MCP server and reports in `amadeus-octane-push-results.md`. Adds an advisory `octane-format` sensor. Needs the octane MCP server in your own `mcp.json`.
- sonar (`plugins/sonar/`): SonarQube wired into three stages. Reverse engineering reads the SonarQube quality baseline. Code generation fetches the project's characteristic rules (read-only, automatic). Build and test: opt-in review of recent findings, fixes only on confirmation (`sonar-findings.md`, `sonar-fix-results.md`). Served by the shared mcp-gateway MCP server configured in your own `mcp.json`.

## Next steps (from the README)

- Configuring optional and mandatory plugins: let teams choose which plugins are mandatory and which are optional, and enable or disable the optional ones per project.
- Decouple the workspace setup scripts from the workflow: move them out of the workflow and run them as part of setting up the workspace.

## How AIDLC Studio maps to this (maintainer notes)

- Machine install (CLI absent): run the exact section-1 command for the platform in an integrated terminal (Windows: PowerShell, not elevated; macOS/Linux: bash). Do not use `-File <url>`, `irm | iex`, or `curl | sh` for Amadeus. The installer provides Git and Bun, so Studio must not install them first.
- Access gate for Amadeus: the installer URL lives on the Amadeus Artifactory, so "has access" means that URL is reachable from this network, not a GitHub `git ls-remote`.
- Project configure: `aidlc config --harness <kiro-ide|kiro|copilot>` then `aidlc doctor`. Amadeus supports `copilot` (VS Code), not only Kiro.
- PATH for hook shells: `aidlc config runtime` is the official fix when doctor reports an interactive-only PATH.
- CLI update: `aidlc update --check` / `aidlc update`. Workspace update: `aidlc config --dry-run`, then `aidlc config`; tell the user to start a new chat afterwards.
- Legacy 2.5 and the 2.5 to 2.10 upgrade are out of scope for Studio's automated flows. Do not rebuild the retired clone / `dist/<harness>/` path for Amadeus.
- The official `install-aidlc.ps1` ends with a doctor run and throws "AI-DLC doctor reported a problem." when it fails; a failed install can leave the machine with no `aidlc` binary.
