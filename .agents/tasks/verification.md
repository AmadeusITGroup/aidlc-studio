# Verification — variant/channel feature + two-row System version display

This note records the verification evidence for the variant/channel +
two-row-System-panel change (PART 1 + PART 2), replacing the prior stale note
that documented the unrelated welcomePanel / `getExtension` task (review B1).

## Change under test (working tree, uncommitted)

- `src/services/variants.ts` (modified) — `channel: 'release' | 'preview'` on the
  `AidlcVariant` type + catalog entries + `custom` overlay; amadeus carries the
  Artifactory `/cli` feed; new pure `describeVariant()` → `aws` | `amadeus` |
  `amadeus-preview`.
- `src/services/ruleLoader.ts` (modified) — `restoreVariant()` priority:
  on-disk `readAidlcInstall()` (authoritative, reconciles + persists
  `aidlc.variantId` AND `aidlc.channel`) → persisted state → file heuristic →
  binary `--version` probe → AWS/release default; capability-based
  `isWorkspaceConfigured()`; outputChannel optional + `?.`-guarded.
- `src/services/updateChecker.ts` (modified) — `VersionInfo` gains `channel` +
  `variantDisplayId`; Amadeus path resolves `latest` ONLY from the Artifactory
  feed (curl), channel-filtered, never GitHub/git; full-string version compare;
  on failure → `unknown`.
- `src/views/systemProvider.ts` (modified) — Row A "Installed CLI" + Row B
  "Repo configured".
- `src/extension.ts` (modified) — active-variant log line gains the resolved
  channel; no `console.*` added.
- `src/services/repoVersionReader.ts` (new) — pure `parseRepoAidlcVersion` +
  vscode-fs `readRepoAidlcVersion`; reads `.kiro/tools/aidlc-version.ts` as TEXT,
  never imports/executes it, never throws.
- `src/services/repoVersionReader.test.ts` (new) — covers the parser branches.

`package.json` unchanged (no new command/config key). No `git commit`/`git push`
performed — all git left to the user.

## Commands run (from `c:\Github\aidlc-studio`, Windows PowerShell, single-run mode)

- `npm run compile` (`tsc -p ./`) — **PASS**, exit 0, no TypeScript errors,
  emits to `out/`.
- `npm run lint` (`eslint src --ext ts`) — **PASS**, exit 0, **0 errors, 1
  warning** — the pre-existing baseline `no-console` at `src/extension.ts:37`
  (`Unexpected console statement`). No new warnings introduced. (A separate
  informational banner notes the local TypeScript 5.9.3 vs the plugin's
  officially-supported range; it is not an ESLint finding and predates this
  change.)
- `npm run test` (`vitest --run`, one-shot) — **PASS**, **86 passed / 0 failing**
  across **8 test files**:
  - `src/services/repoVersionReader.test.ts` — 7 (new)
  - `src/services/variants.test.ts` — 17
  - `src/services/variantDetector.test.ts` — 13
  - `src/services/installCommands.test.ts` — 7
  - `src/services/aidlcInstallReader.test.ts` — 19
  - `src/services/updateChecker.test.ts` — 6 (previously RED)
  - `src/services/ruleLoader.test.ts` — 11 (previously RED)
  - `src/services/stateParser.test.ts` — 6

The 12 previously-failing cases now pass (6 in `updateChecker.test.ts`, 11 in
`ruleLoader.test.ts` — the two suites together), and the 7 new
`repoVersionReader.test.ts` cases pass. No test was weakened or deleted;
production was changed to satisfy the asserted API.
