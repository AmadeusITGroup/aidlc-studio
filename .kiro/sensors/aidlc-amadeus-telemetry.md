---
id: amadeus-telemetry
kind: deterministic
command: bun .kiro/tools/aidlc-sensor-amadeus-telemetry.ts
default_severity: advisory
fire_on: gate
description: Advisory, never fails. Delta-updates the firing intent's amadeus-telemetry/telemetry.json (intent identified, scope used, phase/stage status, timings, error counts and Kiro IDE / Kiro CLI / VS Code credits) and its telemetry.md report (amadeus-telemetry plugin)
category: telemetry
matches: "**/{aidlc-docs,intents}/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: integer
timeout_seconds: 10
---

# amadeus-telemetry sensor (amadeus-telemetry plugin)

ADVISORY and gate-fired. It never fails a gate: the script always prints
`{"pass": true, "findings_count": 0}` and exits 0, so it adds no error events to
the audit trail it reads. Any event core records for this sensor (for example a
script error if `bun` can't start it) is left out of the error counts.

Each firing is a delta update. The collector works out which intent owns the
fired `--output-path`, and looks at that intent plus the active one. For each, it
reads only the audit bytes appended since its last run, using the byte offsets in
the intent's `amadeus-telemetry/.cursor.json`. It rewrites the intent's
`amadeus-telemetry/telemetry.json`, and the `telemetry.md` report rendered from
it, only when the values changed. Later firings for the other deliverables of the
same gate find only a few new audit rows to read.

Bound by overlay to `requirements-analysis`, which is in every core scope, so every
intent gets an entry at its first gate. Also bound to `build-and-test`, late enough
to catch a mid-run `--scope` change. Gate sensors run before the human approves,
so the plugin also registers the same script as a PostToolUse shell hook
(`--reconcile`). The hook picks up the final approval and `WORKFLOW_COMPLETED`.
