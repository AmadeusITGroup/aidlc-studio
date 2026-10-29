---
slug: build-and-test
phase: construction
execution: ALWAYS
condition: Always executes once after all per-unit stages are finished.
lead_agent: aidlc-quality-agent
support_agents:
  - aidlc-devsecops-agent
mode: inline
produces:
  - build-instructions
  - unit-test-instructions
  - integration-test-instructions
  - performance-test-instructions
  - security-test-instructions
  - build-and-test-summary
  - build-test-results
  - octane-test-cases
  - octane-requirement-traceability
  - octane-push-results
  - sonarqube-findings
  - sonarqube-fix-results
  - scm-results
consumes:
  - artifact: code-generation-plan
    required: true
  - artifact: code-summary
    required: true
  - artifact: requirements
    required: false
  - artifact: stories
    required: false
requires_stage:
  - code-generation
sensors:
  - required-sections
  - upstream-coverage
  - type-check
  - octane-format
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
inputs: ALL code generation outputs across all units
outputs: build-instructions.md, unit-test-instructions.md, integration-test-instructions.md, performance-test-instructions.md, security-test-instructions.md, build-and-test-summary.md, test-results.md, scm-results.md (under this stage's record dir, engine-resolved)
---

# Build and Test

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Step 1: Load Personas

Load aidlc-quality-agent (lead) persona from `agents/aidlc-quality-agent.md` and knowledge from `.kiro/knowledge/aidlc-quality-agent/`. Load aidlc-devsecops-agent persona from `agents/aidlc-devsecops-agent.md` and knowledge from `.kiro/knowledge/aidlc-devsecops-agent/` for security testing input. Apply aidlc-quality-agent as the primary perspective with aidlc-devsecops-agent providing security testing expertise.

### Step 2: Analyze Testing Requirements

Read code generation outputs across all units from `<record>/construction/*/code-generation/code-summary.md`. Review NFR requirements across units (if they exist) to identify performance and security testing needs. Catalog all test types required.

### Step 2b: Determine whether this build needs Octane test cases

This build MAY export test assets to OpenText ALM Octane. Octane generation is
**opt-in per build** — it does NOT run unless the user asks for it here.

Present a structured question (this is a non-gate interview question — log it via
`aidlc-log.ts decision` before and `aidlc-log.ts answer` after, per stage-protocol
§2/§3; it is NOT an approval gate):

```question
prompt: "Generate OpenText ALM Octane test cases for this build? Octane assets (Gherkin scenarios + manual test cases + an import bundle) are produced in addition to the code-level tests, traced to requirements and user stories, for import into ALM Octane."
header: Octane Integration
multiSelect: false
options:
  - label: Yes, generate Octane test cases
    description: Produce octane-test-cases.md, octane-requirement-traceability.md, and the octane-import.json bundle for this build.
  - label: No, skip Octane
    description: Generate only the standard code-level tests. No Octane artifacts.
```

Record the decision in this stage's `memory.md` as `Octane requested: yes|no`.

- If the user chose **No** (the default): do NOT create any `octane-*` artifacts.
  Skip Steps 10c and 10d below entirely and note "Octane export: skipped (not
  requested)" in the Build and Test Summary. The `octane-format` sensor
  pass-throughs when its input bundle is absent, so skipping is clean.
- If the user chose **Yes**: proceed normally, then run Step 10c (generate the
  Octane assets) and Step 10d (create them in ALM Octane via the
  Octane MCP server) after the build and tests execute.

### Step 2c: Determine whether to review recent SonarQube findings

This build MAY pull the project's recent **SonarQube** findings and offer to fix
them. SonarQube review is **opt-in per build** — it does NOT run unless the user
asks for it here. It reads analysis that already exists on the SonarQube Server
(from open pull requests / analyzed branches); it does not scan the code and it
is not the same as the code-level tests this stage runs. See
`.kiro/knowledge/aidlc-shared/sonarqube-mcp.md`.

Present a structured question (non-gate interview question — log it via
`aidlc-log.ts decision` before and `aidlc-log.ts answer` after, per
stage-protocol §2/§3; it is NOT an approval gate):

```question
prompt: "Review recent SonarQube findings for this project? Reads the latest scan (from open PRs / analyzed branches) for open issues, security hotspots, and the quality gate, then lets you choose whether to fix any of them. Reading is safe; any code fix is confirmed with you first."
header: SonarQube Findings
multiSelect: false
options:
  - label: Yes, review SonarQube findings
    description: Resolve the project, pull recent findings, and present them. Fixing anything is a separate, explicitly confirmed choice.
  - label: No, skip SonarQube
    description: Run only the standard build and tests. No SonarQube reads.
```

Record the decision in this stage's `memory.md` as `SonarQube review requested:
yes|no`.

- If the user chose **No** (the default): do NOT read SonarQube. Skip Step 10e
  entirely and note "SonarQube review: skipped (not requested)" in the Build and
  Test Summary.
- If the user chose **Yes**: proceed normally, then run Step 10e after the build
  and tests execute.

### Step 3: Generate Build Instructions

Create `<record>/construction/build-and-test/build-instructions.md`:
- Dependency installation steps
- Environment setup (env vars, config files, local services)
- Build commands (compile, bundle, transpile)
- Build verification steps
- Troubleshooting common build issues

### Step 4-8: Generate Test Instructions (Strategy-Aware)

Consult the active test strategy from `aidlc-state.md` → `**Test Strategy**` (see stage-protocol.md §8 "Test Strategy"). Generate test instruction files based on the strategy level:

**Minimal strategy** — generate ONLY:
- `unit-test-instructions.md`: Requirement-driven unit tests (1 test per requirement, happy-path floor per component). ~5-15 tests total. Skip all other test types.

**Standard strategy** — generate:
- `unit-test-instructions.md`: 5-8 tests per component, key behavior coverage
- `integration-test-instructions.md`: Key boundary tests, cross-unit interaction

**Comprehensive strategy** — generate all applicable:
- `unit-test-instructions.md`: 10-15 tests per component, thorough coverage
- `integration-test-instructions.md`: Cross-unit interaction, external dependency handling
- `performance-test-instructions.md` (IF NFR performance requirements exist): Load testing, benchmarks, regression detection
- `security-test-instructions.md` (IF NFR security requirements exist): SAST/DAST, auth testing, injection testing
- Additional types as applicable (contract tests, E2E, accessibility) — create specifically named files

All files go in `<record>/construction/build-and-test/`.

Each instruction file should include:
- Test framework setup and configuration
- How to run the tests (commands, flags, filters)
- Expected coverage targets appropriate to the strategy level
- Test data management and environment setup

These are soft guidelines — the LLM can generate additional test types at any strategy level if context demands it (e.g., a Minimal security-patch may still warrant security test instructions).

### Step 9: Generate Build and Test Summary

Create `<record>/construction/build-and-test/build-and-test-summary.md`:
- Overall build status and prerequisites
- Test type inventory (which test types were generated)
- Coverage expectations per unit
- Readiness assessment (build-ready, test-ready, deployment-ready)
- Known limitations or outstanding items

### Step 10: Execute Build and Tests

Attempt to execute the build and test commands documented in the instruction files:

1. **Build**: Run the build commands from `build-instructions.md` via Bash. Capture output.
2. **Unit tests**: Run the unit test command from `unit-test-instructions.md` via Bash. Capture pass/fail counts.
3. **Integration tests** (if applicable): Run integration test commands. Capture results.
4. **Report results**: Create or update `<record>/construction/build-and-test/test-results.md` with:
   - Build status (success/failure + output)
   - Test results (total, passed, failed, skipped)
   - Failure details (test name, assertion, stack trace)
   - Coverage report (if test framework supports it)

**On failure**: If build or tests fail, attempt to diagnose and fix the issue:
- Read the error output
- Identify the failing code
- Apply the fix
- Re-run the failing step
- If unable to fix after 2 attempts, log the failure in test-results.md and present the issue to the user at the approval gate

**On success**: Update the Build and Test Summary with actual results (not just instructions).

### Step 10c: Generate Octane test cases (only if requested in Step 2b)

Run this step ONLY when the user chose "Yes, generate Octane test cases" in Step
2b. If Octane was not requested, skip this step.

Octane test cases are **test-management assets**, not a second test suite. Do NOT
invent a parallel set that restates the code-level tests already generated in this
stage. Build the Octane set in two disciplined passes so it is a faithful
projection of the tests this workflow already produced, plus only the
human-testing coverage Octane uniquely needs.

**Pass A — Project existing tests 1:1 (the traceability mirror).**

1. Inventory the code-level tests this stage produced: read
   `unit-test-instructions.md`, `integration-test-instructions.md`, and any
   performance/security instruction files, plus the actual generated test files
   in the repo where present.
2. For EACH existing test, emit exactly ONE Octane counterpart, linked to the
   same requirement/story that test validates:
   - Represent it as a **Gherkin** test case whose scenario captures the test's
     behavioral intent (Given/When/Then). Octane cannot store or run raw
     framework test code, and `automated_test` entities are CI-plugin-only (not
     creatable via the API), so a Gherkin projection is the faithful,
     API-creatable representation.
   - Set `origin: "projected"` and `source_test: "<file>::<test name>"` so the
     Octane test back-references the real code test — one source of truth, no
     drift.
   - Do NOT also author a manual restatement of something already covered by a
     projected test.

**Pass B — Author gap coverage only (manual / UAT).**

3. Enumerate the AUTHORITATIVE requirement set first: read every functional
   requirement id from the upstream `requirements` artifact and every user story
   from `stories` (when present). This full id list — NOT the subset that happened
   to get a test in Pass A — is the coverage denominator. Compute the coverage gap
   as the ids in that set with NO covering code-level test from Pass A.
4. For each uncovered requirement, author a NEW **manual** test case (ordered
   steps + expected results) — the exploratory / UAT / acceptance validation that
   code tests structurally do not cover. Set `origin: "authored"`.
5. If a requirement is already fully covered by projected tests, do NOT author a
   duplicate manual case for it.
6. Build the `requirements` map (below) as EXHAUSTIVE over that authoritative id
   set: every requirement/story id gets an entry with `covered` true|false and its
   `test_ids`. A requirement left with no test after Pass B stays in the map with
   `covered: false` and an empty `test_ids` — never dropped. Dropping a
   requirement from the map is the coverage hole this pass exists to prevent.

Produce three outputs under this stage's engine-resolved record dir
(`<record>/construction/build-and-test/`):

1. **`octane-test-cases.md`** — the catalog of Octane test cases under two H2
   sections: `## Octane Test Cases` (a table
   `| id | name | type | origin | source-test | requirement-ids |`) and
   `## Octane Features` (an index of the `.feature` files written for the
   projected Gherkin cases, e.g. `octane-features/<slug>.feature`). Manual cases
   list their ordered `action` / `expected` steps.

2. **`octane-requirement-traceability.md`** — a `## Octane Traceability` table
   with ONE row per requirement id in the authoritative set (Pass B step 3), not
   just the covered ones: `| requirement-id | octane-test-ids | origin | status |`
   where `status` is `covered` or `UNCOVERED`. Open the file with a
   `## Coverage Summary` line — `Covered N of M requirements` — and, when N < M,
   an explicit `Uncovered:` bullet list naming every uncovered id. A run with full
   coverage states `Covered M of M requirements`.

3. **`octane-import.json`** — a machine-readable import bundle the `octane-format`
   sensor reads and QA can transform into an Octane import (REST API or CSV). It
   is a sensor SIDE-INPUT, not a `produces:` deliverable, so write it beside the
   `.md` artifacts under the same record dir. Shape:

   ```json
   {
     "test_cases": [
       {
         "id": "OTC-001",
         "name": "Login rejects bad credentials",
         "type": "gherkin",
         "origin": "projected",
         "source_test": "login.integration.test.ts::rejects bad credentials",
         "requirement_ids": ["FR-1"],
         "gherkin": "Feature: Login\n  Scenario: Bad credentials\n    Given ...\n    When ...\n    Then ..."
       },
       {
         "id": "OTC-002",
         "name": "Password reset — manual UAT walkthrough",
         "type": "manual",
         "origin": "authored",
         "requirement_ids": ["FR-3"],
         "steps": [
           { "action": "Navigate to the reset page", "expected": "Reset form is shown" }
         ]
       }
     ],
     "requirements": {
       "FR-1": { "covered": true, "test_ids": ["OTC-001"] },
       "FR-3": { "covered": true, "test_ids": ["OTC-002"] }
     }
   }
   ```

   Rules: every case carries `origin` (`"projected"` or `"authored"`). A
   `projected` case MUST carry a non-empty `source_test` and (as a `gherkin`
   case) a non-empty `gherkin` string. An `authored` case is `manual` and MUST
   carry a non-empty `steps` array. The `requirements` map MUST be exhaustive over
   the authoritative upstream requirement/story id set (Pass B step 3): every id
   appears exactly once, with `covered: true` only when it has at least one
   `test_ids` entry, otherwise `covered: false` with an empty `test_ids`. A
   requirement referenced by a test case MUST be `covered: true`; a requirement
   with no test MUST still be present as `covered: false` — never omitted.

Add an "Octane export" line to the Build and Test Summary (Step 9) naming the
counts by origin (projected from existing tests / newly authored for gaps),
requirements covered / total, and the artifact paths.

**Coverage is a gate decision, not a silent pass.** Surface the coverage result
at the approval gate: state `Covered N of M requirements` and, when N < M, list
every uncovered id and why it remains uncovered (e.g. deferred to a later Bolt,
not testable here). A run that reaches the gate with uncovered requirements MUST
obtain explicit user acknowledgment of that gap in the gate decision — never
present an incomplete-coverage build as if it were complete. The `octane-format`
sensor reports the same gap from `octane-import.json`, but because it is advisory
this gate acknowledgment is the load-bearing control.

### Step 10d: Create the tests in ALM Octane via MCP (only if requested in Step 2b)

Run this step ONLY when the user chose "Yes" in Step 2b and Step 10c produced
`octane-import.json`. This step creates the generated test cases directly in
OpenText ALM Octane through the team **Octane MCP server**, using
the `octane_*` tools documented in the Octane MCP Team Guide.

**Gateway reachability.** The tests are created through the Octane MCP server
MCP server, configured with its HTTPS endpoint in `.kiro/settings/mcp.json`.
Kiro connects to it directly — no local forwarder or bridge is needed.

The MCP server owns authentication. Call `octane_sso_login` when
`octane_get_active_scope` reports `ready: false` or a protected call fails; this
triggers browser SSO. After the user completes the browser sign-in, call
`octane_sso_login_complete` to finish binding the session (it persists through
the server's bridge file). Never ask for, write, log, or commit an SSO cookie,
username, password, client_id, or client_secret.

1. **Confirm the gateway is reachable.** Call `octane_ping` on
   the Octane MCP server. If it returns `ok`, proceed. If the ping fails, the
   gateway is unreachable or the Octane MCP server is not configured in
   `.kiro/settings/mcp.json` — skip the push, retain the generated
   artifacts, and add this exact Build and Test Summary note: "Octane push
   skipped — gateway not reachable; octane-import.json is ready for retry or
   manual import." Do NOT fail the stage.

2. **Authenticate and select the target scope.** Call `octane_get_active_scope`.
   If it is not ready, call `octane_sso_login`, complete the browser sign-in,
   call `octane_sso_login_complete`, then re-call `octane_get_active_scope`. Present the returned active shared space and
   workspace as the default target in a structured non-gate question (log via
   `aidlc-log.ts decision` / `answer`). The user may accept that target or provide
   another `shared_space_id` and `workspace_id`; for an override call
   `octane_set_active_scope` with exactly those parameters. Then call
   `octane_check_workspace_access` with the selected IDs. If access is denied, do
   not create any tests; record the denial and ask the user to choose a reachable
   target. `octane_get_active_scope` also returns the Octane base `url` — capture
   it; it is needed to build the result links in step 6. Record the chosen scope
   in `memory.md` as
   `Octane target: url=<…>, shared_space=<…>, workspace=<…>`.

3. **Resolve traceability safely.** AIDLC requirement IDs such as `FR-1` are not
   Octane numeric work-item IDs. For every requirement/story in
   `octane-import.json`, use `octane_find_by_name` with `entity_type: "story"`
   (and `"requirement"` where appropriate) to find a candidate matching the
   upstream title. Present ambiguous candidates to the user and record the
   confirmed numeric Octane work-item ID. Never treat an AIDLC logical ID as an
   Octane ID, and never create a guessed link. A test without a confirmed mapping
   may still be created, but its push result MUST say `traceability: unlinked`.

4. **Prevent duplicate creation and confirm the dry run.** For each generated
   test, call `octane_find_by_name` with `entity_type: "manual_test"` or
   `"gherkin_test"` and the intended test name. Exclude existing matches from the
   create set by default; list them in `octane-push-results.md` as `skipped
   (existing)` and give the user a structured question to override that default
   only when a replacement is truly intended. Then present the final create set
   (manual count, Gherkin count, duplicate skips, linked/unlinked counts, shared
   space/workspace) and obtain explicit confirmation via a structured non-gate
   question: **Create in Octane** / **Skip push**. Creating entities in a shared
   ALM system is an external side effect — never push without this confirmation.

5. **Create tests with the documented APIs.** On confirmation, read
   `octane-import.json` and use these exact mappings:
   - For `type: "manual"`, call `octane_create_manual_test` with `name`,
     `description`, `steps` (each `{ action, expected? }`), and, only if a numeric
     mapping was confirmed, `covered_content_id` plus `covered_content_type`
     (`"work_item"` unless the MCP server requires the resolved concrete type).
   - For `type: "gherkin"`, call `octane_create_gherkin_test` with `name`,
     `script` (the full Gherkin feature document), and, only if a numeric mapping
     was confirmed, `covered_content_id`.
   - If a returned test needs a link that the create call did not preserve, call
     `octane_link_test_to_work_item` with the returned `test_id` and confirmed
     `work_item_id`.
   Continue after an individual create failure and do not retry that create more
   than once.

6. **Record results with Octane links (produces `octane-push-results`).** Write
   `octane-push-results.md` with these H2 sections:
   - `## Octane Push Results` — one row per pushed test:
     `| octane-test-id | octane-url | local-id (OTC-…) | name | type | work-item-id | traceability | status |`.
     For `octane-url`, prefer any self / UI link the create response returns; if
     none, build the Octane UI deep link from the captured active scope:
     `<url>/ui/?p=<shared_space_id>/<workspace_id>#/entity-navigation?entityType=<test|gherkin_test>&id=<octane-test-id>`.
     The `<url>/ui/?p=<ss>/<ws>#/` prefix is the stable Octane UI form; verify the
     entity fragment against your Octane version and adjust once if it differs.
   - `## Octane Links` — the workspace URL
     `<url>/ui/?p=<shared_space_id>/<workspace_id>` on its own line, followed by a
     bullet list of the created tests' deep links for quick click-through.
   - `## Octane Grouping` — how to see this batch together in the Tests grid:
     filter by creation time `creation_time >= '<push-start-ISO>'` in the target
     workspace (record the push-start timestamp), or by the covered feature/story
     that the batch links to. Give the concrete filter for the target workspace.
   Backfill the Octane IDs into `octane-requirement-traceability.md`. For every
   confirmed work-item mapping, call `octane_get_all_linked_tests` with
   `work_item_id` to confirm the created test is linked; record any discrepancy.
   Add an "Octane push" line to the Build and Test Summary naming the target
   shared space/workspace, the **Octane workspace URL**, and created / skipped /
   failed / linked / unlinked counts.

### Step 10e: Review recent SonarQube findings and optionally fix (only if requested in Step 2c)

Run this step ONLY when the user chose "Yes, review SonarQube findings" in Step
2c. If SonarQube review was not requested, skip this step. Reading findings is
read-only; **fixing any finding edits the codebase and requires explicit user
confirmation.** Follow `.kiro/knowledge/aidlc-shared/sonarqube-mcp.md`.

1. **Readiness + project resolution (silent fallback).** Confirm the `sonar_*`
   tools (on the `mcp-gateway` MCP server) are available in this session. Resolve the project key using the
   ordered resolution in the knowledge guide's "Resolving the project key":
   explicit key → key recorded in `project.md` → **the repo's own SonarQube
   config** (grep the workspace for `sonar.projectKey` in
   `sonar-project.properties`, `pom.xml`, `build.gradle(.kts)`, or CI files, then
   verify that key via `sonar_search_my_sonarqube_projects`) → only as a last resort a
   name search seeded from the git remote / repo dir (confirm with the user; on
   multiple matches let the user pick). Persist the confirmed key to
   `project.md`. Never guess or use an unverified key. If the server is absent,
   unreachable, unauthorized, or no project resolves, do NOT fail the stage — add
   this exact Build and Test Summary note: "SonarQube review skipped — server not
   reachable or no matching project," and continue.

2. **Pick the recent scan context.** Call `sonar_list_pull_requests` for the project;
   if open PRs exist, present them and let the user pick which PR's analysis to
   read (or the main branch). Fall back to `sonar_list_branches` / the default branch
   when there are no PRs. Capture the chosen `branch` or `pullRequest` and the
   last analysis date — every following read is scoped to that context.

3. **Read the findings (read-only).** For the chosen context, gather:
   - `sonar_get_project_quality_gate_status` — the gate verdict and failing conditions.
   - `sonar_search_sonar_issues_in_projects` — open issues (filter to `OPEN`; surface
     `BLOCKER`/`CRITICAL`/`HIGH` first). Expand notable rule keys with
     `sonar_show_rule` for fix guidance.
   - `sonar_search_security_hotspots` — unreviewed hotspots (`status: TO_REVIEW`).

4. **Record the findings (produces `sonarqube-findings`).** Write
   `<record>/construction/build-and-test/sonarqube-findings.md` with: the
   resolved project key, the branch/PR and last analysis date, an H2
   `## Quality Gate` (verdict + failing conditions), an H2 `## Open Issues`
   (a table `| rule | severity | file:line | message |`, worst first), and an H2
   `## Security Hotspots` (category, probability, file:line). State clearly that
   these reflect the last Server scan, not the current working tree.

5. **Ask whether to fix — default to no change.** Present a structured non-gate
   question offering the user to fix none, a selected subset, or the highest
   severity findings. Fixing is OFF by default:

   ```question
   prompt: "SonarQube reported the findings above. Fix any of them now? Each fix edits the codebase — nothing changes without your confirmation."
   header: SonarQube Fixes
   multiSelect: true
   options:
     - label: Fix selected issues
       description: Name the issues/files to fix; each change is shown before it is applied.
     - label: Fix top-severity issues only
       description: Address BLOCKER/CRITICAL issues; each change is shown before it is applied.
     - label: No fixes — record findings only
       description: Keep sonarqube-findings.md as a report; make no code changes.
   ```

6. **Apply confirmed fixes only (produces `sonarqube-fix-results`).** If the user
   chose to fix: for each finding in scope, show the specific edit and apply it
   only after the user confirms, then re-run the affected build/test commands to
   confirm nothing regressed. Do NOT call `change_sonar_issue_status` or
   `change_security_hotspot_status` (those mutate shared SonarQube state and are
   out of scope here). Write
   `<record>/construction/build-and-test/sonarqube-fix-results.md` listing each
   finding, the fix applied (or "declined"), and the re-test result. If the user
   chose "No fixes," note that and skip fix-results. Add a "SonarQube review"
   line to the Build and Test Summary naming the project, branch/PR, gate
   verdict, finding counts by severity, and how many findings were fixed.
### Step 10f: Commit, and open a pull request for an already-pushed branch (opt-in, host-aware)

Run this step LAST — after the build and tests have executed (Step 10), after any
Octane work (Steps 10c/10d), and after any SonarQube review and fixes (Step 10e),
so the commit carries those fixes. It is **opt-in per build**: nothing is staged,
committed, or opened unless the user explicitly chooses it here.

**AIDLC does not push.** `git push` is denied to every AIDLC agent by design, so
this step never sends anything to a remote. It commits locally, and — on GitHub
only — it can open a pull request for a branch the **user** has already pushed.
Pushing stays a deliberate human action.

The offer is **host-aware**. Pull requests are a hosting-layer feature, not a git
one, and only GitHub has a provisioned write tool in this framework. On a
non-GitHub host pull requests are **not mentioned at all** — do not offer them, do
not explain that they are unavailable, do not print a "create pull request" link.
Offer only what can actually be done.

**1. Detect state and resolve the host — before asking anything.**

Run these read-only checks first; the answers shape the question:

- `git rev-parse --is-inside-work-tree` — if this is not a git work tree, skip
  this step entirely and silently. Do not ask.
- `git status --porcelain` — the candidate change set.
- `git rev-parse --abbrev-ref HEAD` — the current branch.
- `git symbolic-ref refs/remotes/origin/HEAD` — the default branch.
- `git ls-remote --get-url origin` — the remote URL. This resolves the configured
  URL without contacting the network.
- `git ls-remote --heads origin <branch>` — whether the current branch exists on
  the remote, and at which SHA. Compare it to `git rev-parse HEAD` to learn
  whether the remote already carries exactly what is about to be reviewed.

If there is no `origin` remote and nothing to commit, there is nothing to offer:
skip the step and note "SCM: nothing to commit" in the Build and Test Summary.

Classify the host from the remote URL:

| Remote URL | Host class | What may be offered |
|------------|-----------|---------------------|
| `github.com`, `git@github.com:`, or a `github.*` enterprise host | **GitHub** | commit; pull request for an already-pushed branch |
| `bitbucket.*`, `gitlab.*`, any self-hosted or other host | **non-GitHub** | commit |

**2. Protected-branch guard.** If the current branch is the default branch
resolved above, or is named `main`, `master`, `trunk`, `develop`, or `release/*`,
do NOT offer to commit to it. Offer to create a feature branch first (propose a
name derived from the intent, e.g. `feat/<intent-slug>`), or to skip. Never commit
AIDLC-generated work onto a protected branch.

**3. Ask whether to commit.** This is a non-gate interview question: log it via
`aidlc-log.ts decision` before and `aidlc-log.ts answer` after, per stage-protocol
§2/§3. It is NOT an approval gate. The same question is used on every host —
it says nothing about pushing or pull requests.

```question
prompt: "Commit the generated code? It is currently uncommitted in your working tree. This commits locally only — AIDLC never pushes, so nothing reaches the remote until you push it yourself."
header: Commit Generated Code
multiSelect: false
options:
  - label: Commit the generated code
    description: Stage the files this workflow produced, by name, and commit them locally on the current branch.
  - label: No, skip
    description: Leave the working tree exactly as it is. No git writes at all.
```

Record the decision in this stage's `memory.md` as
`SCM action: commit|skip (host: github|non-github)`.

If the user chose **No, skip** (the default): make no git writes and note
"SCM: skipped (not requested)" in the Build and Test Summary. Skipping is clean.
Continue to step 6 only if a pull request is separately relevant (a GitHub branch
already fully pushed); otherwise the rest of this step does not run.

**4. Stage explicitly and show the change set.** Derive the file list from
`code-summary.md` across all units plus this stage's record dir. Stage those paths
by name. NEVER use `git add -A`, `git add .`, or any wildcard stage — an AIDLC run
must not sweep up unrelated work already sitting in the user's tree. Before
committing, present the exact staged file list and the commit message for
confirmation. If any path looks like a credential store (`.env`, `*.pem`,
`credentials*`, `*.p12`, `id_rsa*`), exclude it, and say that you did.

**5. Commit.** Use a conventional-commit subject derived from the intent, with a
body that names the units built and references the requirement/story ids this
build covers.

The repository's own pre-commit hooks run as part of `git commit` — on an Amadeus
harness that includes the EVE SDL secret and opengrep scans. If a hook rejects the
commit, **report the hook output verbatim and stop.** Do not pass `--no-verify`,
do not retry around it, do not stage differently to evade it. Fix the finding or
hand it to the user.

**6. Tell the user how to push, and what becomes possible afterwards.**

After a successful commit, state plainly that the commit is local and that AIDLC
cannot push it. Give the exact command for their branch:

```
git push -u origin <branch>
```

On a **GitHub** remote, add that once the branch is pushed, AIDLC can open the
pull request for them with a description assembled from this build's artifacts —
they can ask for it in this session, or re-run this stage. On a **non-GitHub**
remote, say nothing about pull requests: the message ends at the push command.

**7. Open the pull request — GitHub only, only for a branch already on the
remote, and only when the user asks.**

Preconditions, all required:

- the host class is **GitHub**;
- `git ls-remote --heads origin <branch>` returns a SHA equal to `git rev-parse HEAD`
  — the remote already carries exactly the commit to be reviewed;
- the working tree has nothing left uncommitted;
- the user explicitly asked for the pull request.

If the remote SHA differs from local `HEAD`, or the branch is absent from the
remote, do NOT open a pull request — a PR would describe a commit the reviewer
cannot see. Report the gap, repeat the push command, and stop.

When all preconditions hold, use the `github_create_pull_request` tool on the
GitHub MCP server. Do not shell out to `curl`.

**Fallback — the `gh` CLI, only when the MCP tool is absent.** If
`github_create_pull_request` is not provisioned in this session and the `gh` CLI
is installed and authenticated (`gh auth status`), open the PR with
`gh pr create --head <branch> --base <base> --title <title> --body-file <file>`
instead. This is the single write `gh` is permitted, and only here: every
precondition above still holds — GitHub host, the branch already on the remote
at `git rev-parse HEAD`, a clean working tree, and the user explicitly asked —
so `gh pr create` opens a PR for a commit the reviewer can already see and never
pushes anything itself. `gh` is not auto-approved, so the call prompts for
confirmation. If neither `github_create_pull_request` nor an authenticated `gh`
is available, report that the pull request could not be opened and stop — never
fall back to `curl` or a raw API token, and never `git push`.

- **Duplicate check first.** Call `github_list_pull_requests` filtered on this
  head branch (or, on the `gh` fallback path, `gh pr list --head <branch>`). If
  an open PR already exists from this branch, do NOT create a second one —
  record the existing PR as `skipped (existing)` and report its URL.
- **Base branch.** Default to the repository's default branch, but present it for
  confirmation — a branch stack may legitimately target an integration branch
  rather than the default.
- **Draft when the build is not green.** If Step 10 recorded a build failure or
  any failing test, create the PR with `draft: true` (or `gh pr create --draft`
  on the fallback path) so reviewers and CODEOWNERS are not notified, and say so
  in the summary. A green build may open a normal PR.
- **Body assembled from artifacts, not invented.** Compose the PR description
  from what this stage already produced: build status and test counts from
  `test-results.md`, the readiness assessment from `build-and-test-summary.md`,
  the story-to-code traceability from each unit's `code-generation-plan.md`, and —
  when Step 10d ran — the Octane workspace URL and push counts from
  `octane-push-results.md`. Where coverage is `N of M`, state the gap explicitly
  in the PR body rather than leaving it only in a local file.

**8. Record results (produces `scm-results`).** Write `scm-results.md` under
`<record>/construction/build-and-test/` with these H2 sections:

- `## SCM Actions` — the host class, branch, whether a commit was made and its
  SHA, the staged file count, and the exact push command handed to the user. When
  a pull request was opened, its number, URL, and whether it is a draft. When one
  was skipped as a duplicate, the existing PR's URL. State explicitly that AIDLC
  did not push.
- `## SCM Links` — the pull-request URL when one exists. On a non-GitHub host this
  section carries the branch name and commit SHA only; do not synthesise or infer
  a pull-request URL.

Add an "SCM" line to the Build and Test Summary (Step 9) naming the commit SHA,
the branch, and the PR URL when one was opened.

**Never block the stage.** A rejected pre-commit hook, an unreachable host, or a
missing permission is recorded and surfaced at the approval gate — it does not
fail Build and Test. The generated code and all artifacts remain intact on disk.

### Step 11: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage build-and-test --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 12: Completion

Present completion message and approval gate:

```
# :hammer: Build and Test Complete
```

Summary of all test instruction sets generated, readiness assessment, then:

```
**Review:** `<record>/construction/build-and-test/`
```

Approval gate: strictly 2-option (Approve / Request Changes).

## Sensors

This stage produces test-instruction markdown files under
`<record>/construction/build-and-test/` and runs the project's build
and test commands as part of execution. The instruction artefacts are
the agent-authored outputs the markdown-shape sensors check; the build
itself emits exit codes and a results report.

The imported sensors check those outputs:

- **`required-sections`** verifies each instruction file contains the
  registry default (≥2 H2 headings).
- **`upstream-coverage`** verifies the prose references the upstream
  artefacts this stage consumes (`code-generation-plan`, `code-summary`).
- **`type-check`** runs against any TypeScript/TSX code touched as part
  of test generation (matches `**/*.{ts,tsx}`).
- **`octane-format`** (advisory) reads `octane-import.json` when Octane
  generation was requested (Steps 2b/10c) and reports malformed Octane test
  cases and uncovered requirements. It pass-throughs cleanly when Octane was
  not requested and the bundle is absent.

`linter` is intentionally NOT imported. The canonical lint runs as part
of the build pipeline this stage drives — double-firing the framework
sensor would produce redundant findings against the same files. The
build's own exit code is the load-bearing signal.

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
