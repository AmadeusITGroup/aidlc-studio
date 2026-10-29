---
id: octane-format
kind: deterministic
command: bun .kiro/tools/aidlc-sensor-octane-format.ts
default_severity: advisory
description: Reports malformed Octane test cases, missing projection back-references, and uncovered requirements in octane-import.json (advisory)
category: document-shape
matches: "**/{aidlc-docs,intents}/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: integer
  invalid_test_cases: string[]
  uncovered_requirements: string[]
timeout_seconds: 5
---

# octane-format sensor

ADVISORY. Reads the Octane import bundle the build-and-test stage emits when the
user opts into Octane generation (`octane-import.json`) and reports:

- **invalid test cases** — a `manual` case with an empty/missing `steps` array,
  a `gherkin` case with an empty/missing `gherkin` body, a case missing an
  `id` / `name` / valid `type`, a case with an invalid/missing `origin`
  (`projected` or `authored`), or a `projected` case with no `source_test`
  back-reference to the code-level test it mirrors;
- **uncovered requirements** — any entry in the bundle's `requirements` map whose
  `covered` is not `true`.

Works from `--output-path` alone — no per-stage config or dispatcher flag. It
pass-throughs (reports `pass: true`, zero findings) when the fired path is not
`octane-import.json` or when the bundle is absent, so a build that did not
request Octane never trips it.

## Advisory note

The framework has no blocking sensor severity yet, so a `SENSOR_FAILED` here is
REPORTED, not enforced — the build-and-test Octane traceability matrix + stage
prose drive covering every requirement with a well-formed test case.
