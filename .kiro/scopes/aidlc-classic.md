---
name: classic
depth: Standard
keywords: []
description: V1-style lifecycle without ideation ceremony (Amadeus: capped at build-and-test)
skeleton: on
runner: true
---

# classic scope

`classic` reproduces the AI-DLC v1 experience: the lifecycle begins after
Ideation, then adapts through Inception and Construction according to each
stage's applicability. In this Amadeus distribution it is capped at
`build-and-test` — CI Pipeline and the whole Operation phase are out of scope
for now, matching the team's current focus.

## Why these stages, why skip those

AI-DLC v1 had no Ideation phase, so `classic` skips all seven Ideation stages
(there is no new-product discovery step) and keeps every Inception and
Construction stage up to and including Build and Test. Requirements Analysis,
Units Generation, Delivery Planning, Code Generation, and Build and Test are the
unconditional spine; the remaining Inception design work self-selects from the
project context, preserving v1's adaptive behavior.

Its test strategy inherits Standard from its depth, so production testing
expectations remain in force. The separate `workshop` scope retains the
teaching-oriented Minimal test override.

Reviewers run on the stages that declare a `reviewer:` field. This scope sets
no `review_cap`, so those reviewers fire as normal (to skip them, use a scope
that sets `review_cap: none`, e.g. `express`).

## Membership

Initialization, every Inception stage, and Construction stages 3.1–3.6
(Functional Design through Build and Test) are in the grid. All seven Ideation
stages, CI Pipeline (3.7), and every Operation stage are SKIP. The scope
intentionally has no keywords and is selected by explicit name
(`/aidlc --scope classic`) or its first-class runner `/aidlc-classic`.
