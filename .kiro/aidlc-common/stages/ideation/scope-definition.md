---
slug: scope-definition
phase: ideation
execution: ALWAYS
condition: Always executes — defines the scope boundary and prioritized backlog
lead_agent: aidlc-product-agent
support_agents:
  - aidlc-delivery-agent
mode: inline
summary_confirmation: required
produces:
  - scope-document
  - intent-backlog
  - scope-definition-questions
consumes:
  - artifact: intent-statement
    required: true
  - artifact: feasibility-assessment
    required: false
  - artifact: constraint-register
    required: false
requires_stage:
  - intent-capture
  - feasibility
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
  - mvp
inputs: Intent statement, feasibility assessment, constraint register
outputs: scope-document.md, intent-backlog.md, scope-definition-questions.md (under this stage's record dir, engine-resolved)
---

# Scope Definition & Prioritization

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Step 1: Load Agent Personas

Load aidlc-product-agent persona from `agents/aidlc-product-agent.md` and knowledge from `.kiro/knowledge/aidlc-product-agent/`.

### Step 2: Load Prior Context

- Read intent statement from `<record>/ideation/intent-capture/`
- Read feasibility assessment from `<record>/ideation/feasibility/` (if exists)
- Read constraint register and RAID log (if exist)

### Step 3: Generate Clarifying Questions

Create `<record>/ideation/scope-definition/scope-definition-questions.md` with questions:
- What is the minimum viable scope that delivers value?
- What capabilities are must-have vs. nice-to-have?
- What are the dependencies between capabilities?
- What is the sequencing preference (risk-first, value-first, dependency-first)?
- Are there hard deadlines tied to specific capabilities?
- Is the scope, roadmap, or backlog for this initiative already captured in a
  **Confluence page** (a PRD, roadmap, or in/out-of-scope boundary) or a
  **Jira ticket** (an epic with child stories or acceptance criteria) we should
  read (strictly read-only) to ground the scope and backlog? Reading what you
  already maintain beats re-describing it. Point us at a Confluence page URL or
  a Jira key (e.g. `PROJ-123`); naming one authorizes reading it. Do NOT
  classify the source yourself — Step 5 detects Jira vs Confluence from the
  reference and reads it read-only through the MCP Gateway. This question MUST
  include an explicit `None` / `Not applicable` option; naming nothing simply
  skips that read and proceeds from the answers and upstream artifacts alone.

Follow stage-protocol.md question flow.

### Step 4: Collect and Analyze Answers

Run ambiguity detection, contradiction analysis, and scope-vs-timeline validation.

### Step 5: External Reference Reading (read-only)

Run this step ONLY when, in Step 3, the user named a Confluence page or Jira
ticket (naming it authorizes reading it). If the user chose `None` /
`Not applicable`, skip to Step 6 and proceed from the answers and upstream
artifacts alone. Full recipe, routing, golden rules, and hygiene are in
`.kiro/knowledge/aidlc-shared/jira-confluence-ingestion.md` — load it
before starting.

Reading is strictly **read-only**: never write to, comment on, transition, or
otherwise modify any Jira issue or Confluence page, and never search or walk to
linked/child items — read ONLY the exact ticket/page the user named. Detect the
source per reference and read it read-only through the MCP Gateway — never ask
the user which system it is:
- A Jira key (`PROJ-123`) or `*.atlassian.net/browse/...` URL → read the issue
  read-only via the Jira MCP tools (epic acceptance criteria, child stories,
  priority/MoSCoW signals, target release).
- A Confluence page URL (`/wiki/...`, `/pages/...`) → read the page via
  `atlassian_getConfluencePage` (PRD, roadmap, in/out-of-scope boundary).

If the gateway tools are not provisioned or the user is not signed in, ask the
user to paste the content and proceed — never block the stage.

**Capture as evidence.** Write the raw pull to
`<record>/ideation/scope-definition/reference-evidence.md`, headed with the
exact reference and resolved identifier (Jira key or Confluence page id/title),
and cite each source you rely on with `[jira:<KEY>]` or `[<page title>](<url>)`.

### Step 6: Generate Artifacts

Create scope definition document (in/out boundary), prioritized intent backlog (proto-Units using MoSCoW/WSJF/RICE), and value stream map.

Fold any Step 5 reference evidence into these artifacts: PRD/roadmap scope
boundaries and an epic's acceptance criteria into the scope document, and
prioritized or child stories into the intent backlog. Cite each with
`[jira:<KEY>]` or `[<page title>](<url>)`. When Step 5 was skipped, the scope
rests on the answers and upstream artifacts alone.

### Step 7: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage scope-definition --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 8: Present Completion & Request Approval

Completion emoji: :dart:
Review path: `<record>/ideation/scope-definition/`
Standard approval gate (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/ideation/scope-definition/`.

The imported sensors check those outputs:

- **`required-sections`** verifies the output contains the registry default (≥2 H2 headings). Failure mode: missing headings emit `SENSOR_FAILED` with detail at `<record>/.aidlc-sensors/<stage-slug>/required-sections-<iso>.md`.
- **`upstream-coverage`** verifies the output prose references each artefact declared in this stage's `consumes:` frontmatter. Failure mode: missing upstream references emit `SENSOR_FAILED` listing each unreferenced artefact (this stage consumes `intent-statement`, `feasibility-assessment`, `constraint-register`).

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
