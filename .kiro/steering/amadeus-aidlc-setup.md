---
inclusion: fileMatch
fileMatchPattern: "**/aidlc-state.md"
---

# Amadeus AIDLC — Setup & Configuration Detection

## Purpose

This steering file provides guidance when AIDLC state or configuration files are accessed. It ensures proper project setup and helps recover from misconfiguration.

---

## Setup Verification Checklist

When a user starts an AIDLC workflow, verify the following exist:

### Required Files
- `.kiro/steering/amadeus-aidlc-core.md` — Core workflow orchestration
- `.kiro/steering/amadeus-aidlc-standards.md` — Amadeus standards

### Required Directories
- `aidlc/` — Working directory for intents and artifacts
- `aidlc/spaces/default/` — Default space
- `aidlc/spaces/default/knowledge/` — Team knowledge (may be empty)

### Recommended Files
- `.kiro/steering/amadeus-aidlc-reference.md` — Quick reference (manual inclusion)
- `.gitignore` entry for `.aidlc` or `aidlc/` as appropriate

---

## Auto-Setup Prompt

If required files are missing when the user attempts to start a workflow, present:

```
Amadeus AIDLC is not fully configured in this workspace.

Missing:
- [list missing items]

Would you like me to set it up now? This will:
1. Create the required directory structure
2. Initialize the default space
3. Add aidlc/ to .gitignore (if not present)

[Yes / No / Show me what will be created]
```

---

## Setup Steps

When the user confirms setup:

1. Create directory structure:
   ```
   aidlc/
   ├── spaces/
   │   └── default/
   │       ├── intents/
   │       └── knowledge/
   ```

2. Add to `.gitignore` (append if file exists, create if not):
   ```
   # Amadeus AIDLC working directory
   aidlc/
   ```

3. Confirm completion:
   ```
   Amadeus AIDLC configured successfully.
   
   Ready to start. Type "Using AI-DLC, [your intent]" to begin a workflow.
   ```

---

## Configuration Options

Projects can customize AIDLC behavior via a `.aidlc-config.md` file at project root:

```markdown
# AIDLC Project Configuration

## Defaults
- Default Scope: feature
- Default Depth: Standard
- Default Test Strategy: Standard

## Extensions
- Security Baseline: enabled
- Property-Based Testing: disabled

## Team
- Space Name: my-team
- Knowledge Path: docs/knowledge/
```

If `.aidlc-config.md` exists, load it during Stage 0.3 (State Initialization) and apply as defaults (user can still override).
