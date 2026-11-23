---
slug: market-research
phase: ideation
execution: CONDITIONAL
condition: Execute when initiative has external market positioning or build-vs-buy considerations. Skip for internal tools, bug fixes, or refactors.
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
summary_confirmation: required
produces:
  - competitive-analysis
  - market-trends
  - build-vs-buy
  - market-research-questions
consumes:
  - artifact: intent-statement
    required: true
requires_stage:
  - intent-capture
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
inputs: Intent statement from intent-capture stage
outputs: competitive-analysis.md, market-trends.md, build-vs-buy.md, market-research-questions.md (under this stage's record dir, engine-resolved)
---

# Market Research & Competitive Analysis

MANDATORY: Follow stage-protocol.md for approval gates, question format, and completion messages.

## Steps

### Step 1: Load Agent Personas

Load aidlc-product-agent persona from `agents/aidlc-product-agent.md` and knowledge from `.kiro/knowledge/aidlc-product-agent/`.

### Step 2: Load Prior Context

- Read intent statement from `<record>/ideation/intent-capture/`
- Identify market-relevant aspects of the initiative

### Step 3: Generate Clarifying Questions

Create `<record>/ideation/market-research/market-research-questions.md` with questions:
- What competing products or solutions exist in the market?
- What are their strengths, weaknesses, and pricing models?
- What industry trends or regulatory shifts are relevant?
- What do customers expect as table-stakes vs. differentiators?
- For internal initiatives: are there existing tools, SaaS products, or open-source alternatives?
- What is the build-vs-buy-vs-partner calculus?
- What market size or addressable audience are we targeting?
- May we search public code hosts (GitHub) to discover and size up
  open-source alternatives and competitors for this initiative, and are there
  specific projects we should look at first? Searching lets us ground the
  competitive analysis and build-vs-buy call in real repositories — popularity
  (stars/forks), maintenance cadence, language/stack, and license — instead of
  relying on recollection. Name any known projects as a product name, a clone
  URL, or an `owner/repo` reference; we will also search by keyword/topic to
  surface others. Search and inspection are strictly **read-only**, and naming
  a project here authorizes reading it. Do NOT classify the host yourself —
  Step 5 detects it from the reference and picks the access method (GitHub MCP
  vs `git` CLI) automatically.

This question MUST include an explicit `None` / `Not applicable` option so a
purely internal initiative with no open-source angle never forces an invented
search. The Step 5 landscape search runs only when the user approves the search
or names at least one project; otherwise Step 5 is skipped and the stage
proceeds from the answers and desk research alone.

Follow stage-protocol.md question flow (Guide Me / Edit File / Chat).

### Step 4: Collect and Analyze Answers

Run ambiguity detection and contradiction analysis on all answers.

### Step 5: Open-Source Landscape Search (read-only)

Run this step ONLY when, in Step 3, the user approved searching public code
hosts OR named at least one project (naming a project is the authorization to
read it; skip any project flagged as off-limits). If the user chose
`None` / `Not applicable`, skip to Step 6 and proceed from the answers and desk
research alone. Full tool list, query patterns, hygiene, and source-tagging
rules are in
`.kiro/knowledge/aidlc-product-agent/repo-landscape-search.md` — load
it before starting.

Search and inspection are strictly **read-only**: never write to, branch,
comment on, open issues/PRs against, or push to any repository, and never run
`git push`.

**Detect the host per reference, then pick the access method — do not ask.**
Infer the host from each reference the user gave (and from the hosts that
surface in discovery search):
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

**Discovery — via the GitHub MCP tools (read-only).** Surface
open-source alternatives and competitors, then size each up:
- `github_search_repositories` — discover candidate alternatives the user did
  not name (by keyword, `topic:`, `language:`, and a star floor);
  `github_search_code` to find who implements a distinctive capability.
- `github_get_file_contents` — for each candidate (named or discovered), read
  `README`, license, and dependency/build manifests for positioning, stack,
  and license terms.
- `github_list_commits` / `github_list_issues` — recent commits and
  open-issue/activity signals to gauge maturity and maintenance cadence (a
  build-vs-buy input).
- `github_get_me` — one-shot reachability check before relying on the tools.
- Do not call any tool that writes (issues, PRs, comments, branches, files).

**Non-GitHub repos — via the `git` CLI (read-only).** Shallow-clone into an OS
temp directory OUTSIDE the workspace (`git clone --depth 1 <url> <tmp>`), read
blobs with `git -C <tmp> show HEAD:<path>`, and capture the resolved commit with
`git -C <tmp> rev-parse HEAD`. Never `git push`; never add a remote. Leave the
temp clone for the OS to reap. If credentials are missing or the clone fails,
report it and ask the user to paste the relevant details — do not block the
stage.

**Capture as evidence.** Write raw findings to
`<record>/ideation/market-research/repo-landscape.md`, and tag every
repo-derived fact with a source marker — `[repo:<host>/<owner>/<name>@<sha>]`
when pinned to a read blob, or `[repo:<host>/<owner>/<name>]` for a
search-level fact (stars, topics) — so the downstream artifacts stay traceable.

### Step 6: Generate Artifacts

Create competitive analysis, market trends report, build-vs-buy assessment, and differentiation strategy brief based on answers and research.

Fold any Step 5 landscape findings into these artifacts: discovered
open-source alternatives and their positioning/popularity into the competitive
analysis, ecosystem/language momentum into the market trends report, and
per-project maturity, license, and maintenance signals into the build-vs-buy
assessment. Carry the `[repo:...]` source tag on each repo-derived row. When
Step 5 was skipped, note that the analysis rests on user-provided answers and
desk research only.

### Step 7: Completion Handoff

Hand completion to `stage-protocol.md` via
`bun .kiro/tools/aidlc-orchestrate.ts report --stage market-research --result <outcome>`.
The engine owns all lifecycle transitions and advancement.

### Step 8: Present Completion & Request Approval

Completion emoji: :bar_chart:
Review path: `<record>/ideation/market-research/`
Standard approval gate (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/ideation/market-research/`.

The imported sensors check those outputs:

- **`required-sections`** verifies the output contains the registry default (≥2 H2 headings). Failure mode: missing headings emit `SENSOR_FAILED` with detail at `<record>/.aidlc-sensors/<stage-slug>/required-sections-<iso>.md`.
- **`upstream-coverage`** verifies the output prose references each artefact declared in this stage's `consumes:` frontmatter. Failure mode: missing upstream references emit `SENSOR_FAILED` listing each unreferenced artefact (this stage consumes `intent-statement`).

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
