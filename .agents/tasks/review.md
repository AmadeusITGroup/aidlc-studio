# Review — variant/channel feature + two-row System version display

Verdict: **APPROVED**

Scope reviewed: the uncommitted working-tree change implementing PART 1
(variant/channel feature making the 12 RED tests pass) and PART 2 (two-row
System panel display), against `.agents/tasks/plan.md` and the task statement.
No production code was modified by this review.

## Evidence read (not re-run)

`.agents/tasks/verification.md` records, from `c:\Github\aidlc-studio` on Windows
PowerShell:
- `npm run compile` (`tsc -p ./`) — PASS, exit 0, no TS errors, emits `out/`.
- `npm run lint` (`eslint src --ext ts`) — PASS, 0 errors, 1 warning: the
  pre-existing baseline `no-console` at `src/extension.ts:37`. No new warnings.
- `npm run test` (`vitest --run`) — 86 passed / 0 failing across 8 test files,
  including the 6 previously-RED `updateChecker.test.ts` cases, the 11
  previously-RED `ruleLoader.test.ts` cases, and 7 new `repoVersionReader.test.ts`
  cases.

The evidence is detailed and internally consistent. I independently confirmed
the full test-file set is exactly the 8 files named (`file_search` for
`*.test.ts`), and read every asserted test against the production code; each
assertion traces to a correct code path (details below). No articulable doubt
remained, so I did not re-run any suite, compiler, or linter, and ran no
spot-check.

## PART 1 — variant/channel feature

### Tests not weakened or deleted
`src/services/updateChecker.test.ts` and `src/services/ruleLoader.test.ts` are
both tracked and present at HEAD (`git cat-file -e` exit 0) and show an EMPTY
working-tree diff against HEAD — they are byte-identical to their committed
(RED) baseline. Production was changed to satisfy the asserted API, not the
reverse. `variants.test.ts` asserts only individual fields (no full-object
`toEqual`), so the additive `channel`/`artifactory` fields do not break its 17
cases.

### variants.ts
- `AidlcVariant` gains `channel: 'release' | 'preview'`; both catalog entries
  (`aws`, `amadeus`) set `channel: 'release'`, and the `custom` overlay in
  `getVariant()` sets it too (spread stays type-complete).
- `amadeus` carries the Artifactory feed base
  `.../amadeus-aidlc/cli` under `artifactory.versionFeedUrl`; `aws` has none.
- `describeVariant()` is pure and exported: returns `aws` for id `aws`/default,
  `amadeus-preview` for amadeus+preview, else `amadeus`. Single source of truth
  shared by UpdateChecker and SystemProvider.
- `detectHostHarness`/`resolveHarness` untouched.

### ruleLoader.restoreVariant() — authoritative on-disk first
Priority order is exactly: (1) `readAidlcInstall()` AUTHORITATIVE — on non-null
it stamps the variant, reconciles+persists BOTH `aidlc.variantId` and
`aidlc.channel`, overriding stale persisted values; (2) persisted state
(channel defaults to `release` when key absent); (3) `.kiro/tools/aidlc-utility.ts`
file heuristic → amadeus/release; (4) bare-PATH `aidlc --version` probe via
`Shell.run`, classified by `classifyVariant`; (5) AWS/release default. The three
on-disk tests, the two persisted tests, and the three binary/default tests each
map to a branch and pass. `outputChannel` stays optional and all logging is
`?.`-guarded (the test constructs `RuleLoader` with a context-only stub).

### ruleLoader.isWorkspaceConfigured() — capability-based
Returns true when the clone-copy layout exists (SKILL.md + memory stat) OR
`readAidlcInstall().currentVersion` is present OR a bare-PATH `aidlc --version`
yields a semver (`/\d+\.\d+\.\d+/`). Matches the three capability tests,
including "returns true when only a binary reports a version".

### updateChecker.ts — Amadeus Artifactory path, no GitHub/git fallback
- `VersionInfo` gains `channel` and `variantDisplayId`, populated on every return
  via `describeVariant(variant)` and `variant.channel`.
- AWS (`native-installer`) keeps the GitHub-releases path (display `aws`, current
  `2.9.0`, latest `2.9.1`, updateAvailable true).
- `checkAmadeusArtifactoryVersion()` resolves `latest` ONLY from the Artifactory
  feed via `curl` (mock keys on `cmd.includes('curl')`), filters by channel using
  `isPreviewVersion`, picks the highest with a full-version comparator, and sets
  `unknown` + `updateAvailable:false` on ANY failure. It NEVER calls
  `getLatestRelease()`, `getGitHubApiUrl()`, or `git ls-remote`; current version
  is the on-disk `amadeusVersion` else a FULL-string `--version` parse (captures
  the `-preview...` tail). I traced all six cases:
  - release channel ignores the `2.12.0-1a.1.0.0` preview → latest `2.11.0`.
  - preview channel → `2.11.0-1a.2.0.0`, display `amadeus-preview`.
  - feed throws → `unknown`.
  - "no bogus 7.161.26": the forbidden-command guard (`releases/latest`,
    `ls-remote`, `git `) is never hit; current comes from the full `--version`
    string `2.10.0-1a.1.1.0-preview.3`, latest `unknown`, display
    `amadeus-preview`.
  - HTML/unexpected feed shape → no tokens match `/^\d+\.\d+\.\d+/` → `unknown`.
  - Full-string compare drives `updateAvailable` (`latest !== 'unknown' &&
    current !== null && latest !== current`).

## PART 2 — two-row System panel display

- `src/services/repoVersionReader.ts` (new): pure `parseRepoAidlcVersion`
  (regex `/AIDLC_VERSION\s*=\s*["']([^"']+)["']/`, tolerant of single/double
  quotes and whitespace, returns null on no/malformed match, no I/O) plus
  `readRepoAidlcVersion(workspaceUri)` which reads `.kiro/tools/aidlc-version.ts`
  as TEXT via `vscode.workspace.fs.readFile` and NEVER imports/executes it and
  never throws (try/catch → null).
- `src/services/repoVersionReader.test.ts` (new): co-located, 7 cases covering
  double/single-quote, whitespace, suffixed value, missing export, malformed,
  and empty input; imports only the pure parser (vscode stubbed).
- `src/views/systemProvider.ts`: Row A `buildVersionItem()` renders
  `variantDisplayId` + currentVersion ('AWS/Amadeus/Amadeus (Preview) <ver>'),
  'Not installed' when none; preserves the `system-update` contextValue +
  `amadeus-aidlc.updateRules` inline affordance and the click-to-check command.
  Row B `buildRepoVersionItem()` shows the repo `AIDLC_VERSION` string or
  'Not configured'. fs reads live in the service layer (repoVersionReader),
  rendering in the view.

## Hard constraints

- No new framework-state writes: every new path READS install/version files only.
- No host-IDE-name branching beyond the existing `detectHostHarness()` appName
  check (grep confirms it is the only such site).
- No hardcoded extension-id lookup added (no `getExtension('...')` in any changed
  file).
- No new command registered — Row A reuses `checkForUpdates`/`updateRules`, Row B
  reads the file directly; `package.json` unchanged. (Had one been added the
  BOTH-places + `amadeus-aidlc.*` rule would apply; N/A here.)
- No `console.*` added to any changed file (grep clean).
- No `git commit`/`git push` performed: HEAD is the pre-existing setup commit and
  all change is in the working tree/untracked files.

## Findings

None. No blocking findings. Suite ends green (86 passed / 0 failing) with the
single baseline `no-console` lint warning at `src/extension.ts:37`.
