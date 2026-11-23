# SonarQube via the MCP Gateway (Inception + Construction)

SonarQube is an **optional** code-quality and code-security evidence source.
When a project is already analyzed on a SonarQube Server, three stages can read
that analysis through the SonarQube tools on the **`mcp-gateway`** MCP server and
fold it into their work:

- **`reverse-engineering` (2.1, Inception, brownfield only)** reads the existing
  quality *baseline* — quality gate, coverage, tech-debt, bug/smell/vulnerability
  counts, and security hotspots via `sonar_get_component_measures` + the issue/
  gate/hotspot tools — and the architect folds it into `code-quality-assessment.md`
  so the codekb records real metrics, not inferred signals. **Read-only**,
  attempted automatically per repo, with a silent fallback.
- **`code-generation` (3.2)** reads the project's *characteristic rules* — the
  rules its code actually trips — and feeds them to the developer agent as
  guidance, so generated code avoids the exact smells and vulnerabilities the
  project's quality profile enforces. This is **read-only** and runs
  **automatically on every code-generation run** — it is not opt-in and must not
  wait for the user to request it — with a silent fallback when SonarQube is
  unreachable.
- **`build-and-test` (3.6)** can *optionally* pull the recent SonarQube findings
  for the project (from open pull requests / analyzed branches) and offer to fix
  them. This is **opt-in**, and any code change to fix a finding requires
  explicit user confirmation.

AIDLC reaches SonarQube through the **`mcp-gateway`** MCP server — the single,
unified Amadeus gateway that also fronts Confluence, Jira, and GitHub — declared
in `.kiro/settings/mcp.json`. The SonarQube tools are exposed there
under a **`sonar_`** prefix (e.g. `sonar_search_my_sonarqube_projects`), so they
never collide with the gateway's `github_*` tools. It never scans code locally
and never triggers a scan — it only *reads* analysis that already exists on the
Server. Everything here works over the remote gateway because no workspace mount
or local analyzer is required.

This is a **convenience, not a dependency**. Every Construction stage produces
the same artifacts without SonarQube. Treat it as one more evidence source that
enriches a stage when the gateway is reachable and a matching project exists, and
is silently skipped otherwise.

## What the gateway exposes (read-only reporting, no local scan)

The SonarQube tools on the gateway are **reporting tools that query
already-scanned data**, not a local analyzer. These stages use a small
read-only set (no write/status tool is ever granted):

- `sonar_search_my_sonarqube_projects` — resolve a repo/project name to a project key.
- `sonar_search_sonar_issues_in_projects` — issues (bugs, vulnerabilities, code
  smells); each carries a `rule` / `ruleKey`, severity, component, and message.
- `sonar_show_rule` — full detail for a rule key: description, severity, impacts, and
  compliant/noncompliant code examples.
- `sonar_get_project_quality_gate_status` — the gate verdict and its conditions
  (metric, threshold, actual value).
- `sonar_search_security_hotspots` — security hotspots (category, probability, status).
- `sonar_get_component_measures` — aggregate metrics (coverage, bugs, code smells,
  vulnerabilities, security-hotspot count, tech-debt, duplication, ncloc). Used
  by `reverse-engineering` for the quality baseline.
- `sonar_search_files_by_coverage` — the least-tested files/modules (the "where"
  behind the aggregate coverage number). Used by `reverse-engineering` to name
  which areas lack tests.
- `sonar_list_pull_requests` / `sonar_list_branches` — analysis contexts for PR-
  or branch-scoped reads.

Grant surface (least-privilege, per agent):
- The **conductor** (`aidlc.json`) carries the seven tools the inline/Construction
  reads need (all of the above except `sonar_get_component_measures` and
  `sonar_search_files_by_coverage`).
- The **developer agent** (`aidlc-developer-agent.json`) carries those seven
  **plus `sonar_get_component_measures` and `sonar_search_files_by_coverage`**,
  because it runs both `code-generation` (dispatched) and the
  `reverse-engineering` scan, which needs the aggregate measures and the
  least-tested-files breakdown.

The gateway exposes yet other SonarQube reporting tools (duplications, per-hotspot
detail); these stages do not use them and they are not granted. There is also
**no** tool that enumerates a full quality profile or lists rules by language.
The only way to obtain project-relevant rule guidance is to derive the fired rule
set from `sonar_search_sonar_issues_in_projects` and expand each unique key with
`sonar_show_rule`. A project with no prior scan yields nothing to derive from —
take the fallback.

## Resolving the project key (never guess)

A repo name is not a SonarQube project key — the keys are namespaced and rarely
match the repo name (e.g. `vsc.vscode-tts-test-adapter:VSC`,
`com.amadeus.x:y:Z`). Resolve the key in this order and stop at the first hit:

1. **Explicit key.** If the user supplies a SonarQube project key, use it.
2. **Recorded key.** If a prior run recorded `SonarQube project key: <key>` in
   `aidlc/spaces/<active-space>/memory/project.md`, reuse it — do not re-resolve
   or re-ask.
3. **The repo's own SonarQube config (the authoritative in-repo source).** A
   SonarQube-integrated repo almost always declares its key in a committed file.
   Read it from the workspace before searching — this is exact, not a guess:
   - `sonar-project.properties` (or `.sonarcloud.properties`) →
     `sonar.projectKey=<key>` (also note `sonar.host.url` / `sonar.organization`
     if present).
   - Maven `pom.xml` → `<sonar.projectKey>` (or a `<properties>` entry).
   - Gradle `build.gradle` / `build.gradle.kts` → a
     `property "sonar.projectKey", "<key>"` line.
   - CI configs as a fallback source of the flag: `Jenkinsfile`,
     `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml` — look
     for `sonar.projectKey=` or `-Dsonar.projectKey=`.
   Search for these with the repo-scoped read tools (e.g. grep the workspace for
   `sonar.projectKey`). When a key is found, **verify it exists on the Server**
   with `sonar_search_my_sonarqube_projects` (query the key) before using it; if
   the Server has no such project, treat it as no match and fall back.
4. **Name search (last resort).** Only when steps 1–3 yield nothing, derive a
   seed from the git remote basename (`git remote get-url origin`, strip `.git`)
   or the repo directory name and call `sonar_search_my_sonarqube_projects` with
   it.
   - **Exactly one match** — confirm it with the user, then use its key.
   - **Multiple matches** — present the `key + name` candidates and let the user
     pick (or skip). A bare name can match many projects, so never auto-pick.
   - **No match** — the project is not analyzed on this Server; take the fallback.
5. **Persist.** Once a key is confirmed (any of steps 3–4), record it as
   `SonarQube project key: <key>` in `project.md` so later units and the
   build-and-test stage reuse it silently.

Never treat an AIDLC logical id or a bare repo name as a SonarQube project key,
and never run a project-scoped read against a guessed or unverified key.

## Readiness: detect by attempting, not by introspection

Do **not** try to reason about whether the sonar tools are "connected" on the
gateway and skip on doubt — an agent cannot reliably introspect its own MCP
wiring, and guessing "probably not available" is exactly how the read gets
wrongly skipped. Instead, **issue the call** (start with
`sonar_search_my_sonarqube_projects` during key resolution). If the `sonar_*`
tools are not available at all, the call simply cannot be made — treat that as
unavailable and fall back. If a call errors (unreachable, token missing/rejected)
or resolution finds no project, fall back. Otherwise proceed. Never ask the user
to install or configure anything at runtime, and never make the user request the
read — for `code-generation` it is automatic.

The older phrasing of this as a pre-check is deprecated; the checks below are
the fallback triggers, evaluated from real call results, not a reason to avoid
calling:

1. **Tools not available** — a `sonar_*` (mcp-gateway) tool call cannot be issued
   at all in this session (the tools are absent). Fall back.
2. **Unreachable / unauthorized** — a call errors (gateway unreachable, token
   missing or rejected). Fall back.
3. **No project resolves** — key resolution (above) yields nothing. Fall back.

When one of these fires, select the fallback and stop calling the sonar tools for
this stage. Absent any of them, do the read.

## Graceful fallback (never block)

When the sonar tools are unavailable, the gateway is unreachable or unauthorized,
or no matching project exists, the stage proceeds exactly as it would without the
integration — from the artifacts it already consumes. **A missing SonarQube
connection is never an error and never a gate.** Concretely:

- The stage **must not fail, stall, or block its approval gate** because a
  SonarQube read was skipped. Attempting the read is required; the read
  *succeeding* is not.
- **A repo that simply is not analyzed on the SonarQube Server is a NORMAL,
  expected case** — treat "no matching project" as a clean skip, never as an
  error or a blocking warning.
- Do not ask the user to configure or authenticate anything at runtime, and do
  not treat absent findings as a missing input. The stage's sensors check its
  declared artifacts, not SonarQube, so skipping never fails a sensor.

**Always report the outcome to the user (every path).** Success or skip, surface
one short, plainly-worded status line so the user knows what happened — never
fail silently and never present a skip as an error. Name the reason on a skip
(sonar tools not available / no matching project on the Server / gateway
unreachable or token rejected) and, on success, the project key, rule/finding
count, and the last analysis date.

## Freshness caveat

Every read reflects the **last scan on the Server**, not the code currently in
the workspace. So SonarQube data is baseline, guidance, and gate-awareness — it
does **not** grade uncommitted changes. When surfacing findings, note the last
analysis date where it matters and treat the live code as the source of truth
over a stale dashboard.

## Read discipline (code-generation)

- **Read-only.** `code-generation` uses only the reporting tools above. It never
  calls a status-change/write tool.
- **Derive, cap, and cache.** Collect fired rule keys from the project's issues,
  rank by severity and frequency, cap to a top-N (≈10–15) plus all
  `VULNERABILITY`-type rules, and expand each with `sonar_show_rule` once. Do not
  call `sonar_show_rule` hundreds of times.
- **Guidance, not a gate.** The rule guidance is context injected into the
  developer agent's brief. It does not add an approval gate and never blocks
  generation.

## Write discipline (build-and-test — opt-in, confirm every change)

- **Opt-in.** The SonarQube-findings step in `build-and-test` runs only when the
  user asks for it at the stage's structured question. Default is off.
- **Reading findings is safe; changing code is not.** Pulling issues, PRs, and
  gate status is read-only. **Fixing** a finding edits the codebase — never do it
  without explicit user confirmation of the specific fixes to apply. Present the
  findings, let the user choose which (if any) to fix, and confirm before
  editing.
- **Status-change tools stay gated.** The SonarQube status-change tools (e.g.
  `change_sonar_issue_status`, `change_security_hotspot_status`) mutate shared
  SonarQube state. They are not granted to any AIDLC agent and are not used by
  these stages; if ever invoked, they surface for approval (never auto-approved).
- **Cite what you read.** Record the project key, the branch/PR the findings came
  from, and the last analysis date in the stage output so the record is
  traceable.
