---
inclusion: manual
---

# Amadeus AIDLC — Quick Reference

> Include this in chat via `#AmadeusAIDLC` for instant workflow guidance.

---

## Starting a Workflow

```
Using AI-DLC, [describe what you want to build]
```

Examples:
- "Using AI-DLC, build a REST API for inventory management"
- "Using AI-DLC, fix the authentication timeout bug in user-service"
- "Using AI-DLC, migrate the payment module from Express to Fastify"

---

## Scope Decision Matrix

| Scope | Use When... | Stages | Time |
|-------|-------------|--------|------|
| **enterprise** | Large system, multiple teams, long-lived | 33 | Days |
| **feature** | New feature in existing codebase | ~25 | Hours |
| **mvp** | New product, validate quickly | ~18 | Hours |
| **poc** | Explore feasibility, throwaway code OK | ~12 | 1-2h |
| **bugfix** | Fix a known defect | ~10 | 30-60m |
| **refactor** | Improve code, no behavior change | ~12 | 1-2h |
| **spike** | Research, answer a question | ~8 | 30m |
| **migration** | Move to new platform/library | ~15 | Hours |
| **integration** | Connect to external system | ~18 | Hours |
| **documentation** | Docs-only, no code changes | ~6 | 30m |
| **express** | Tiny task, skip ceremony | ~5 | 15m |

**Unsure?** Start with `feature` — it covers most cases well.

---

## Phases at a Glance

### Phase 0: Initialization (Automatic)
| Stage | What Happens |
|-------|-------------|
| 0.1 | Creates workspace directories and intent record |
| 0.2 | Scans project — greenfield or brownfield? |
| 0.3 | Sets scope, depth, test strategy |

### Phase 1: Ideation (7 stages)
| Stage | What Happens |
|-------|-------------|
| 1.1 | Captures your intent and success criteria |
| 1.2 | Researches market context and prior art |
| 1.3 | Evaluates technical feasibility and constraints |
| 1.4 | Defines what's in/out of scope |
| 1.5 | Identifies required skills and roles |
| 1.6 | Creates rough UI/interaction mockups |
| 1.7 | Summarizes and hands off to Inception |

### Phase 2: Inception (9 stages)
| Stage | What Happens |
|-------|-------------|
| 2.1 | Reverse-engineers existing code (brownfield only) |
| 2.2 | Discovers team practices and conventions |
| 2.3 | Analyzes and validates requirements |
| 2.4 | Writes user stories with acceptance criteria |
| 2.5 | Designs application architecture |
| 2.6 | Assesses risks and mitigations |
| 2.7 | Breaks work into units (parallel-ready) |
| 2.8 | Estimates effort per unit |
| 2.9 | Plans delivery order (Bolts) |

### Phase 3: Construction (7 stages)
| Stage | What Happens |
|-------|-------------|
| 3.1 | Detailed functional design per unit |
| 3.2 | Technical design (data models, APIs, patterns) |
| 3.3 | Sets up development environment |
| 3.4 | Creates code scaffolding |
| 3.5 | Generates implementation code |
| 3.6 | Builds, runs tests, validates |
| 3.7 | Configures CI pipeline |

### Phase 4: Operation (7 stages)
| Stage | What Happens |
|-------|-------------|
| 4.1 | Plans deployment strategy |
| 4.2 | Sets up infrastructure |
| 4.3 | Executes deployment |
| 4.4 | Runs smoke tests |
| 4.5 | Configures monitoring and alerting |
| 4.6 | Creates incident playbook |
| 4.7 | Establishes feedback loop |

---

## Agents Roster

| Agent | Domain | Stages They Lead |
|-------|--------|-----------------|
| product | Business value, user needs | 1.1, 1.2, 1.4, 2.3, 2.4, 4.7 |
| architect | System design, patterns | 1.3, 2.1, 2.2, 2.5, 2.6, 2.7 |
| developer | Code quality, implementation | 3.1, 3.2, 3.4, 3.5 |
| qa | Testing, validation | 3.6, 4.4 |
| devops | Infrastructure, deployment | 3.3, 3.7, 4.1–4.6 |
| ux | User experience, design | 1.6 |
| lead | Coordination, planning | 1.5, 1.7, 2.8, 2.9 |
| security | Threat modeling, compliance | (advisory across all) |
| data | Data models, pipelines | (advisory during design) |
| performance | Optimization, scalability | (advisory during construction) |
| accessibility | WCAG, assistive tech | (advisory during UX/construction) |

---

## Depth Levels

| Level | When to Use | Effect |
|-------|-------------|--------|
| **Minimal** | Confident team, well-understood domain | Less documentation, faster stages |
| **Standard** | Default, balanced rigor and speed | Full documentation, normal gates |
| **Comprehensive** | High-risk, regulated, new domain | Extra analysis, more artifacts, stricter gates |

---

## Interaction Modes

At each stage, choose how to interact:

| Mode | How It Works | Best For |
|------|-------------|----------|
| **Guide Me** | Agent asks structured questions one at a time | First-time users, unfamiliar domains |
| **Edit File** | Write/edit artifacts directly | Experienced users who know what they want |
| **Chat** | Freeform discussion, agent extracts decisions | Brainstorming, exploration |

You can switch modes mid-stage.

---

## Common Commands

| Action | How |
|--------|-----|
| Start workflow | "Using AI-DLC, [intent]" |
| Check status | Ask "What's my AIDLC status?" |
| Resume workflow | Automatic on session start if state exists |
| Change scope | Say "Change scope to [scope]" during Stage 0.3 |
| Skip a stage | Choose "Skip" at the approval gate |
| Request changes | Choose "Request Changes" at the gate |
| List intents | "Show my AIDLC intents" |
| Switch intent | "Switch to intent [label]" |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow doesn't start | Ensure you include "Using AI-DLC" in your message |
| State file not found | Run setup: ask "Set up AIDLC in this project" |
| Wrong scope detected | Override during Stage 0.3 approval |
| Stage seems stuck | Check if it's waiting for your approval at the gate |
| Artifacts in wrong location | Verify `aidlc/spaces/` directory exists |
| Standards too strict | Override in project `.aidlc-config.md` |
| Want to restart | "Restart AIDLC workflow from scratch" |
| Extension not loading | Check `amadeus-aidlc-rule-details/extensions/` directory |
| Brownfield misclassified | Manually specify during Stage 0.2 |
| Too many stages for task | Switch to `express` or `bugfix` scope |
