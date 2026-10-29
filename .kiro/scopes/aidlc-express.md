---
name: express
depth: Minimal
keywords:
  - express
  - lightweight
description: "Lightest run: requirements to code and test, no design pass"
skeleton: off
runner: true
review_cap: none
---

# express scope

`express` answers the request for a lightweight run. It follows a straight line
from requirements to code and test, without a design pass. In this Amadeus
distribution it stops at Build and Test — there is no deploy/observe tail yet.

## Why these stages, why skip those

Requirements Analysis establishes the contract, Code Generation implements it,
and Build and Test verifies it. Reverse Engineering remains CONDITIONAL to
provide brownfield understanding when existing code is present, and self-skips
on greenfield. The swarm path is structurally unreachable because `express`
skips Units Generation, so no Unit DAG can exist.

Minimal testing still requires requirement-driven unit tests with a happy-path
floor per component. `review_cap: none` disables reviewer dispatch for this
scope: the automated reviewer sub-agents on Requirements Analysis and Code
Generation are skipped, cutting their token cost. The human approval gate is
unchanged — you still review and approve each stage; only the second AI opinion
is dropped.

## Membership

The grid contains the three Initialization stages, Reverse Engineering,
Requirements Analysis, Code Generation, and Build and Test. Every other stage —
all Ideation, the design and planning stages, CI Pipeline, and the Operation
phase — is SKIP. Keyword triggers: `express`, `lightweight` (word-boundary
matched).
