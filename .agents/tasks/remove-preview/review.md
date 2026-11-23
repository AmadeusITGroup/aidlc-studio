# Review — Remove preview-channel support

Verdict: APPROVED

## Scope reviewed

Working-tree changes in `c:\Github\aidlc-studio` against the task "remove ALL
preview-channel support". Reviewed production sources, the modified test files,
`package.json`, and the coder's `report.md`. Recorded verification (compile
clean, lint = 1 pre-existing warning, 147 tests pass) was read, not re-run, per
the step instructions. Nothing is staged or committed (`git status` shows all
changes unstaged; HEAD = prior session commit `40c1758`).

## Full concept removal — confirmed

- `isPreviewVersion`, `PREVIEW_SUFFIX_PATTERN`, `PREVIEW_CHANNEL_PATTERN` are
  gone. A tree-wide grep for `isPreviewVersion|PREVIEW_SUFFIX|PREVIEW_CHANNEL|
  amadeus-preview|activeChannel|withChannel|aidlc\.channel|versionSuffix|
  \.channel` returns no matches in `src/**/*.ts`.
- The `channel` dimension is removed, not narrowed, everywhere it existed only
  to distinguish release/preview: `VariantClassification` (variantDetector.ts),
  `AidlcInstallInfo` / `classifyFromVersionJson` (aidlcInstallReader.ts),
  `CliPresence` / `CLI_ABSENT` (cliPresence.ts), `AidlcVariant` + catalog
  entries (variants.ts), `RuleLoader` (`activeChannel`, `withChannel()`, the
  `aidlc.channel` workspaceState key), and `VersionInfo` (updateChecker.ts).
- The display enum was narrowed, correctly: `describeVariant` returns
  `'aws' | 'amadeus'`, and `VersionInfo.variantDisplayId` is `'aws' | 'amadeus'`.
  No `'amadeus-preview'` id remains.
- `systemProvider.variantLabel` has only `case 'amadeus' -> 'Amadeus'` and
  `case 'aws'/default -> 'AWS'`; the `'Amadeus (Preview)'` branch is deleted.
- `extension.ts` activation log is now
  `Active variant: ${variant.label} (${variant.installMethod})` — the
  `channel=${variant.channel}` segment is removed.
- `package.json` has no preview/channel config key or command (grep clean). Its
  diff is the unrelated update-split command wiring from prior session work, not
  preview.

No dead `'preview'` branch remains in any reviewed file.

## compareFullVersion / pre-release parsing — correctly KEPT

`compareFullVersion`, `isComparableVersion`, `parseCliUpdateCheck`, and
`getFullCurrentVersionFromBinary` are retained in `updateChecker.ts`. They are
genuinely used by release version-comparison: `checkViaCliUpdateCheck` decides
`updateAvailable` via `compareFullVersion(parsed.latestVersion, currentVersion)
> 0` when the CLI gives only a latest token, gated by `isComparableVersion`.
The pre-release-tail handling is standard semver precedence used to order any
Amadeus version string (whose tails look like `-1a.1.1.0`), not preview
detection. Removing it would break Amadeus release ordering. Keeping it is the
right call.

In `variantDetector.ts` the old `PREVIEW_SUFFIX_PATTERN` is renamed
`PRERELEASE_TAIL_PATTERN` and repurposed as an Amadeus-FAMILY signal (a tail is
only produced by Amadeus builds). This is sound: a marker-less Amadeus build
would otherwise mis-classify as AWS — a variant-detection regression. It no
longer implies any channel.

## Guardrails — honored

- AWS variant: detection, config/update/update --check, doctor, version rows,
  System rows, CLI-first flow unchanged; `variantDisplayId` still `'aws'`.
- Amadeus RELEASE variant: detection via `readAidlcInstall` / `cliPresence`
  resolving `variantId 'amadeus'` from `amadeusVersion`, feed URL, pre-release
  tail, and marker is intact; config/update/doctor, the friendly
  `RepoAccessError` message (ruleLoader.ts), and CLI-first flow unchanged. The
  only intended behavior change: a build that would have been `amadeus-preview`
  is now just `amadeus`.
- CLI-first model, update split (`updateCli` vs `updateWorkspace` /
  `updateCliBinary` vs `configureWorkspaceForVariant`), loud `[AIDLC fallback]`
  logging, workspace-scoped Setup row, machine-scoped Installed CLI row,
  Mac/Unix aidlc-on-PATH fix (`ensureAidlcOnPath`), and the git row all remain.
- No host-IDE branching beyond `detectHostHarness` / `resolveHarness`.
- No hardcoded publisher/name id lookup introduced.

## Tests — consistent with deleted symbols

Grep of `src/**/*.test.ts` for the deleted symbols returns only `createOutput
Channel` (unrelated VS Code API) — no test references a deleted symbol.
`variantDetector.test.ts` keeps AWS, Amadeus-marker, Amadeus-pre-release-tail,
binary-path, and empty-input cases and asserts against `PRERELEASE_TAIL_PATTERN`.
Preview version strings were replaced with `-1a.1.1.0` tails across the suites.
Recorded result: 147 tests pass.

## Non-blocking observations (not findings)

- `src/views/systemProvider.ts` still carries stale prose referring to the
  removed concept: two comments ("variant + channel") and one user-facing
  tooltip string, `"...The globally-installed aidlc CLI variant, channel, and
  version."` (around line 318). These are cosmetic text, not a dead code branch,
  and do not affect behavior or the channel removal. Worth tidying in a follow-up
  but out of scope for a blocker.

## Findings

None.
