# Verification — update-split task

Workspace root: `c:\Github\aidlc-studio`. All commands run from there.
Nothing was committed, staged, or pushed — all changes are left in the working tree.

## Commands run and results

### 1. `npm run compile`  (tsc -p ./)
- Result: **PASS** — exit code 0, no TypeScript errors. (The only stderr is the
  benign `npm notice` banner; `$LASTEXITCODE` = 0.)

### 2. `npm run lint`  (eslint src --ext ts)
- Result: **PASS** — 0 errors, **1 warning**, and it is the single pre-existing
  one:
  ```
  src/extension.ts
    38:5  warning  Unexpected console statement  no-console
  ✖ 1 problem (0 errors, 1 warning)
  ```
  No new warnings were introduced. No new `console.*` added.

### 3. `npm run test`  (vitest --run, one-shot)
- Result: **PASS** — **152 tests passed (14 files)**, 0 failed.
  ```
  Test Files  14 passed (14)
       Tests  152 passed (152)
  ```
- Baseline was 142; +10 net new tests:
  - updateChecker.test.ts: CHECK suite rewritten to the `aidlc update --check`
    CLI-first model (AWS available / Amadeus up-to-date / precedence-only-latest
    / CLI-check-errors→unknown-no-fallback / CLI-absent→cliAbsent-no-network),
    plus `parseCliUpdateCheck` unit tests and a darwin/win32/linux
    update-check cross-platform block. (19 tests total in this file.)
  - update.test.ts (NEW): updateCli vs updateWorkspace split, enforced
    CLI-then-workspace order in updateRules, workspace refuse-when-no-CLI /
    refuse-when-unconfigured, cliAbsent no-upgrade, accept→updateCli. (7 tests)
  - setup.test.ts: added loud `[AIDLC fallback]` logging assertions.
  - variants.test.ts: artifactory feed field assertion replaced with
    "field removed" assertion.

## Notes
- The Artifactory-feed scrape and GitHub-releases lookup CHECK paths were
  DELETED (see summary); their tests were replaced, not disabled.
- All existing non-check tests (pullLatest CLI-first + fallback, AWS native
  update path, cliPresence, installCommands, ruleLoader, etc.) remain green.
