---
slug: refined-mockups
phase: inception
execution: CONDITIONAL
condition: Execute when user-facing UI exists and rough mockups were produced in Ideation; for APIs, refine interaction diagrams
lead_agent: aidlc-design-agent
support_agents:
  - aidlc-product-agent
mode: inline
summary_confirmation: required
reviewer: aidlc-product-lead-agent
reviewer_max_iterations: 2
produces:
  - mockups
  - interaction-spec
  - design-system-mapping
  - accessibility-checklist
  - refined-mockups-questions
consumes:
  - artifact: wireframes
    required: true
  - artifact: user-flow
    required: true
  - artifact: stories
    required: false
  - artifact: requirements
    required: true
  - artifact: team-practices
    required: false
requires_stage:
  - user-stories
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
  - mvp
  - workshop
  - classic
inputs: Rough mockups from rough-mockups stage, user stories from user-stories stage, requirements from requirements-analysis stage
outputs: mockups.md, interaction-spec.md, design-system-mapping.md, accessibility-checklist.md, refined-mockups-questions.md (under this stage's record dir, engine-resolved)
---

# Refined Mockups & UX Design

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Step 1: Load Agent Personas

Load aidlc-design-agent persona from `agents/aidlc-design-agent.md` and knowledge from `.kiro/knowledge/aidlc-design-agent/`.

### Step 2: Load Prior Context

- Read rough mockups from `<record>/ideation/rough-mockups/` (if exists)
- Read user stories from `<record>/inception/user-stories/`
- Read requirements from `<record>/inception/requirements-analysis/`

The workshop scope skips rough-mockups by design (no Ideation phase); when the wireframes and user-flow inputs are absent, design the refined mockups directly from the user stories and requirements — never invent the content of a missing artifact.

**Optional — Confluence context (via the MCP Gateway).** If the user pastes a
Confluence link — or confirms they keep a relevant page after you ask a single,
skippable question (only when gateway MCP tools are available) — fetch that exact
page through the gateway to align the mockups with existing conventions (e.g.
design-system & component-library pages, brand/UX guidelines, accessibility
standards). This is opt-in and human-pointed: read ONLY the page the user
supplies — never search a space or open other/linked pages — cite any page you
rely on by title and URL, and if no page is provided or the tools are absent,
design from the inputs above — never block. See
`.kiro/knowledge/aidlc-shared/confluence-mcp.md`.

### Step 3: Generate Clarifying Questions

Create `<record>/inception/refined-mockups/refined-mockups-questions.md` with questions:
- How should each user story be represented in the UI?
- What interaction patterns are needed (modals, inline edits, wizards, progressive disclosure)?
- What states must each screen handle (loading, empty, error, success, partial)?
- Does the design align with the existing design system / component library?
- What accessibility requirements apply (WCAG level)?
- What responsive breakpoints are needed?
- For APIs: what does the developer experience look like?

Follow stage-protocol.md question flow.

### Step 4: Collect and Analyze Answers

Validate design decisions against user stories and requirements for consistency.

### Step 5: Generate Artifacts

Create mid-to-high fidelity mockups (per user story/screen), interaction specification document (use `.kiro/knowledge/aidlc-design-agent/component-spec-template.md` as the format for component-level specifications), design system mapping, responsive behavior specification, and accessibility compliance checklist.

For non-UI: create API developer experience specification.

### Step 5b: Optional — publish to Confluence (only if the user insists)

Skip this step by default. Run it ONLY when the user, in this stage, explicitly
asks to publish/write the mockups to a Confluence page — never offer it as a
routine step and never write as a side effect of reading a page. This is the one
AIDLC stage that may write to Confluence; the write is opt-in, human-pointed, and
gated:

- The user names the destination — an existing page to update
  (`atlassian_updateConfluencePage`) or a space/parent for a new page
  (`atlassian_createConfluencePage`). Never guess a target or touch a page the
  user did not name.
- Before writing, show the destination and the page's title + section outline
  and get an explicit yes; a write is its own approval gate and is never
  auto-approved.
- Publish readable content (title + headings mirroring the artifacts), never
  secrets or raw file paths, then cite the created/updated page by title and URL
  (`[<page title>](<url>)`) in this stage's output.
- If the write tools are absent, the user is not signed in, or the call fails,
  keep the local artifacts, say the publish did not happen, and proceed — a
  skipped or failed publish is never a stage failure.

Full contract: `.kiro/knowledge/aidlc-shared/confluence-mcp.md`
("Writing refined mockups back to Confluence").

### Step 6: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage refined-mockups --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 7: Present Completion & Request Approval

Completion emoji: :art:
Review path: `<record>/inception/refined-mockups/`
Standard approval gate (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/inception/refined-mockups/`.

The imported sensors check those outputs:

- **`required-sections`** verifies the output contains the registry default (≥2 H2 headings). Failure mode: missing headings emit `SENSOR_FAILED` with detail at `<record>/.aidlc-sensors/<stage-slug>/required-sections-<iso>.md`.
- **`upstream-coverage`** verifies the output prose references each artefact declared in this stage's `consumes:` frontmatter. Failure mode: missing upstream references emit `SENSOR_FAILED` listing each unreferenced artefact (this stage consumes `wireframes`, `user-flow`, `stories`, `requirements`, `team-practices`).

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
