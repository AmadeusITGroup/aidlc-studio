# Review — Fix Amadeus/custom "Update AIDLC" by routing repo update through reinstall

Verdict: **APPROVED**

## Scope reviewed

- Delivery under review: commit `72a90bd` (`fix: route repo-based AIDLC update through the reinstall path`) on `main`, 2 commits ahead of `origin/main`. Working tree is clean (`git diff` empty), so the behavioral change is the committed fix.
- Approved task: the repo-based "Update AIDLC" button failed for the Amadeus/custom variant because the update did a blind dist-copy assuming a `dist/<harness>/.kiro` layout the Amadeus repo lacks. The fix routes the repo-based update through the same path setup/reinstall uses.

## Evidence (recorded + spot-checked)

The commit message records: `npm run compile` clean, `npm run lint` only the pre-existing `no-console` warning at `extension.ts:37`, `npm run test` 90 passed.

I spot-checked these because the committed `.agents/tasks/verification.md` is stale (it documents the earlier variant/channel feature set and reports 86 tests / "package.json unchanged", which conflicts with the final commit). The spot-check resolved the doubt in the coder's favor:

- `npm run compile` → exit 0, clean.
- `npm run lint` → 0 errors, 1 warning (`no-console` at `src/extension.ts:37`) — exactly the single pre-existing warning the task allows.
- `npm run test` → 8 files, **90 passed**, including `src/services/updateChecker.test.ts` (10 tests).

## Requirement-by-requirement

1. AWS variant update untouched — `UpdateChecker.pullLatest()` routes `installMethod === 'native-installer'` to `updateViaNativeCli()`, which still runs `aidlc update` via streaming shell. Test `AWS native update path is unchanged` asserts `aidlc update` runs and the RuleLoader is never touched (`installCount === 0`, `setVariantCount === 0`). Met.
2. Repo-based path reuses `RuleLoader.installViaRepoInstaller(workspaceUri)` — `updateViaRepoInstaller()` delegates to it; the loader clones (typed `RepoAccessError` on auth/not-found via `cloneAidlcRepo`), runs `scripts/install-aidlc.ps1`/`.sh` with `-Target <workspace> -Harness <harness>` (`buildRepoInstallerCommand`), falls back to legacy dist-copy (`installFramework`) only when the script is absent, and cleans up the temp clone. Met.
3. `amadeus-aidlc.updateRepoUrl` dropped — removed from `package.json contributes.configuration` and from the update path; repo-wide grep over `README.md`, `package.json`, and `src/**` finds no remaining reference (only a historical mention in `.agents/tasks/project-audit.md`, an audit doc, which is out of scope). Met.
4. Wiring — `extension.ts` constructs `new UpdateChecker(outputChannel, ruleLoader.variant, ruleLoader)` with the shared loader, and `updateChecker.setVariant(variant)` is applied after `restoreVariant()`. `updateViaRepoInstaller()` additionally calls `this.ruleLoader.setVariant(this.activeVariant)` before installing so the loader clones the correct repo/branch/harness. Met.
5. Version-CHECK logic — `checkForUpdates`, `getVersionInfo`, `checkAmadeusArtifactoryVersion`, feed resolution, and the AWS `checkNativeInstallerVersion` are present and exercised green by the six version-check tests. (See observation below on bundling.) Met for the task's intent.
6. Post-update `/aidlc --doctor` in `updateRules` untouched — `UpdateCommand.updateRules()` still runs `AidlcCli.doctor()` after `pullLatest()` and branches on `doctorResult.passed`. Met.
7. Progress UX + logging preserved — `updateViaRepoInstaller` and `updateViaNativeCli` both use `vscode.window.withProgress` with the `Updating AIDLC...` notification; `updateRules` still emits `=== Updating AIDLC ===` / `=== Update Complete ===`. Met.
8. `RepoAccessError` surfaces the friendly message — `UpdateCommand.updateRules` catches `RepoAccessError` and shows the same "You don't have access to …" message as `setup.ts`, before the generic error path. The error propagates unmodified through `updateViaRepoInstaller` (test `propagates RepoAccessError from the reinstall path`). Met.
9. No host-IDE detection/branching or hardcoded publisher id introduced — the update path resolves the harness through the pre-existing `resolveHarness()` in `variants.ts`; no `getExtension('publisher.name')` lookup and no new `appName` branching were added by this change. Met.
10. Tests added/updated — `updateChecker.test.ts` adds: Amadeus update delegates to `installViaRepoInstaller` (loader synced to active variant first), a `git-clone-copy` custom variant uses the same path, `RepoAccessError` propagation, and the AWS native path never touches the loader. Met.
11. compile/lint/test pass — confirmed above. Met.

## Observations (non-blocking)

- The fix commit `72a90bd` bundles an unrelated feature set (variant `channel`, `describeVariant`, the Artifactory version-check path `checkAmadeusArtifactoryVersion`/`resolveLatestFromFeed`, `repoVersionReader`, the two-row System panel, and the `restoreVariant`/`isWorkspaceConfigured` rework) alongside the approved update-path fix. These satisfy test files introduced in the prior `26f843f` commit and all pass, so they are not a correctness defect. The task's "version-CHECK logic must be untouched" constraint reads against a baseline that already contained that logic; in this repository it was committed together with the fix rather than before it. This is a commit-hygiene / scope-bundling observation, not a reachable failure — no blocker.
- `verification.md` in the repo is stale relative to the final commit (reports 86 tests and "package.json unchanged"). The commit message's recorded evidence is accurate and was reproduced. Worth refreshing but not blocking.

## Conclusion

The approved behavior is implemented correctly and completely: the repo-based update now reuses the setup/reinstall installer path, the AWS native path and the post-update doctor check are untouched, the dropped config key is fully removed, `RepoAccessError` surfaces the friendly message, and the UX/logging are preserved. Compile, lint (single allowed warning), and the 90-test suite pass. No blockers.
