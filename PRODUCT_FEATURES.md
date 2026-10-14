# AIDLC Studio — Product Features

## Vision

AIDLC Studio is a Kiro and VS code extension that makes the AI-Driven Development Life Cycle (AI-DLC) effortless to adopt, run, and maintain. It removes setup friction, provides real-time workflow guidance, enforces engineering standards, and keeps developers in control at every decision point.

---

## Design Principles

| Principle | Description |
|-----------|-------------|
| Zero Friction | One interaction to go from empty workspace to fully configured AIDLC |
| Always Oriented | Developer always knows where they are in the workflow, what's next, and why |
| Human in the Loop | Critical decisions require explicit approval; the agent proposes, the human decides |
| Amadeus-Native | Amadeus conventions, standards, and patterns are built-in, not bolted on |
| Progressive Disclosure | Simple by default, powerful when needed — complexity appears only when relevant |

---

## Feature Set

### F1: One-Click Project Initialization

**Problem:** Setting up AIDLC today requires downloading zips, extracting files, copying to correct directories, and configuring gitignore. This takes 5-10 minutes and is error-prone.

**Solution:** Automatic detection and guided setup on session start.

**Behavior:**
- On `SessionStart`, the extension checks if `.kiro/steering/amadeus-aidlc-rules/` exists
- If missing, prompts: "This project doesn't have Amadeus AIDLC configured. Set it up now?"
- On confirmation, pulls the latest rules from the Amadeus AIDLC repo, places them correctly, and updates `.gitignore`
- Shows a confirmation with the directory structure created

**User Stories:**
- As a developer, I want AIDLC to be ready when I open my project so I don't waste time on setup
- As a new team member, I want one-click onboarding so I can start contributing immediately
- As a tech lead, I want consistent setup across all team members so we don't debug config drift

**Acceptance Criteria:**
- [ ] SessionStart hook detects missing AIDLC configuration
- [ ] User is prompted with a clear yes/no choice
- [ ] On acceptance, all rule files are placed in correct locations
- [ ] `.aidlc` directory is added to `.gitignore`
- [ ] Success message confirms what was created
- [ ] Existing configurations are not overwritten without explicit consent

---

### F2: Workflow Orchestration Engine

**Problem:** AIDLC has 5 phases, 33 stages, 14 agents, and multiple scopes. Navigating this manually requires reading extensive documentation and remembering where you are.

**Solution:** A core steering file that acts as the workflow conductor, guiding developers through each phase adaptively.

**Behavior:**
- Activates when the user types "Using AI-DLC, ..." or any AIDLC invocation pattern
- Performs workspace detection (greenfield vs brownfield)
- Recommends scope based on project context (feature, bugfix, mvp, etc.)
- Walks through stages sequentially with clear transitions
- Manages state in `aidlc-state.md` within the intent's record directory
- Adapts depth and test strategy based on complexity

**User Stories:**
- As a developer, I want to describe what I'm building and have the workflow guide me through proper engineering phases
- As a developer, I want the system to auto-detect scope so I don't have to remember the 11 scope options
- As a tech lead, I want assurance that teams follow the full methodology without skipping stages

**Acceptance Criteria:**
- [ ] Natural language invocation triggers the workflow
- [ ] Workspace is correctly classified (greenfield/brownfield)
- [ ] Scope is auto-detected with option to override
- [ ] Each stage produces the expected artifacts in the record directory
- [ ] State file accurately reflects progress
- [ ] Conditional stages are correctly skipped when not applicable

---

### F3: Real-Time Progress Tracking

**Problem:** During a workflow run, developers lose track of where they are across 33 stages. Checking `aidlc-state.md` manually breaks flow.

**Solution:** Automatic progress updates surfaced after each stage transition.

**Behavior:**
- After each stage completes, displays a compact progress summary:
  ```
  [AIDLC] INCEPTION > Requirements Analysis [====------] 2/8
  Next: User Stories (aidlc-product-agent)
  ```
- Shows overall completion percentage across all phases
- Indicates which agent is leading the next stage

**User Stories:**
- As a developer, I want to see my progress at a glance so I stay motivated and oriented
- As a developer, I want to know which agent leads the next stage so I understand the perspective shift

**Acceptance Criteria:**
- [ ] Progress is shown after every stage transition
- [ ] Format is compact and non-intrusive (max 3 lines)
- [ ] Phase, stage, and progress ratio are all visible
- [ ] Next stage and lead agent are indicated
- [ ] Skipped stages don't count toward progress denominator

---

### F4: Approval Gates

**Problem:** Without enforcement, the AI agent might auto-advance past decision points, removing human oversight from critical architectural and design decisions.

**Solution:** Mandatory approval checkpoints at phase boundaries and key stage transitions.

**Behavior:**
- Before advancing past an approval gate, the extension verifies explicit user approval
- Presents a clear summary of what was produced in the stage
- Offers three paths: Approve, Request Changes, or Skip
- Records the decision in the audit trail
- Blocks advancement until a decision is made

**User Stories:**
- As a developer, I want to review each stage's output before moving forward so I catch issues early
- As a tech lead, I want confidence that no stage is bypassed without deliberate choice
- As a developer, I want the ability to request changes without restarting the entire workflow

**Acceptance Criteria:**
- [ ] Every phase boundary requires explicit approval
- [ ] Stage completion summaries show artifacts produced
- [ ] Three options are always available (Approve / Revise / Skip)
- [ ] Decisions are logged to the audit trail
- [ ] Agent cannot proceed without a recorded decision

---

### F5: Amadeus Standards Enforcement

**Problem:** The base AIDLC workflow is generic. Amadeus has specific coding standards, security requirements, architectural patterns, and deployment conventions that need to be enforced consistently.

**Solution:** Amadeus-specific steering layered on top of the core workflow that automatically applies team conventions.

**Behavior:**
- Amadeus coding standards are checked at every Construction stage
- Security baseline rules (Amadeus-specific) are loaded and enforced
- Naming conventions, architecture patterns, and deployment targets are suggested contextually
- Non-compliance is flagged before stage approval, not after

**Scope (customizable per team):**
- Language and framework conventions
- API design standards (REST, gRPC patterns)
- Security requirements (auth, data handling, secrets management)
- Testing requirements (coverage thresholds, test patterns)
- Deployment patterns (containerization, CI/CD, observability)
- Documentation standards

**User Stories:**
- As a developer, I want Amadeus standards applied automatically so I don't have to memorize the style guide
- As a security engineer, I want security rules enforced during development, not discovered in code review
- As a tech lead, I want consistency across all projects without manual enforcement

**Acceptance Criteria:**
- [ ] Amadeus standards are loaded automatically (no opt-in required)
- [ ] Violations are surfaced inline during relevant stages
- [ ] Standards are configurable per-project via override files
- [ ] Security rules are blocking (cannot proceed until resolved)
- [ ] Standards evolve independently of the core AIDLC workflow

---

### F6: Quick Reference & Contextual Help

**Problem:** Developers need to look up AIDLC concepts (scopes, depths, agents, stages) without leaving their workflow.

**Solution:** A manually-includable reference that provides instant answers to AIDLC questions.

**Behavior:**
- Available via `#AmadeusAIDLC` context tag in chat
- Provides:
  - Scope decision matrix (which scope for what situation)
  - Stage quick reference (what each stage does, inputs, outputs)
  - Agent roster (who does what)
  - Common commands and patterns
  - Troubleshooting tips

**User Stories:**
- As a new developer, I want to quickly understand what "feature scope" means without reading full docs
- As a developer, I want to know what artifacts a stage produces without leaving chat
- As a developer, I want help choosing the right scope for my task

**Acceptance Criteria:**
- [ ] Available via manual inclusion (`#AmadeusAIDLC`)
- [ ] Covers all 11 scopes with decision guidance
- [ ] Lists all 33 stages with one-line descriptions
- [ ] Describes all 14 agents and their domains
- [ ] Includes a troubleshooting section for common issues

---

### F7: Workflow Resume & Recovery

**Problem:** Sessions get interrupted. When a developer returns, they need to pick up exactly where they left off without re-running completed stages.

**Solution:** State-aware session resumption built into the steering.

**Behavior:**
- On session start, if `aidlc-state.md` exists with an in-progress workflow, offers to resume
- Shows where the workflow was interrupted
- Resumes at the exact stage that was in progress
- Validates that previous artifacts still exist and are intact

**User Stories:**
- As a developer, I want to resume my workflow after lunch without losing progress
- As a developer, I want to know exactly where I left off when I return to a project

**Acceptance Criteria:**
- [ ] Existing state is detected on session start
- [ ] Resume prompt shows current phase, stage, and completion percentage
- [ ] Resumption starts at the correct stage (not the beginning)
- [ ] Completed artifacts are validated before resuming
- [ ] Option to restart from scratch if state is corrupted

---

### F8: Multi-Intent & Space Management

**Problem:** Real projects have multiple work streams running in parallel. Developers need to switch between intents without confusion.

**Solution:** Space and intent awareness in the steering that helps manage concurrent work.

**Behavior:**
- Lists active intents and their status on request
- Allows switching between intents
- Shows which intent is currently active
- Supports named spaces for team-level organization

**User Stories:**
- As a developer, I want to work on a bugfix without losing my feature workflow state
- As a tech lead, I want to see all active intents across the team's space

**Acceptance Criteria:**
- [ ] Active intents are discoverable via chat
- [ ] Switching between intents preserves state of each
- [ ] Named spaces are supported for team organization
- [ ] Intent labels are human-readable and date-stamped

---

### F9: Extension System (Amadeus Custom Extensions)

**Problem:** Teams within Amadeus have different requirements (security team needs SAST rules, platform team needs IaC rules, etc.).

**Solution:** An extension framework that allows teams to layer custom rules on top of the core workflow.

**Behavior:**
- Extensions live in `amadeus-aidlc-rule-details/extensions/`
- Each extension has a rules file and an opt-in file
- Opt-in prompts appear during Requirements Analysis
- Once enabled, extension rules are blocking constraints
- Teams can author and share custom extensions

**User Stories:**
- As a security engineer, I want to add SAST requirements that are enforced for all projects
- As a platform engineer, I want IaC best practices enforced during Construction
- As a team lead, I want to share our team's extensions with other teams easily

**Acceptance Criteria:**
- [ ] Extension discovery scans the extensions directory automatically
- [ ] Opt-in prompts are presented during Requirements Analysis
- [ ] Enabled extensions are blocking (stage cannot proceed if violated)
- [ ] Custom extensions follow the same format as built-in ones
- [ ] Extensions can be shared across projects via a common directory

---

### F10: Audit Trail & Traceability

**Problem:** For compliance and quality purposes, teams need to trace decisions back through the development lifecycle.

**Solution:** Automatic audit logging of every decision, approval, and stage output.

**Behavior:**
- Every approval gate decision is logged with timestamp and rationale
- Stage artifacts are version-tracked in the intent's record directory
- Audit shards are per-session for easy merging
- Traceability matrix can be generated from requirements through to implementation

**User Stories:**
- As a compliance officer, I want to trace any code back to its requirements
- As a tech lead, I want to understand why a design decision was made weeks later
- As a developer, I want my decisions documented without extra effort

**Acceptance Criteria:**
- [ ] All gate decisions are logged with timestamps
- [ ] Audit shards are created per-session
- [ ] Artifacts are organized in the intent's record directory
- [ ] Traceability from requirements to code is achievable
- [ ] Audit data is human-readable (markdown format)

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Setup completes in under 30 seconds |
| Performance | Progress updates add no perceptible latency |
| Reliability | State files are validated before use |
| Reliability | Corrupted state offers recovery options |
| Usability | No command memorization required |
| Usability | All interactions use natural language |
| Maintainability | Core workflow and Amadeus rules are independently updatable |
| Security | No secrets stored in steering files |
| Security | Repo access uses existing auth (no extra credentials) |
| Compatibility | Works with Kiro IDE Vibe mode |
| Compatibility | Works with both greenfield and brownfield projects |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from empty workspace to first AIDLC stage | < 2 minutes |
| Developer orientation time (knowing where they are) | < 5 seconds |
| Setup errors requiring manual intervention | 0% |
| Stage skip rate without explicit approval | 0% |
| Developer satisfaction (internal survey) | > 4/5 |
