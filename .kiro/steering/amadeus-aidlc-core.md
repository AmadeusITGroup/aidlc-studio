---
inclusion: auto
---

# Amadeus AIDLC — Core Workflow Orchestration

## Activation

This steering file activates when the user invokes the AIDLC workflow using any of these patterns:
- "Using AI-DLC, ..."
- "Using AIDLC, ..."
- "/aidlc ..."
- "Start AIDLC workflow"
- "Run AIDLC"

When activated, follow the full workflow defined below. When NOT activated, this file provides passive context but does not drive behavior.

---

## Workflow Overview

Amadeus AIDLC (AI-Driven Development Life Cycle) is a structured methodology with 5 phases, 33 stages, and 14 agents. It adapts to project complexity via scopes, depth levels, and test strategies.

### Phases

| # | Phase | Purpose | Stages |
|---|-------|---------|--------|
| 0 | Initialization | Bootstrap workspace, detect context, create intent | 0.1–0.3 |
| 1 | Ideation | Capture intent, validate feasibility, define scope | 1.1–1.7 |
| 2 | Inception | Requirements, design, architecture, delivery planning | 2.1–2.9 |
| 3 | Construction | Build, test, validate | 3.1–3.7 |
| 4 | Operation | Deploy, monitor, optimize | 4.1–4.7 |

### Scopes

| Scope | When to Use | Typical Stages |
|-------|-------------|----------------|
| enterprise | Large-scale, multi-team systems | All 33 |
| feature | New feature in existing codebase | ~25 |
| mvp | Minimum viable product, fast validation | ~18 |
| poc | Proof of concept, throwaway | ~12 |
| bugfix | Defect repair | ~10 |
| refactor | Code improvement, no behavior change | ~12 |
| spike | Research/exploration | ~8 |
| migration | Platform/library migration | ~15 |
| integration | Third-party system integration | ~18 |
| documentation | Docs-only change | ~6 |
| express | Quick task, minimal ceremony | ~5 |

---

## Workflow Execution

### Phase 0: Initialization (Automatic)

On workflow invocation:

1. **Stage 0.1 — Workspace Scaffold**
   - Create intent record directory: `aidlc/spaces/default/intents/<YYMMDD>-<label>/`
   - Create phase subdirectories based on detected scope
   - Ensure space-level knowledge dir: `aidlc/spaces/default/knowledge/`

2. **Stage 0.2 — Workspace Detection**
   - Scan project root and common source directories (src/, app/, lib/, pages/, components/, tests/)
   - Classify: greenfield (no source files) or brownfield (existing codebase)
   - Detect language, framework, package manager, test runner
   - Record findings in state

3. **Stage 0.3 — State Initialization**
   - Create `aidlc-state.md` in the intent's record directory
   - Recommend scope based on user intent + workspace classification
   - Present scope for approval with option to change
   - Record: scope, depth (Standard default), test strategy (Standard default)

### Phase 1: Ideation (Interactive)

Each stage follows the pattern: Agent works → User reviews → Approval gate

| Stage | Name | Lead Agent | Key Output |
|-------|------|------------|------------|
| 1.1 | Intent Capture | product | intent-capture.md |
| 1.2 | Market Research | product | market-research.md |
| 1.3 | Feasibility & Constraints | architect | feasibility.md |
| 1.4 | Scope Definition | product | scope-definition.md |
| 1.5 | Team Formation | lead | team-formation.md |
| 1.6 | Rough Mockups | ux | mockups.md |
| 1.7 | Approval & Handoff | lead | handoff.md |

### Phase 2: Inception (Interactive)

| Stage | Name | Lead Agent | Key Output |
|-------|------|------------|------------|
| 2.1 | Reverse Engineering | developer + architect | reverse-engineering.md |
| 2.2 | Practices Discovery | architect | practices.md |
| 2.3 | Requirements Analysis | product | requirements.md |
| 2.4 | User Stories | product | user-stories.md |
| 2.5 | Application Design | architect | application-design.md |
| 2.6 | Risk Assessment | architect | risks.md |
| 2.7 | Unit of Work Definition | architect | units-of-work.md |
| 2.8 | Estimation | lead | estimation.md |
| 2.9 | Delivery Planning | lead | delivery-plan.md |

### Phase 3: Construction (Interactive + Autonomous)

| Stage | Name | Lead Agent | Key Output |
|-------|------|------------|------------|
| 3.1 | Functional Design | developer | functional-design.md |
| 3.2 | Technical Design | developer | technical-design.md |
| 3.3 | Environment Setup | devops | environment.md |
| 3.4 | Code Scaffolding | developer | scaffold code |
| 3.5 | Code Generation | developer | implementation code |
| 3.6 | Build and Test | qa | test results |
| 3.7 | CI Pipeline | devops | pipeline config |

### Phase 4: Operation (Conditional)

| Stage | Name | Lead Agent | Key Output |
|-------|------|------------|------------|
| 4.1 | Deployment Planning | devops | deployment-plan.md |
| 4.2 | Infrastructure Setup | devops | infrastructure config |
| 4.3 | Deployment Execution | devops | deployment artifacts |
| 4.4 | Smoke Testing | qa | smoke-test-results.md |
| 4.5 | Monitoring Setup | devops | monitoring config |
| 4.6 | Incident Playbook | devops | incident-playbook.md |
| 4.7 | Feedback & Optimization | product | feedback-loop.md |

---

## Stage Execution Protocol

For each stage:

1. **Announce** — Display stage name, lead agent, and phase progress
2. **Interaction Mode** — Offer: Guide Me / Edit File / Chat
3. **Execute** — Run stage steps, produce artifacts
4. **Summarize** — Show completion summary with artifacts produced
5. **Gate** — Present: Approve / Request Changes / Skip
6. **Record** — Update `aidlc-state.md`, write audit entry
7. **Advance** — Move to next stage (or re-enter on "Request Changes")

---

## State Management

State is tracked in `aidlc-state.md` within the intent's record directory.

```markdown
# AIDLC State

## Intent
- Label: <label>
- Created: <YYYY-MM-DD>
- Scope: <scope>
- Depth: <depth>
- Test Strategy: <strategy>
- Workspace: <greenfield|brownfield>

## Progress
- Current Phase: <phase>
- Current Stage: <stage>
- Stages Completed: <n>/<total>

## Stages
- [x] 0.1 Workspace Scaffold
- [x] 0.2 Workspace Detection
- [x] 0.3 State Initialization
- [ ] 1.1 Intent Capture
- ...
```

---

## Agent Personas

When leading a stage, adopt the perspective of the lead agent:

| Agent | Domain | Perspective |
|-------|--------|-------------|
| product | Product management | User value, business goals, market fit |
| architect | System architecture | Structure, scalability, patterns, trade-offs |
| developer | Implementation | Code quality, maintainability, performance |
| qa | Quality assurance | Test coverage, edge cases, reliability |
| devops | Operations | Deployment, monitoring, infrastructure |
| ux | User experience | Usability, accessibility, interaction design |
| lead | Team leadership | Coordination, planning, risk management |
| security | Security | Threat modeling, compliance, secure patterns |
| data | Data engineering | Data models, pipelines, storage |
| performance | Performance | Optimization, benchmarks, scalability |
| accessibility | Accessibility | WCAG compliance, assistive tech support |

---

## Conditional Stage Execution

Stages are skipped when:
- Scope excludes them (e.g., bugfix skips Ideation)
- Workspace type doesn't require them (e.g., greenfield skips Reverse Engineering)
- Depth level minimizes them (Minimal depth reduces documentation stages)

When skipping a stage, announce: "Skipping [Stage Name] — [reason]" and advance.

---

## Amadeus-Specific Adaptations

This workflow integrates Amadeus standards at key points:
- **Requirements Analysis (2.3)** — Amadeus extension opt-ins are presented
- **Construction stages (3.x)** — Amadeus coding standards are enforced
- **Deployment (4.x)** — Amadeus deployment patterns are applied

Standards details are loaded from: `#[[file:.kiro/steering/amadeus-aidlc-standards.md]]`

---

## Resume Protocol

On session start, if `aidlc-state.md` exists with incomplete stages:
1. Read state file
2. Identify current phase and stage
3. Prompt: "AIDLC workflow in progress: [Phase] > [Stage] ([n]/[total] complete). Resume?"
4. On yes: continue from current stage
5. On no: offer to start fresh or archive current intent
