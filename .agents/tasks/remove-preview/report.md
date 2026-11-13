# Remove preview-channel support — implementation report

No review gate file (`.agents/tasks/remove-preview/review.json`) existed, so this
task was implemented from scratch.

## Verification (all green)

- `npm run compile` → exit 0, no TypeScript errors.
- `npm run lint` → exit 0. Exactly ONE warning: the pre-existing
  `src/extension.ts:38 no-console`. No new warnings introduced.
- `npm run test` (vitest `--run`, one-shot) → 14 files, **147 tests passed**.

## Interpretation taken: A — full concept removal

The `channel: 'release' | 'preview'` dimension was removed entirely wherever it
existed only to distinguish release-vs-preview (not hardcoded to `'release'`),
because it was simpler and left no dead branches. The one place a type was
*narrowed* rather than removed is `VersionInfo.variantDisplayId` /
`describeVariant`'s return (`'aws' | 'amadeus' | 'amadeus-preview'` →
`'aws' | 'amadeus'`), since those are a display enum, not a channel field.

## Files changed and what was removed from each

### Production code

- **src/services/variantDetector.ts**
  - Deleted `isPreviewVersion`, `PREVIEW_SUFFIX_PATTERN`, `PREVIEW_CHANNEL_PATTERN`.
  - Removed `channel` and `versionSuffix` from `VariantClassification` and
    `classifyVariant`'s return. `channel` removed (not narrowed): nothing but
    preview detection used it. `versionSuffix` removed because it was consumed
    only by tests, never by production code.
  - **Kept** the pre-release-tail detection as an Amadeus-FAMILY signal, renamed
    `PREVIEW_SUFFIX_PATTERN` → `PRERELEASE_TAIL_PATTERN`. Reason: a pre-release
    tail (e.g. `-1a.1.1.0`) only appears on Amadeus builds, so it legitimately
    identifies the Amadeus variant even without an explicit marker. Dropping it
    would have mis-classified a marker-less Amadeus build as AWS — a
    variant-detection regression, not preview removal. It no longer implies any
    channel.

- **src/services/aidlcInstallReader.ts**
  - Dropped the `isPreviewVersion` import.
  - Removed `channel` from `AidlcInstallInfo` and from `classifyFromVersionJson`'s
    return (field removed entirely — only preview branched on it).
  - Removed the `isPreviewVersion(...) ? 'preview' : 'release'` branches.
  - Updated doc comments (`-preview` examples → plain pre-release tail).

- **src/services/cliPresence.ts**
  - Removed `channel` from `CliPresence`, `CLI_ABSENT`, and all three return
    sites (metadata / version-probe / binary-only). Field removed entirely.

- **src/services/variants.ts**
  - Removed `channel` from `AidlcVariant` and from all catalog entries
    (`aws`, `amadeus`) and the custom-fork overlay.
  - Simplified `describeVariant`: return narrowed to `'aws' | 'amadeus'`, the
    `'amadeus-preview'` display id and the `channel === 'preview'` branch deleted.

- **src/services/ruleLoader.ts**
  - Removed the `activeChannel` field, the `withChannel()` helper, and the
    persisted `aidlc.channel` workspaceState key.
  - `setVariant`, `restoreVariant`, and `setResolved` no longer carry/persist a
    channel; `get variant()` returns `activeVariant` directly.
  - Updated the restore-strategy doc comment (channel references dropped).

- **src/services/updateChecker.ts**
  - Removed `channel` from `VersionInfo`; narrowed `variantDisplayId` to
    `'aws' | 'amadeus'`.
  - Removed the three `channel: variant.channel` assignments in the `VersionInfo`
    literals.
  - **Kept** `compareFullVersion`, `isComparableVersion`, `parseCliUpdateCheck`,
    and `getFullCurrentVersionFromBinary`. Reason: these drive the release/update
    version COMPARISON (latest-vs-current to decide `updateAvailable`) and the
    current-version read. The pre-release-tail handling in `compareFullVersion`
    is standard semver precedence used to order ANY Amadeus version (whose
    strings carry tails like `-1a.1.1.0`), not preview detection. Deleting them
    would break Amadeus release version ordering. Only the word "preview" in
    comments was cleaned to "pre-release/build tail".

- **src/views/systemProvider.ts**
  - Removed the `case 'amadeus-preview': return 'Amadeus (Preview)'` branch from
    `variantLabel`; updated its doc comment. Amadeus now renders as "Amadeus".

- **src/extension.ts**
  - Removed the `channel=${variant.channel}` segment from the activation log line.
  - Cleaned a "repo/channel" comment to "repo".

- **package.json**: no preview/channel config key or command existed, so no
  change was required there (the `M package.json` in git status is pre-existing
  session work, not from this task).

### Tests (preview cases removed/rewritten; release/AWS/Amadeus-release kept)

- **src/services/variantDetector.test.ts** — dropped the `isPreviewVersion`
  describe and all `channel`/`versionSuffix`/`PREVIEW_SUFFIX_PATTERN` assertions;
  kept AWS, Amadeus-marker, Amadeus-pre-release-tail, binary-path, and
  empty-input cases; renamed the constant tests to `PRERELEASE_TAIL_PATTERN`.
- **src/services/aidlcInstallReader.test.ts** — removed every `channel` assertion
  and the preview version strings; kept the active-version-folder-selection
  coverage (the stale-higher-folder bug-report trap) with `-1a.1.1.0` tails and
  variantId assertions.
- **src/services/cliPresence.test.ts** — removed `channel` assertions; renamed
  the "amadeus/preview" test to "amadeus"; `-preview.3` strings → `-1a.1.1.0`.
- **src/services/ruleLoader.test.ts** — removed all `aidlc.channel` and
  `variant.channel` assertions and the "release channel wins" cases; kept the
  on-disk-metadata-wins, persisted-id, and AWS-default restore cases; renamed
  `seedAmadeusPreviewInstall` → `seedAmadeusInstall`.
- **src/services/updateChecker.test.ts** — removed the
  `{ ...getVariant('amadeus'), channel: 'release' }` channel spreads (now just
  `getVariant('amadeus')`); renamed the "preview/pre-release tail" parser test;
  all CLI-first / fallback / parser coverage retained.
- **src/commands/update.test.ts** — removed `channel` from the `cliInfo` type and
  literal, narrowed `variantDisplayId`, and dropped `channel: null` from the
  cliPresence mock.
- **src/commands/setup.test.ts** — dropped `channel: null` from the cliPresence mock.
- **src/services/repoVersionReader.test.ts** — the pre-release parser test kept
  (it exercises release-correct suffix parsing); its sample string changed from
  `2.10.0-preview.3` to `2.10.0-1a.1.1.0` to avoid the preview token.

No test references any deleted symbol.

## Guardrail confirmation — AWS and Amadeus RELEASE behavior unchanged

- **AWS variant**: detection, `aidlc config`/`aidlc update`/`aidlc update --check`,
  doctor, version rows, and CLI-first flow are untouched. The AWS
  `variantDisplayId` is still `'aws'`; `variants.test.ts` and
  `updateChecker.test.ts` AWS cases pass unchanged.
- **Amadeus RELEASE variant**: detection (readAidlcInstall/cliPresence →
  variantId `'amadeus'`) still resolves Amadeus from `amadeusVersion`, the
  Artifactory feed URL, the pre-release tail, and the marker. `aidlc config`,
  `aidlc update`, doctor, the RepoAccessError message, and the CLI-first flow are
  unchanged. The only behavior change (by design): a build that WOULD have been
  `amadeus-preview` is now just `amadeus`; a pre-release tail is no longer called
  "preview", just an Amadeus version.
- The CLI-first model, the update split (updateCli vs updateWorkspace), loud
  fallback logging, the workspace-scoped Setup row, the machine-scoped Installed
  CLI row, the Mac/Unix aidlc-on-PATH fix, and the git row are all intact.

## Git

Nothing staged, committed, or pushed. All changes left in the working tree; HEAD
is unchanged from the prior session commit.
