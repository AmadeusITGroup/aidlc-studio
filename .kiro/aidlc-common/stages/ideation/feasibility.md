---
slug: feasibility
phase: ideation
execution: CONDITIONAL
condition: Execute when there are integration constraints, regulatory requirements, or significant technical uncertainty. Skip for trivial changes with no technical risk.
lead_agent: aidlc-architect-agent
support_agents:
  - aidlc-platform-agent
  - aidlc-compliance-agent
mode: inline
summary_confirmation: required
produces:
  - feasibility-assessment
  - constraint-register
  - raid-log
  - feasibility-questions
consumes:
  - artifact: intent-statement
    required: true
  - artifact: competitive-analysis
    required: false
  - artifact: market-trends
    required: false
  - artifact: build-vs-buy
    required: false
requires_stage:
  - intent-capture
  - market-research
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
  - mvp
inputs: Intent statement from intent-capture stage, market research from market-research stage (if executed)
outputs: feasibility-assessment.md, constraint-register.md, raid-log.md, feasibility-questions.md (under this stage's record dir, engine-resolved)
---

# Feasibility & Constraint Analysis

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Step 1: Load Agent Personas

Load aidlc-architect-agent persona from `agents/aidlc-architect-agent.md` and knowledge from `.kiro/knowledge/aidlc-architect-agent/`.
Orchestrator will separately invoke aidlc-platform-agent (target-platform assessment) and aidlc-compliance-agent (regulatory) for their perspectives.

### Step 2: Load Prior Context

- Read intent statement from `<record>/ideation/intent-capture/`
- Read market research from `<record>/ideation/market-research/` (if exists)
- Load guardrails from
  `aidlc/spaces/<active-space>/memory/{org,team,project}.md`

### Step 3: Generate Clarifying Questions

Create `<record>/ideation/feasibility/feasibility-questions.md` with questions:
- What existing systems must this integrate with?
- Are there regulatory/compliance requirements (PCI, HIPAA, SOC2, data residency)?
- What is the team's current tech stack and skill profile?
- What are the budget and timeline constraints?
- Are there organizational blockers (change freeze, competing priorities)?
- What target platform (cloud provider, on-prem, hybrid, or managed PaaS) and infrastructure/tooling are currently in use or mandated?
- Which of those systems — plus any codebase being extended or replaced, or a
  reference implementation — expose a code repository we can inspect to ground
  this assessment? (Some integration targets are third-party SaaS or APIs with
  no readable repo; this question is only about the ones with source we can
  read.) Reading their manifests, CI config, and languages lets us verify the
  real tech stack, integration surface, and version/license constraints instead
  of relying on assumptions. Inspection is **read-only**, and listing a repo
  here is the authorization to read it — flag any repo that is off-limits, or
  paste the details directly instead. List each as a clone URL or an
  `owner/repo` / `project/repo` reference. Do NOT classify the host yourself —
  Step 5 detects it from the reference and picks the access method (GitHub MCP
  vs `git` CLI) automatically.
- Is any feasibility-relevant context — architecture or platform standards, an
  integration/constraints doc, or a dependency/blocker epic — already captured
  in a **Confluence page** or a **Jira ticket** we should read (strictly
  read-only) to ground this assessment? Reading a page or ticket you already
  maintain beats re-describing it from memory. Point us at a Confluence page URL
  or a Jira key (e.g. `PROJ-123`); naming one authorizes reading it. Do NOT
  classify the source yourself — Step 5 detects Jira vs Confluence from the
  reference and reads it read-only through the MCP Gateway. Include an explicit
  `None` / `Not applicable` option here too; naming nothing simply skips that
  read.

This question MUST include an explicit `None` / `Not applicable` option so a
narrow intent never forces an invented repo. Repository inspection runs in
Step 5 only when the user names at least one repo; otherwise Step 5 is skipped
and the stage proceeds from the answers alone.

Follow stage-protocol.md question flow.

### Step 4: Collect and Analyze Answers

Run ambiguity detection and contradiction analysis.

### Step 5: Repository Evidence Gathering (read-only)

Run this step ONLY when the user named at least one repository in Step 3
(listing a repo there is the authorization to read it; skip any repo the user
flagged as off-limits). If no repo was named, skip to Step 6 and proceed from
the answers alone. Full tool list, command set, hygiene, and
source-tagging rules are in
`.kiro/knowledge/aidlc-architect-agent/repo-evidence-gathering.md` —
load it before starting.

Inspection is strictly **read-only**: never write to, branch, or push to any
inspected repository, and never run `git push`.

**Detect the host per repository, then pick the access method — do not ask.**
Infer the host from each reference the user gave:
- GitHub (`github.com`, a `github.*` enterprise host, or a bare `owner/repo`
  that resolves on GitHub) → use the read-only **GitHub MCP
  tools**.
- Any other host (Bitbucket, GitLab, self-hosted, or a plain clone URL) → use
  the **`git` CLI** (read-only).
- If the GitHub MCP tools are not provisioned in this session
  (an unreachable gateway simply leaves them absent), fall back to the read-only
  **`gh` CLI** when it is installed and authenticated (`gh auth status`), then to
  the read-only `git` CLI for that repo, or ask the user to paste the details.
  Record which path was used.

**GitHub repos — via the GitHub MCP tools (read-only).** Pull
feasibility evidence for each repo with these read tools:
- `github_get_file_contents` — read dependency/build manifests (e.g.
  `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`) for the tech stack and version
  constraints, and CI config (e.g. `.github/workflows/*`) for the
  build/test/deploy surface.
- `github_list_commits` — recent commits for the maintenance-cadence signal.
- `github_list_issues` / `github_issue_read` — open issues relevant to
  integration risk.
- `github_get_me` — one-shot reachability check before relying on the tools.
- Do not call any tool that writes (issues, PRs, comments, branches).

**Every other repo — via the `git` CLI (read-only).**
- Shallow-clone into an OS temp directory OUTSIDE the workspace
  (`git clone --depth 1 <url> <tmp>`), never into `aidlc/` or the repo root.
- Read manifests/CI blobs with `git -C <tmp> show HEAD:<path>`; capture the
  resolved commit with `git -C <tmp> rev-parse HEAD` and history/authorship
  with `git -C <tmp> log` for the skill/ownership signal.
- Never `git push`; never add a remote. Leave the temp clone for the OS to reap
  (recursive `rm` is blocked by the tool sandbox).
- If credentials are missing or the clone fails, report it and ask the user to
  paste the relevant details instead — do not block the stage.

**Capture as evidence.** Write raw findings to
`<record>/ideation/feasibility/repo-evidence.md`, and tag every repo-derived
fact with a source marker `[repo:<host>/<owner>/<name>@<sha>]` so the
downstream artifacts remain traceable to an exact commit.

**Jira tickets & Confluence pages — via the MCP Gateway (read-only).** Run this
only when the user named a Jira ticket or Confluence page in Step 3. Full
recipe, routing, golden rules, and hygiene are in
`.kiro/knowledge/aidlc-shared/jira-confluence-ingestion.md` — load it
before starting. Detect the source per reference and read ONLY what the user
named, read-only through the gateway — never search, never write, never walk to
linked or child items:
- A Jira key (`PROJ-123`) or `*.atlassian.net/browse/...` URL → read the issue
  read-only via the Jira MCP tools (constraints, dependencies, blockers,
  non-functional expectations, target versions).
- A Confluence page URL (`/wiki/...`, `/pages/...`) → read the page via
  `atlassian_getConfluencePage` (architecture/platform standards, integration
  or constraint docs, compliance requirements).

Write the raw pull to `<record>/ideation/feasibility/reference-evidence.md`,
headed with the exact reference and resolved identifier, and cite each source
(`[jira:<KEY>]` or `[<page title>](<url>)`). If the gateway tools are absent or
the user is not signed in, ask the user to paste the text and proceed — never
block the stage.

### Step 6: Generate Artifacts

Create feasibility assessment (technical viability, risk analysis), constraint register (technical, organizational, regulatory), and RAID log (Risks, Assumptions, Issues, Dependencies).

Fold any Step 5 repository evidence into these artifacts: observed stack and
versions into the feasibility assessment, version/license/deprecation limits
into the constraint register, and integration dependencies or risks into the
RAID log. Carry the `[repo:...@sha]` source tag on each repo-derived row.

Likewise fold any Step 5 Jira/Confluence reference evidence: stated constraints,
dependencies, and blockers into the constraint register and RAID log, and
architecture/platform/compliance standards into the feasibility assessment.
Cite each with `[jira:<KEY>]` or `[<page title>](<url>)`. When Step 5 was
skipped entirely, note that feasibility rests on user-provided answers only.

The orchestrator will pass these artifacts to aidlc-platform-agent for target-platform and infrastructure-constraint assessment (the platform agent asks the user which platform, hosting model, and IaC tooling apply when the memory layers do not already specify) and aidlc-compliance-agent for regulatory scanning, then synthesize all inputs.

### Step 7: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage feasibility --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 8: Present Completion & Request Approval

Completion emoji: :test_tube:
Review path: `<record>/ideation/feasibility/`
Standard approval gate (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/ideation/feasibility/`.

The imported sensors check those outputs:

- **`required-sections`** verifies the output contains the registry default (≥2 H2 headings). Failure mode: missing headings emit `SENSOR_FAILED` with detail at `<record>/.aidlc-sensors/<stage-slug>/required-sections-<iso>.md`.
- **`upstream-coverage`** verifies the output prose references each artefact declared in this stage's `consumes:` frontmatter. Failure mode: missing upstream references emit `SENSOR_FAILED` listing each unreferenced artefact (this stage consumes `intent-statement`, `competitive-analysis`, `market-trends`, `build-vs-buy`).

## Learn

While running this stage, maintain a running log in
`<record>/<phase>/<stage>/memory.md` (create on stage start if absent).
Append entries under four standard headings:

- **Interpretations** — choices made where the stage prose was ambiguous
- **Deviations** — places you intentionally departed from the stage prose, and why
- **Tradeoffs** — alternatives considered and why you picked what you did
- **Open questions** — anything to confirm before next run, or uncertain context

Format each entry with an ISO 8601 timestamp:
`- 2026-05-20T10:14:32Z — <summary>; <context>`

Before the approval gate, read memory.md and surface candidates as a
structured question. For each entry the user keeps, write to the appropriate
harness destination per `stage-protocol.md` §13 — never to this stage file:

- Prescriptive rule → a practice line under the routed heading in
  `aidlc/spaces/<active-space>/memory/project.md` (default) or `team.md` (promoted)
- Verification check → new manifest at `.kiro/sensors/aidlc-<id>.md`
  (capability descriptor only — no `applies_to`); add the new id to
  the relevant stage's `sensors: [...]` frontmatter list to wire it

Even when nothing surfaces, still ask the mandatory "Anything to add for next time?" question from stage-protocol.md section 13. Do not infer "Nothing to add." Only after the human answers that question may you proceed to the gate. The memory.md
file stays in the artefact directory as part of the stage's permanent record.

Stage files are immutable framework artefacts — the ritual writes into the
harness, not into this file. Next time this stage runs, the new rules and
sensors load automatically.
