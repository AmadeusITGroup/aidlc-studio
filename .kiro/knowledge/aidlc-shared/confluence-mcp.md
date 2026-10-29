# Confluence via the MCP Gateway (optional)

Confluence is an **optional, opt-in** context source for feature work — across
the Inception phase and the `nfr-requirements` (3.2) stage of Construction. When
a team keeps its product, architecture, or ways-of-working
knowledge in Confluence, and the user points a stage at a specific page, an
agent can read that page's live content through the gateway — so the user shares
a link instead of copying and pasting the page's text by hand. It is reached
through the Amadeus **MCP Gateway** — a single, audited entry point that fronts
several backend MCP servers (Confluence, Jira, GitHub, and others). AIDLC never
talks to Confluence directly; it calls whatever Confluence tools the gateway
exposes to the session.

This is a **convenience, not a dependency**. Nothing in the workflow requires
it: every stage that can consult Confluence produces the same artifacts without
it, using the inputs it already has. Treat Confluence as one more evidence
source that enriches a stage when the user supplies a page and is silently
skipped otherwise.

**Retrieval is human-pointed, never blind.** Not every project keeps a
Confluence space, and searching one tends to surface stale or unrelated pages.
So the framework does **not** crawl, keyword-search, or browse Confluence on its
own. It reads **only** the exact page the user supplies — a pasted link — or a
page the user confirms and links when a stage asks. Absent a page from the user,
the stage runs on its normal inputs.

## Scope: where it applies

The integration is scoped to **feature** work: the five **Inception** stages
below, plus one **Construction** stage (`nfr-requirements`). Each may accept a
user-provided Confluence page. The table lists the page types worth pasting for
each stage (only if the team maintains them):

| Stage | Page types worth pasting (if maintained) |
|-------|------------------------------------------|
| `reverse-engineering` (2.1) | Existing system/architecture docs, design records/ADRs, onboarding & runbook pages, API references for the repo(s) being scanned |
| `practices-discovery` (2.2) | Engineering handbooks, ways-of-working pages, branching/release runbooks, testing standards, Definition of Done |
| `requirements-analysis` (2.3) | Existing PRDs/specs, domain glossaries, stakeholder notes, related/parent feature pages |
| `refined-mockups` (2.5) | Design-system & component-library pages, brand/UX guidelines, accessibility standards |
| `delivery-planning` (2.8) | Roadmaps & release calendars, external-dependency owners, team rosters/RACI, prior delivery and retro notes |
| `nfr-requirements` (3.2) | Architecture & platform NFR standards, security policy & data-protection baselines, compliance requirements, SLO/SLA catalogs, observability & logging standards |

The `nfr-requirements` read is the **only** Confluence lookup in Construction —
it grounds a unit's NFR targets (latency, throughput, availability, security,
compliance) in the team's authoritative standards pages, and only when the user
supplies one. No other Construction stage and no Operation stage reads
Confluence; do not introduce Confluence lookups anywhere else in those phases.

**Reading applies to all six stages above; writing does not.** The gateway also
exposes Confluence *write* tools, but AIDLC uses them in exactly one place — the
`refined-mockups` (2.5) stage, and only when the user explicitly asks to
publish. Every other stage is read-only. See "Writing refined mockups back to
Confluence" below.

## How a lookup is triggered (two paths, both human-pointed)

**Path A — the user pastes a page.** If the user provides a Confluence link (or
pastes page content) during one of the five stages, fetch that exact page
through the gateway and fold its content into the stage. This is the primary
path.

**Path B — the stage asks once.** If no page was provided and Confluence tools
are available, a stage MAY ask a single, skippable question: whether the user
maintains a relevant Confluence page and, if so, to paste the link. Keep it to
one bundled question with a clear "None / skip" option. If the user says they
have none (or skips), drop it and proceed — do not ask again for that stage.

**Read only what the user supplied.** Whether the page arrived via Path A or
Path B, read **only** that page. Do **not** open pages it links to, do **not**
walk to parent/child pages, and do **not** read any other space. If a linked
page is genuinely needed, ask the user to paste that link too — its retrieval is
their decision, not yours.

**Never search.** Do not run open-ended or "narrow" space/keyword searches to
discover pages the user did not hand you. If the user names a page but cannot
find its link, ask them for the link rather than searching for it. Absent a
user-supplied link, there is nothing to consult.

## Readiness gate (before asking or fetching)

Run this one-shot check before Path A or Path B:

1. **Tools exposed?** Are gateway MCP tools that can read a Confluence page
   available in this session's agent configuration (e.g. a Confluence MCP server
   server)? If not, **do not ask the user for a link and do not probe** — go
   straight to the fallback. (A user who pastes page *text* directly can still
   have it used as context; you just cannot fetch by URL without the tools.)
2. **Authorized?** The gateway federates each user's own identity to Confluence,
   so a fetch only succeeds after the user has completed the gateway sign-in. If
   a fetch errors or asks for a sign-in the user has not completed, treat
   Confluence as unavailable for this run.

If either check fails, select the fallback and stop calling the gateway for this
stage.

## Graceful fallback (never block)

When Confluence tools are absent, unauthorized, or the user has no page to
share, the stage proceeds exactly as it would without the integration — from the
artifacts it already consumes and the user's description. **A missing page is
never an error and never a gate.** Do not stall waiting for a sign-in, do not
insist on a URL, and do not treat an absent page as a missing input. The
`upstream-coverage` and `required-sections` sensors check the stage's declared
artifacts, not Confluence — so skipping it never fails a sensor.

## Discipline when a page IS provided

- **Read only the supplied page — do not crawl or search.** Fetch exactly the
  page the user pasted; read no linked page, no parent/child page, and no other
  space (see "Read only what the user supplied" above).
- **Cite every page you rely on** by title and URL in the stage's output, so the
  artifact stays traceable (`[<page title>](<url>)`). A requirement or decision
  grounded in a Confluence page must name that page.
- **Confluence is context, not authority.** A page the user pasted can still be
  stale or contradict the code or the user's live request. Surface the conflict
  and let the human resolve it at the stage's approval gate. Never silently
  overwrite a user-stated requirement with a wiki page.
- **Respect sensitivity.** Do not copy secrets, credentials, or access tokens
  out of Confluence into artifacts. Reference by page, summarize by content.

## Writing refined mockups back to Confluence (opt-in — refined-mockups only)

Reading is the default and covers all five stages above. Writing is a
**separate, narrower capability**: the `refined-mockups` (2.5) stage MAY publish
its output to Confluence, and nothing else does. It is **strictly opt-in and
human-pointed** — the framework never publishes on its own.

**Trigger — the user must insist.** Write only when the user, during
`refined-mockups`, explicitly asks to publish/write the mockups to Confluence.
Do not offer it as a default step, do not infer it from "we keep our design docs
in Confluence", and never write as a side effect of a read. Absent an explicit
publish request, produce the local artifacts and stop.

**Point at the destination — never guess.** A write needs a target the user
names:

- **Update an existing page** — the user supplies the exact page (link or id);
  use `atlassian_updateConfluencePage`.
- **Create a new page** — the user supplies the destination space (and a parent
  page, if any); use `atlassian_createConfluencePage`.

Never create or overwrite a page the user did not name. One write is one page
the user pointed at — do not fan out to a tree of pages or touch a space
wholesale.

**Confirm before writing.** A write to a team wiki is not reversible from AIDLC.
Before the call, show the user (a) the destination — space + page title for a
create, or the exact page being replaced for an update — and (b) what will be
published (title and section outline), and get an explicit yes. Treat this as
its own gate: auto-approval never applies to a write. The write tools are
granted as *capability only* (they sit in `tools`, never in `allowedTools` /
`autoApprove`), so each write call surfaces for approval even though reads may be
pre-approved.

**Publish readable content, not artifacts wholesale.** Publish the mockups and
interaction spec as a readable Confluence page (a title plus headings that
mirror the artifact) — not raw file paths, and never secrets, tokens, or
credentials.

**Cite what you wrote.** After a successful write, record the created or updated
page title and URL in the stage output (`[<page title>](<url>)`), the same way a
read is cited, so the record shows exactly what left the workspace.

**Readiness and fallback (never block).** A write additionally needs the write
tools exposed and the user authorized (the same gateway sign-in a read uses). If
the write tools are absent, the user is not signed in, or the call fails, keep
the local artifacts, tell the user the publish did not happen, and proceed to the
stage gate. A skipped or failed publish is never a stage failure — the artifacts
on disk remain the source of truth.

## When the gateway is unavailable

The Confluence MCP server and its tool grants ship with the harness —
each participating agent declares the server in its own `mcpServers` and grants
only the specific Confluence tools it needs in `tools` (Kiro CLI applies MCP
servers per agent, so the workspace `settings/mcp.json` alone is not enough): the
read tools `atlassian_getConfluencePage` and `atlassian_atlassianUserInfo` on
every participating agent, plus the write tools `atlassian_createConfluencePage`
and `atlassian_updateConfluencePage` on the conductor alone (only the conductor
runs the write-enabled `refined-mockups` stage). Jira and the gateway's other
backends are deliberately not granted. So under normal conditions the tools are
present. When they are not — the gateway is unreachable (off-network), the user
has not completed the one-time sign-in, or the tools are otherwise not exposed —
treat Confluence as absent: take the fallback above and run the stage on its
normal inputs. Never stall waiting for a sign-in and never ask the user to
configure anything; setup and authentication are covered by the harness install
docs, not by you at runtime.
