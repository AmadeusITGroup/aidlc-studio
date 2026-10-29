---
id: sdl-coverage
kind: deterministic
command: bun .kiro/tools/aidlc-sensor-sdl-coverage.ts
default_severity: blocking
fire_on: gate
description: Blocks the stage gate on a LOCAL EVE secrets finding (or an unrunnable scan) recorded in sdl-sdl-findings.json; opengrep findings are advisory (sdl plugin)
category: code-quality
matches: "**/{aidlc-docs,intents}/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: integer
  sdl_available: boolean
  secrets: array
timeout_seconds: 10
---

# sdl-coverage sensor (sdl plugin)

BLOCKING, gate-fired. Enforces the Amadeus SDL secret gate on the stages it is bound
to (`code-generation`, `build-and-test`). Before the approval gate opens, it reads the
`sdl-sdl-findings.json` side-input the stage's SDL scan step wrote and fails the
gate when:

- a **secret** was found in delivered source, or
- the scan could **not run** (`sdl_available: false` — `eve` absent/unauthenticated;
  unknown coverage must not read as clean), or
- the findings side-input is **absent** (the scan step did not run).

A failing gate does not open until the finding is fixed and the stage re-run, or a
human records an explicit `--override-blocking-sensors` decision (autonomous mode is
refused). **opengrep** (SAST) findings are advisory and never block — only secrets do.

The scan step runs both scanners **locally**: `eve scan secrets` (offline) and
`eve scan opengrep` (needs AMAIISDOM auth), writing the machine-readable side-input
this sensor reads at the gate.
