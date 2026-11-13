# Review — update-split task

Verdict: **APPROVED**

## Scope reviewed
Working-tree diff only (no commit made this step — confirmed via `git status`
and `git log`: HEAD is `40c1758`, which predates this task; index is empty).
Recorded verification in `verification.md` read in lieu of re-running build/lint/test.

## Requirements checked against the approved task

### Split into two independent operations
- `src/commands/update.ts` exposes `updateCli()` (operation 1: `aidlc update`
  via `updateChecker.updateCliBinary()`) and `updateWorkspace()` (operation 2:
  `RuleLoader.configureWorkspaceForVariant` → `aidlc config`, then post-op
  `aidlc doctor`). The two are genuinely independent — `updateCli` never calls
  `configureWorkspaceForVariant`, and `updateWorkspace` never calls
  `updateCliBinary` (asserted in `update.test.ts`).
- `updateChecker.ts` provides the two independent state checks:
  `checkCliUpdate()` (CLI-update availability, CLI-first via `aidlc update
  --check`, `cliAbsent` when no CLI) and `checkWorkspaceState()` (workspace
  refresh applicability: `configured` AND `cliPresent`, honestly reported,
  never inventing a target version).

### Combined action runs CLI FIRST, then workspace
- `updateRules()` runs `updateCliBinary()` (step 1), returns early on CLI
  failure so the workspace is not refreshed against a failed CLI, then
  `updateWorkspace()` (step 2). Enforced order verified by the
  `updateRules runs CLI FIRST, THEN the workspace refresh` test
  (`cliIdx < wsIdx`).

### System-panel wiring
- `src/views/systemProvider.ts`: the "Installed CLI" row (`buildVersionItem`)
  is MACHINE-scoped — driven purely by `versionInfo` from `UpdateChecker`
  (on-disk metadata / `aidlc --version`), NOT gated on `setupConfigured`. The
  `loadVersionInfo` Row A comment and `RuleLoader.isWorkspaceConfigured` (now
  workspace-only, no CLI OR-in) together make this correct, fixing the original
  "folder empty but Setup says installed" / "CLI says not installed" bugs.
  The CLI-update-available item (`contextValue: system-update`) → `updateCli`;
  the "AIDLC Framework" row (`contextValue: system-repo-version` /
  `system-repo-version-na`) → `updateWorkspace`.
- `package.json` `view/item/context` menus bind `updateCli` to
  `viewItem == system-update` and `updateWorkspace` to
  `viewItem == system-repo-version`, matching the context values emitted.

### New commands registered in BOTH places
- `package.json` `contributes.commands`: `amadeus-aidlc.updateCli` and
  `amadeus-aidlc.updateWorkspace` added; `amadeus-aidlc.updateRules` retitled
  to the combined action.
- `src/extension.ts`: both new commands registered, and the legacy
  `amadeus-aidlc.updateRules` kept and wired to `updateCmd.updateRules()`.
  The 5s auto-check and the `updateCli` info-message follow-up route correctly.

### PART B — loud fallback logging
- `src/commands/setup.ts`: every fall-through logs an explicit `[AIDLC fallback]`
  line stating CLI-first was attempted, why it is falling back (with the
  underlying error message), and that the legacy clone/dist path is now tried —
  in both `executeWithPresentCli` and `executeWithBootstrap`, plus an entry log
  in `installViaFallback`. A `RepoAccessError` is correctly re-thrown (access,
  not a path failure) instead of silently cloning.
- `src/services/updateChecker.ts`: `pullLatest`, `updateCliBinary`, and
  `updateViaRepoInstaller` all emit `[AIDLC fallback]` / `[AIDLC legacy path]`
  lines with the same shape, including the "no CLI present" case.

### PART B — detectCliPresence robustness
- `src/services/cliPresence.ts` reuses `aidlcBinaryCandidates()` (real
  Windows `%LOCALAPPDATA%\aidlc\bin\aidlc` + legacy fallbacks; Unix
  `~/.aidlc/bin`, `~/.local/bin`, `/usr/local/bin`), then layers on-disk
  metadata (`readAidlcInstall`) and a `--version` probe. Resolution is purely
  additive (binary OR metadata OR version establishes presence), so detection
  is strengthened, not weakened. Never throws.

### PART B — dist-not-found error guides to CLI-first
- `src/services/ruleLoader.ts` `installFramework`: the dist-missing branch now
  logs a `[AIDLC fallback]` line and throws an error that explains 2.10+ no
  longer ships `dist/<harness>/` and directs the user to install the `aidlc`
  CLI (auto-detected, avoids the legacy path) and re-run setup — replacing the
  bare "not found" message from the original report.

### Original `-File <url>` bug (message 8) and Mac/Homebrew (messages 4–5)
- `src/services/installCommands.ts` `buildAmadeusMachineSetupCommand` branches
  on remote-URL vs local path: Windows remote uses `irm | iex` scriptblock
  (never `-File <url>`), local uses `-File`; Unix remote pipes `curl | sh -s`,
  local runs `sh <path>`. This is the structural fix for the reported
  "Illegal characters in path" error.
- `src/services/gitInstaller.ts` adds a macOS ladder (Homebrew if present →
  Command Line Tools → download link) that explicitly never installs Homebrew
  itself, matching the user's "home brew must be installed as well... if you
  can handle that" guidance.

## Constraints
- No commit/stage/push this step — confirmed.
- Read-only companion: all mutations go through the CLI (`aidlc config`/
  `aidlc update`) or framework-file copy; no workflow STATE
  (`aidlc-state.md`, audit) is written. OK.
- No host-IDE branching beyond `resolveHarness`; `process.platform` branching
  only. OK.
- No hardcoded publisher/name id lookups introduced. OK.
- `amadeus-aidlc.` prefix on all ids; the two new commands present in BOTH
  `package.json` and `extension.ts`. OK.
- No new `console.*`: grep finds the single pre-existing `console.error` at
  `src/extension.ts:38` and nothing else, matching the recorded lint result
  (1 warning, the pre-existing one). OK.
- Smallest-change / reuse: `cliPresence` reuses existing helpers; shared
  `handleUpdateError`; `configureWorkspaceForVariant` reuses `runAidlcConfig`.
  OK.

## Verification evidence
`verification.md` records `npm run compile` PASS (exit 0), `npm run lint` PASS
(0 errors, 1 pre-existing warning at extension.ts:38), `npm run test` PASS
(152/152, 14 files; +10 net new covering the split, order enforcement, refuse
paths, cliAbsent, and the cross-platform update-check block). Required
verification is present; no missing suite.

## Findings
None. No reachable correctness, security, or data-loss blocker found; the
change meets the approved requirements and adds no unrequested behavior.
