---
slug: code-generation
phase: construction
execution: ALWAYS
condition: Always executes for every unit in the execution plan.
lead_agent: aidlc-developer-agent
support_agents: []
mode: subagent
reviewer: aidlc-architecture-reviewer-agent
reviewer_max_iterations: 2
for_each: unit-of-work
workspace_requires: true
produces:
  - code-generation-plan
  - code-summary
optional_produces:
  - sonarqube-rule-guidance
consumes:
  - artifact: business-logic-model
    required: false
  - artifact: business-rules
    required: false
  - artifact: domain-entities
    required: false
  - artifact: performance-design
    required: false
  - artifact: security-design
    required: false
  - artifact: deployment-architecture
    required: false
  - artifact: unit-of-work
    required: true
  - artifact: requirements
    required: true
requires_stage:
  - units-generation
  - functional-design
  - nfr-requirements
  - nfr-design
  - infrastructure-design
sensors:
  - linter
  - type-check
scopes:
  - enterprise
  - feature
  - mvp
  - poc
  - bugfix
  - refactor
  - security-patch
  - workshop
  - classic
  - express
inputs: ALL prior design artifacts for this unit
outputs: application code + code-generation-plan.md, code-generation-questions.md, code-summary.md, sonarqube-rule-guidance.md (when the mcp-gateway sonar tools are reachable and a project resolves; under this stage's per-unit record dir, engine-resolved)
---

# Code Generation

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Critical Rules

- Application code goes to workspace root, NEVER to the record dir
- Brownfield: modify files in-place. NEVER create duplicates like ClassName_modified.java
- Add data-testid attributes to interactive UI elements for test automation

### Step 1: Read All Unit Artifacts

Read all design artifacts for the current unit:
- Functional design from `<record>/construction/{unit-name}/functional-design/` (if exists)
- NFR requirements from `<record>/construction/{unit-name}/nfr-requirements/` (if exists)
- NFR design from `<record>/construction/{unit-name}/nfr-design/` (if exists)
- Infrastructure design from `<record>/construction/{unit-name}/infrastructure-design/` (if exists)
- Application design from `<record>/inception/application-design/` (if exists)
- Unit definition from `<record>/inception/units-generation/unit-of-work.md` (if exists)
- Story map from `<record>/inception/units-generation/unit-of-work-story-map.md` (if exists)
- Requirements from `<record>/inception/requirements-analysis/requirements.md` (if exists)

Incremental scopes (bugfix, poc, refactor, security-patch) skip units-generation and application-design by design; when those inputs are absent, scope the work from the requirements and, on brownfield, the reverse-engineered code knowledge base at `aidlc/spaces/<active-space>/codekb/<repo>/` — never invent the content of a missing artifact.

### Step 2: PART 1 — Planning

Create a detailed code generation plan at `<record>/construction/{unit-name}/code-generation/code-generation-plan.md` with checkboxes for each implementation step. Include story-to-code-step traceability — map each plan step back to the user story it implements.

Plan should cover (as applicable to the unit):
- [ ] Business logic implementation
- [ ] API/endpoint layer
- [ ] Repository/data access layer
- [ ] Database migrations/schema changes
- [ ] Unit tests
- [ ] Integration tests
- [ ] Configuration files
- [ ] Documentation (inline and API docs)
- [ ] Deployment artifacts (Dockerfiles, IaC)

**Test files are MANDATORY in the plan.** Consult the active test strategy (stage-protocol.md §8 "Test Strategy") to determine test scope and volume:
- **Minimal strategy**: Unit test files only, requirement-driven (1 test per requirement, happy-path floor per component)
- **Standard strategy**: Unit test files per component (5-8 tests each) + integration test stubs for key boundaries
- **Comprehensive strategy**: Unit + integration + E2E test files per component (10-15 tests each)

The plan MUST include steps for:
- [ ] Test files appropriate to the active test strategy
- [ ] Test configuration (vitest.config, jest.config, or equivalent)

If the plan presented to the user omits test file steps, add them before presenting. Tests are not deferred to Build and Test — that stage verifies and extends, not creates from scratch.

Number each plan step sequentially (Step 1, Step 2, etc.) for clear execution ordering and traceability.

**Recommended plan structure** (adapt if architecture warrants a different ordering):

```
Step 1: Project structure setup (directories, config files, package.json/Cargo.toml/etc.)
Step 2: Data models / database schema / migrations
Step 3: Business logic layer (core domain logic, services)
Step 4: Business logic tests (unit tests for Step 3)
Step 5: API / endpoint layer (routes, controllers, handlers)
Step 6: API tests (unit + integration tests for Step 5)
Step 7: Repository / data access layer (queries, ORM config)
Step 8: Frontend components (if applicable — UI components, pages, state)
Step 9: Frontend tests (component tests, interaction tests)
Step 10: Configuration and environment setup (.env templates, build config)
Step 11: Test configuration (vitest.config, jest.config, or equivalent)
Step 12: Documentation (inline docs, API docs, README updates)
```

This layer-by-layer approach ensures dependencies are built before dependents (data models before business logic, business logic before API). Deviate when the architecture requires it (e.g., event-driven systems, microservices with independent stacks).

Present a summary of the plan to the user.

### Step 3: Plan Approval

Before presenting the approval, create or update
`<record>/construction/{unit-name}/code-generation/code-generation-questions.md`
with a **Plan Approval** question, both options below, and a blank `[Answer]:`
tag:

- "Approve Plan" — proceed to code generation
- "Request Changes" — revise the plan

Then present that question as a structured question and STOP the turn. Fill the
`[Answer]:` tag only after the human explicitly responds. On "Request Changes",
record that answer, revise the plan, reset the Plan Approval `[Answer]:` to
blank, and present the question again. Do not begin Step 4, dispatch the
developer agent, or infer approval from a forwarding-loop continuation. Only an
explicit "Approve Plan" response authorizes generation.

### Step 3b: Fetch SonarQube rule guidance (read-only, automatic)

Before delegating, gather the project's characteristic SonarQube rules so the
developer agent generates code that respects them. **This step runs
automatically every time this stage executes — it is NOT optional and MUST NOT
wait for the user to ask for it.** Attempt it on every run. It is read-only and
never a gate. Follow `.kiro/knowledge/aidlc-shared/sonarqube-mcp.md`
for the full contract.

> **Note — `sonarqube-rule-guidance` is `optional_produces`, not `produces`.**
> The *attempt* is mandatory but the *artifact* is conditional: it is written
> only when SonarQube is reachable and a project resolves. It is therefore
> declared under `optional_produces:` so it is exempt from the per-unit coverage
> check (`unitCovered` in `aidlc-orchestrate.ts`) — a skipped fetch never leaves
> a unit uncovered. Do NOT move it back to `produces:`; that reintroduces a
> coverage deadlock on every repo with no SonarQube project.

**Detection is by attempting the call, not by introspection.** Do not try to
reason about whether the sonar tools are "connected" on the gateway and then skip — you
cannot reliably introspect that. Instead, proceed to resolve the key and call
the tools below. Skip (take the Fallback) ONLY when a concrete failure occurs:
the `sonar_*` tools are not available at all (the call cannot be issued), the
resolution finds no matching project, or a call errors (server unreachable,
token missing/rejected). Never skip merely because you are unsure the server is
up — issue the call and let the result decide.

**Resolve the project key** using the ordered resolution in the knowledge
guide's "Resolving the project key": explicit key → key recorded in
`project.md` → **the repo's own SonarQube config** (grep the workspace for
`sonar.projectKey` in `sonar-project.properties`, `pom.xml`,
`build.gradle(.kts)`, or CI files, then verify that key via
`sonar_search_my_sonarqube_projects`) → only as a last resort a name search seeded
from the git remote / repo dir (confirm with the user; on multiple matches let
the user pick; on no match take the Fallback). Persist the confirmed key to
`project.md`. Never guess or use an unverified key.

**On success — derive project-relevant rules (read-only):**
1. Call `sonar_search_sonar_issues_in_projects` for the resolved project key.
2. Collect the unique `rule` keys, rank by severity (`BLOCKER`/`CRITICAL`/`HIGH`
   first) and frequency, and cap to a top-N (≈10–15) PLUS every rule whose
   issues are `VULNERABILITY`-type.
3. Expand each unique key once with `sonar_show_rule` to capture its name, severity,
   impact, and compliant/noncompliant examples. Do not call `sonar_show_rule`
   hundreds of times.
4. Optionally call `sonar_search_security_hotspots` to note recurring hotspot
   categories (e.g. command-injection, hard-coded credentials) for the repo.
5. Write `<record>/construction/{unit-name}/code-generation/sonarqube-rule-guidance.md`
   with: the resolved project key, the last analysis date, an H2
   `## SonarQube Rule Guidance` table
   (`| rule | severity | impact | what to avoid | compliant pattern |`), and an
   H2 `## Recurring Security Hotspot Categories` list. Note explicitly that this
   is baseline guidance from the last Server scan, not a grade of the code being
   generated now.

**Best-effort, never blocking.** This read is *attempted* every run but is never
*required* to succeed. When SonarQube is absent, unreachable, or no matching
project exists, do NOT create `sonarqube-rule-guidance.md`; proceed to Step 4
with the inputs already gathered. Specifically:

- It **must not fail, stall, or roll back the stage**, and it **must not affect
  the Step 7 approval gate** (Approve / Request Changes) in any way — a missing
  SonarQube result is never a reason to withhold or block that gate.
- **A project not present on the SonarQube Server is a NORMAL, expected
  outcome**, not an error — plenty of valid repos are simply not scanned. Treat
  it as a clean skip, never as a warning that looks like a blocker.
- It does not affect any sensor (`linter`/`type-check` check code, not SonarQube).

**Always report the outcome to the user (every path).** Whether the fetch
succeeded or was skipped, surface one short, plainly-worded status line so the
user always knows what happened — never fail silently and never dress a skip up
as an error:

- **Success:** e.g. "SonarQube: applied guidance from <N> rules of project
  `<key>` (last scan <date>)."
- **Skipped — not configured:** "SonarQube: skipped — sonar tools not available
  on the mcp-gateway; generating without SonarQube guidance."
- **Skipped — no project:** "SonarQube: skipped — no matching project found on
  the SonarQube Server for this repo; generating without SonarQube guidance."
- **Skipped — unreachable/auth:** "SonarQube: skipped — server unreachable or
  token rejected; generating without SonarQube guidance."

### Step 4: PART 2 — Generation

Before delegating, display to the user:
"Generating code for [N] plan steps. This may take several minutes depending on project complexity. I'll show a summary when complete."

Delegate to Task tool with subagent_type="aidlc-developer-agent".

The aidlc-developer-agent persona and its knowledge are loaded automatically by the named agent. Do NOT manually inject the persona in the prompt.

Include in the delegation prompt:
- As the first line, the exact target marker `AIDLC-UNIT: <directive.unit>` (or
  the current unit name when the single-iteration directive has no `unit`
  field). This marker identifies the one unit whose approved plan authorizes
  the dispatch; do not repeat it for contextual dependencies.
- Design artifacts for the CURRENT UNIT ONLY (not all units)
- A 1-2 line summary of each inception-phase artifact with its file path (requirements summary, stories summary, app design summary) — the subagent can Read specific files if it needs full content
- The approved code-generation-plan.md (full content)
- Project workspace details (languages, frameworks, conventions from aidlc-state.md)
- The SonarQube rule guidance from Step 3b when it was produced (paste the
  `sonarqube-rule-guidance.md` content, or a summary of it), instructing the
  developer to generate code that respects those rules — avoid the listed smells
  and vulnerability patterns, keep within the flagged complexity/size limits, and
  never introduce the recurring security-hotspot categories. Omit this bullet
  entirely when Step 3b was skipped (SonarQube unavailable) — its absence is not
  an error.
- Instructions to execute each plan step sequentially and mark checkboxes as completed

The subagent generates all code, test files, and configuration artifacts in the workspace.

### Step 5: Generate Code Summary

After subagent completes, create `<record>/construction/{unit-name}/code-generation/code-summary.md` documenting:
- Files created/modified
- Key implementation decisions
- Test coverage summary
- Any deviations from the plan

### Step 6: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage code-generation --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 7: Completion

Present completion message and approval gate:

```
# :computer: Code Generation Complete — {unit-name}
```

Summary of code produced (files, tests, key decisions), then:

```
**Review:** `<record>/construction/{unit-name}/code-generation/`
```

Approval gate: strictly 2-option (Approve / Request Changes).

> **Note — orchestrator-managed completion gating.** Step 3 Plan Approval is a mandatory hard stop in every execution mode, including Bolt execution: generation must never begin before the human chooses "Approve Plan". Only the Step 7 completion approval gate is suppressed by the orchestrator during normal Bolt execution. A single Bolt-level gate (or batch-level gate for parallel Bolt batches) covers completion for all Units in the Bolt. The completion gate still exists here for direct-invocation use (e.g., `/aidlc --stage code-generation` re-running a single Unit), and subagents invoked via Task must NOT invoke that completion gate themselves — the orchestrator owns completion-gate presentation across the batch.

## Sensors

This stage produces TypeScript/JavaScript code in the active Bolt
worktree. Generated code lives at the workspace root (NEVER under
the record dir); the planning, plan-approval, and summary artefacts
(`code-generation-plan.md`, `code-generation-questions.md`, `code-summary.md`)
live under `<record>/construction/{unit-name}/code-generation/`.

The imported sensors check the code outputs:

- **`linter`** wraps the project's configured linter (eslint by default).
  Fires on every Write/Edit matching its `matches: "**/*.{ts,js}"` filter.
  Failure mode: lint violations land as `SENSOR_FAILED` audit rows with
  detail at `<record>/.aidlc-sensors/code-generation/linter-<iso>.md`.
- **`type-check`** wraps the project's configured type-checker (tsc by
  default). Fires on `**/*.{ts,tsx}`. Failure mode: type errors emit
  `SENSOR_FAILED` with similar detail.

The two universal markdown-shape sensors (`required-sections`,
`upstream-coverage`) are NOT imported here — code-generation produces
code, not markdown artefacts. Future stages that produce both code and
markdown would import all four.

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
