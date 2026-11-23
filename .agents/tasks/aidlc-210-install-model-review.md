# Review — AIDLC Studio Amadeus 2.10+ install/update model (commit `daf656b`)

Verdict: **APPROVED**

Scope reviewed: the single committed change `daf656b` ("fix: move Amadeus to
CLI-driven install/update and harden update prompt"). The working tree is clean
(`git diff HEAD` empty); the change is wholly in that commit. Judged against the
task brief (Part A + Part B) and the authoritative investigation report
`aidlc-210-install-model.md`.

## Evidence examined

- `git show daf656b` (full diff; 8 files, +297/-36).
- `src/services/updateChecker.ts` (Part A gate, `pullLatest` routing,
  `checkNativeInstallerVersion`, `isComparableVersion`, `compareFullVersion`).
- `src/commands/setup.ts` (install `switch (variant.installMethod)`).
- `src/services/ruleLoader.ts` (`installViaAmadeusCli`, `runAidlcConfig`,
  retained legacy `installViaRepoInstaller`/`installFramework`/`cloneAidlcRepo`).
- `src/services/installCommands.ts` (`buildAmadeusMachineSetupCommand`,
  retained `buildRepoInstallerCommand`).
- `src/services/variants.ts` (Amadeus entry, `InstallMethod` union, `DoctorMode`).
- `src/services/aidlcCli.ts` (`doctor('native'|'bun-tool'|'auto')`).
- `src/commands/update.ts` (post-update doctor, `RepoAccessError` handling).
- `src/commands/setup.ts` `RepoAccessError` handling.
- Tests: `updateChecker.test.ts`, `installCommands.test.ts`, `variants.test.ts`.
- `src/extension.ts:37` (the sole pre-existing `no-console` warning).
- Recorded verification in the commit message (per instruction, not re-run).

## Part A — spurious "update available" prompt

Confirmed correct. `checkAmadeusArtifactoryVersion` no longer uses a raw string
`!==`. `updateAvailable` is now:

```
latestVersion !== 'unknown' &&
currentVersion !== null &&
isComparableVersion(currentVersion) &&
compareFullVersion(latestVersion, currentVersion) > 0
```

- Strictly-greater-only: the gate fires only when the feed's latest outranks
  current by `compareFullVersion` precedence, not on any format difference.
- Unparseable current → no false positive: `isComparableVersion` requires a
  numeric `X.Y.Z` core before any prompt, so a non-semver banner
  (`aidlc dev-build`) yields `updateAvailable=false` even when the feed resolves.
- Genuine newer-available preserved: `compareFullVersion('2.12.0','2.10.0') > 0`
  still prompts.
- AWS `checkNativeInstallerVersion` is untouched (still a plain `!==` against the
  GitHub release) — matches "unchanged unless a clear same-class improvement",
  and none was required.

Tests cover the three required cases plus two extras:
`equal-after-normalization → no prompt`, `genuinely newer feed → prompt`,
`unparseable current → no prompt`, and additionally `installed newer than feed →
no prompt`. All consistent with the implemented gate.

Note (non-blocking): the first Part A test ("equal after normalization") feeds an
identical preview token on both sides, so it exercises the equal-precedence path
rather than the format-mismatch path its comment narrates; the format-mismatch
case is actually exercised by the "installed newer than feed" test. This is a
comment/test-naming nit only — the behaviour under test is correct and the
assertions pass.

## Part B — Amadeus 2.10+ CLI model

Confirmed correct.

- Setup routing: `setup.ts` `switch (variant.installMethod)` gains an explicit
  `case 'amadeus-cli' → installViaAmadeusCli`. Amadeus no longer hits
  `installViaRepoInstaller`. `installViaAmadeusCli` runs the machine installer
  then calls `this.runAidlcConfig(workspaceUri, harness)` — the same private
  method AWS uses, reused verbatim, not duplicated.
- Update routing: `pullLatest` routes `native-installer || amadeus-cli` →
  `updateViaNativeCli` (`aidlc update`). Amadeus no longer hits
  `updateViaRepoInstaller`.
- Version-check source unchanged: Amadeus still resolves latest only from the
  Artifactory feed (`checkAmadeusArtifactoryVersion` → `resolveLatestFromFeed`);
  never GitHub/`git ls-remote`. The feed URL field carries an explicit
  "CORRECT — do not change / Artifactory-only, never GitHub" comment.
- SSO-gated unknowns isolated: the machine-setup command lives behind one
  builder, `buildAmadeusMachineSetupCommand` (`install-aidlc.ps1
  -SkipCredentials` / `--skip-credentials`), with a prominent ASSUMPTION block.
  The uncertain Amadeus variant fields (`installMethod`, `doctorMode → native`,
  `installScriptUrl`, dead `distPath`) each carry an "ASSUMPTION pending
  confirmation on a real Amadeus 2.10+ machine" comment.
- Legacy path retained, not deleted: `repo-installer`,
  `installViaRepoInstaller`, `installFramework`, `cloneAidlcRepo`,
  `buildRepoInstallerCommand` all remain and are still reachable via the custom
  `git-clone-copy` variant (`getVariant` forces that method for a custom
  `rulesSource`). `updateViaRepoInstaller` remains the update path for that
  variant.
- Exhaustive branches updated, no silent fall-through: `InstallMethod` gains
  `amadeus-cli`. `setup.ts` switch covers `native-installer`, `amadeus-cli`,
  `repo-installer` explicitly, with `default` = `git-clone-copy` (all four
  members). `updateChecker.pullLatest` and `checkForUpdates` both branch
  `amadeus-cli` explicitly. No `installMethod` switch exists in `ruleLoader`
  (routing lives in `setup.ts`), so nothing there to miss.
- `RepoAccessError` friendly message still works: the custom `git-clone-copy`
  path still runs `installViaRepoInstaller → cloneAidlcRepo`, which throws the
  typed error; `setup.ts` and `update.ts` both still catch it. Reachable.
- Post-update doctor unchanged: `update.ts` still calls `cli.doctor()` (auto).
- doctorMode change isolated and not broken: `DoctorMode` union is unchanged
  (`native | bun-tool`); Amadeus moves to `native`, which `AidlcCli.doctor`
  handles via `runNativeAidlc(['doctor'])`. The change carries an assumption
  comment and a revert pointer. Not broken for either mode.

## Constraints

- Read-only companion / no framework STATE mutation: the change only shapes and
  runs external installer/CLI commands; it writes no framework state file.
- No host-IDE detection beyond existing helpers: `installViaAmadeusCli` branches
  on `process.platform` (OS) and `resolveHarness(variant)` only. No new
  host-IDE detection, no hardcoded publisher/name id lookup.
- `amadeus-aidlc.` prefix preserved (config read keeps it; no command IDs
  touched).
- Smallest change, no drive-by refactors.

## Verification (read from the commit message, not re-run per instruction)

- `npm run compile`: exit 0 (clean).
- `npm run lint`: exit 0, one pre-existing `no-console` warning at
  `src/extension.ts:37` (confirmed by read: `console.error` in the activation
  catch, outside this diff) — the only warning, no new ones.
- `npm run test`: 8 files, 96 tests passed, including the updated
  `installCommands.test.ts` / `updateChecker.test.ts` / `variants.test.ts` and
  the new Part A precedence cases and the Amadeus `aidlc update` routing test.

No material correctness, security, or data blockers found. The one observation
(Part A test naming/comment) is cosmetic and does not affect behaviour or
coverage.
