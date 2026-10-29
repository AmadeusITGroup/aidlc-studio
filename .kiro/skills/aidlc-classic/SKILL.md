---
name: aidlc-classic
description: "Run the AI-DLC workflow with the classic scope baked in — no scope detection. V1-style lifecycle without ideation ceremony (Amadeus: capped at build-and-test). Packaging over `/aidlc --scope classic`, which works without this skill."
argument-hint: "[description | --status | --stage <slug|#> | --phase <name|#>]"
user-invokable: true
metadata:
  generated-by: aidlc-runner-gen
---

# AI-DLC — classic scope

Drive the AI-DLC engine with the **classic** scope fixed. This is the same
deterministic forwarding loop the `/aidlc` orchestrator runs, with `--scope
classic` baked into the first `next` so scope detection is skipped. The
engine owns all routing; the conductor persona arrives on the first directive's
`conductor_persona` field — adopt it for the whole run.

## The loop

1. `directive = bun .kiro/tools/aidlc-orchestrate.ts next --scope classic $ARGUMENTS`
2. Act on `directive.kind` exactly as the orchestrator does (run-stage / ask / print / error / done) — see `aidlc-common/protocols/stage-protocol.md`.
3. `bun .kiro/tools/aidlc-orchestrate.ts report --stage <directive.stage> --result <outcome> [--user-input "<text>"]` when the directive names a stage; omit `--stage` only for non-stage report round-trips.
4. Repeat from step 1 until `directive.kind == done`.

Pass `$ARGUMENTS` through verbatim after `--scope classic`; the engine parses
any flags (`--status`, `--stage`, …) and the `--scope` from the
state file always wins on an existing workflow, so re-running a started workflow
resumes it. To run a different scope, use `/aidlc --scope <other>` instead.
