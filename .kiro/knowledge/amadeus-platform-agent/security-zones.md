# Amadeus network connectivity and security zones

Two hard rules govern every connection an Amadeus workload makes. Both are
non-negotiable design inputs, not review comments.

## AUD is the authority for network connectivity

**Always rely on AUD** for network connectivity facts:
<https://viewer.aud.global.amadeus.net/webui/>

Never infer reachability from an architecture diagram, an existing config file, or
the matrix reproduced below. AUD is the live source of truth for what can actually
reach what. A connection you have not confirmed in AUD is an assumption, and
assumptions about network reachability surface as outages at deployment time, not at
design time.

When a design needs a path that AUD does not show as open, that is a firewall or
platform request with a lead time — it is not a detail to leave to deployment.

## Validate the security zone before designing a connection

Every workload sits in a **security zone**, and every target sits in one too. Before
designing any connection, establish both zones and check the source→destination pair
against the Security Zone Matrix.

Three outcomes:

| Verdict | Meaning | What to do |
| --- | --- | --- |
| **ALLOWED** | Permitted inside the target | Proceed; still confirm the concrete path in AUD |
| **RESTRICTED** | Conditionally permitted | Requires justification and approval. Record it as a deviation with an owner. Do not treat as open |
| **BLOCKED** | Not permitted | Redesign. Do not plan an exception request as the primary path |

**Scope of the matrix.** It applies **only inside a given target**. It governs
connections within `PRD-NE` or within `PRD-WE` — it does **not** authorise
cross-target connections. A cross-target path is a separate question and must be
resolved through AUD.

### Security Zone Matrix — internal view

Zones: `anz`, `app`, `cbz`, `cbz_vip`, `cde`, `cri`, `csz`, `dmz`, `dmz_vip`,
`dsz`, `nct`, `tnz`.

Rows are the **source** zone, columns the **destination** zone.
`A` = allowed, `R` = restricted, `B` = blocked.

| src ↓ / dst → | anz | app | cbz | cbz_vip | cde | cri | csz | dmz | dmz_vip | dsz | nct | tnz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **anz**     | A | R | R | R | R | A | R | A | A | R | R | R |
| **app**     | B | A | A | A | B | R | R | R | R | R | R | R |
| **cbz**     | B | A | A | A | R | R | R | R | R | B | R | R |
| **cbz_vip** | B | A | A | A | R | R | R | R | R | B | R | R |
| **cde**     | B | B | R | R | A | R | R | R | R | R | B | R |
| **cri**     | B | A | R | R | R | A | R | R | R | R | R | R |
| **csz**     | B | R | R | R | R | B | A | B | B | B | R | B |
| **dmz**     | B | R | R | R | R | R | R | A | A | B | R | R |
| **dmz_vip** | B | R | R | R | R | R | R | A | A | B | R | R |
| **dsz**     | B | B | B | B | B | B | B | B | B | A | R | R |
| **nct**     | B | A | R | R | B | A | A | R | R | R | A | R |
| **tnz**     | R | A | A | A | R | A | A | R | A | A | A | A |

Patterns worth internalising, because they catch most design errors early:

- **Every zone reaches itself** (the diagonal is ALLOWED).
- **`anz` is almost universally unreachable as a destination** — every source except
  `anz` itself and `tnz` is BLOCKED into it.
- **`dsz` is near-isolated as a source** — it is BLOCKED into everything except
  itself, `nct`, and `tnz`. Designing an outbound integration from `dsz` is usually
  a redesign signal.
- **`cde` is tightly constrained both ways** and is BLOCKED to and from `app` and
  `nct`. Treat anything touching `cde` as cardholder-data scope with the compliance
  obligations that follow, and involve the Compliance Agent.
- **`csz` is BLOCKED to most zones** including `cri`, `dmz`, `dmz_vip`, `dsz`, `tnz`.
- **`app` ↔ `cbz`/`cbz_vip` is ALLOWED**, which is the ordinary application-to-backend
  path and the one most designs should be using.

### Two caveats on this table

1. **This is the `Internal` view only.** The matrix has an `External` view that is
   not reproduced here. For any externally-facing path, consult the source rather
   than this file.
2. **This is a convenience copy, not the authority.** It is transcribed from a
   point-in-time screenshot of the matrix. Where this table and the live
   matrix or AUD disagree, **they win**. Re-verify any RESTRICTED or BLOCKED verdict
   at the source before acting on it, and re-verify an ALLOWED verdict before
   depending on it. Never present a verdict from this file as a final answer without
   saying it came from a cached copy.

## Never connect to production from a developer machine

Direct connections from a developer machine to production are **not permitted**.
Production access goes **through the jump server**.

This constrains design as well as process:

- Do not design a workflow, runbook, or tool that assumes a developer's laptop can
  reach a production endpoint, database, or management API.
- Do not put production credentials on a developer machine.
- Operational tooling that touches production runs from the jump server or from the
  platform's own pipeline, never locally.
- Local development and test work against non-production targets.

When a stage's output would require a human to reach production, state that the step
runs via the jump server and say so explicitly in the artifact. A runbook that
silently implies local production access is a defect.

<!--
TODO(amadeus): to complete this file, add —
  - the jump server hostname(s) per target, and how access is requested
  - which security zone each of your workloads/platforms sits in by default
  - the External view of the Security Zone Matrix
  - the AUD query or saved view a designer should start from
  - the intake route and typical lead time for a firewall/connectivity request
  - PRD-NE vs PRD-WE target definitions and the approved cross-target mechanism
-->
