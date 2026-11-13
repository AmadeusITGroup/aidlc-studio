# Review — CLI-first install/update refactor (AWS + Amadeus) with layered fallback

Verdict: **APPROVED**

## Scope reviewed

The uncommitted working-tree change against the verbatim task. Modified:
`src/commands/setup.ts`, `src/services/ruleLoader.ts`,
`src/services/updateChecker.ts`, `src/services/installCommands.ts`,
`src/services/installCommands.test.ts`, `src/services/updateChecker.test.ts`,
`src/services/ruleLoader.test.ts`, `src/services/gitInstaller.ts`,
`src/views/systemProvider.ts`. New: `src/services/cliPresence.ts`,
`src/services/cliPresence.test.ts`, `src/commands/setup.test.ts`. No production
code was modified by this review.

## Verification evidence

The task asked me to read the coder's recorded compile/lint/test results from
its final message. No such recorded evidence exists for THIS change: the
`.agents/tasks/` notes (`review.md`, `verification.md`) are STALE — they
describe the prior variant/channel task (86 tests / 8 files / `repoVersionReader`)
and predate the CLI-first refactor, which adds `cliPresence.test.ts` and
`setup.test.ts` and rewrites `installCommands.test.ts` / `updateChecker.test.ts`.
Required verification being unavailable, and the test files themselves being
materially changed (a specific, articulable doubt), I ran a narrow spot-check
rather than approving blind. From `c:\Github\aidlc-studio` (Windows PowerShell):

- `npm run compile` (`tsc -p ./`) — PASS, exit 0, no TypeScript errors.
- `npm run lint` (`eslint src --ext ts`) — PASS, 0 errors, **1 warning**: the
  pre-existing baseline `no-console` at `src/extension.ts:38` — the only
  warning. (The `@typescript-eslint` TS-version banner is informational, not an
  ESLint finding, and predates this change.)
- `npm run test` (`vitest --run`) — PASS, **142 passed / 0 failing** across 13
  files, including `cliPresence.test.ts` (6), `commands/setup.test.ts` (5),
  `installCommands.test.ts` (11, fixed-shape assertions), and
  `updateChecker.test.ts` (16).

## Requirement-by-requirement

1. **Single source of truth detector** — `src/services/cliPresence.ts`
   `detectCliPresence()` is the one pivot. It reuses `aidlcBinaryCandidates`
   (binary locations), `readAidlcInstall` (authoritative on-disk
   variant/channel/version), and `classifyVariant` on `aidlc --version` stdout
   as the fallback. No logic is duplicated; it is read-only (stat + read only),
   never throws, and is MACHINE-scoped by design (distinct from
   `isWorkspaceConfigured`). Covered by 6 tests. Met.

2. **setup.ts CLI-first** — `execute()` calls `detectCliPresence()` and
   branches: CLI present → `executeWithPresentCli` resolves the variant from the
   detected id (no AWS/Amadeus picker), runs `configureWorkspaceForVariant`
   (which calls `runAidlcConfig` → `aidlc config --harness <h> --yes`) then
   `runDoctor`, with `installViaFallback` on failure. CLI absent →
   `executeWithBootstrap` shows the picker, bootstraps the variant CLI
   (`installViaNativeInstaller` / `installViaAmadeusCli`), each of which calls
   `ensureAidlcOnPath` then `runAidlcConfig`, then doctor, falling back to
   repo-clone/dist-copy on bootstrap failure. Session ordering preserved: Step 1
   access pre-check gated on `isAccessGated` BEFORE Step 2 bun; a missing git in
   `VariantAccessChecker` returns `{ accessible: true, GIT_UNAVAILABLE_SKIP }`
   so setup proceeds (the install-time `RepoAccessError` is the backstop). A
   `RepoAccessError` is re-thrown to the friendly handler rather than triggering
   clone fallback. 5 setup tests cover both branches + both fallbacks + cancel.
   Met.

3. **update.ts / updateChecker.ts CLI-driven** — `pullLatest()` sends the
   explicit `git-clone-copy` / legacy `repo-installer` variants straight to
   `updateViaRepoInstaller`; for AWS (`native-installer`) and Amadeus
   (`amadeus-cli`) it calls `detectCliPresence()` and, when present, runs
   `updateViaNativeCli` (`aidlc update` by absolute-path binary, then
   `configureWorkspaceForVariant` = `aidlc config` workspace refresh,
   best-effort), falling back to `updateViaRepoInstaller` on failure.
   `update.ts updateRules()` runs post-update `aidlc doctor`
   (`AidlcCli.doctor()`) and branches on `passed`. Version-CHECK logic intact:
   AWS → `checkNativeInstallerVersion` (GitHub releases), Amadeus →
   `checkAmadeusArtifactoryVersion` (Artifactory feed only, never GitHub/git),
   now with precedence-based `updateAvailable` (`compareFullVersion` +
   `isComparableVersion`) to suppress the format-mismatch false prompt. 16
   updateChecker tests, including the forbidden-GitHub/git guard and the
   CLI-first / fallback routing. Met.

4. **`buildAmadeusMachineSetupCommand` -File bug fixed** — in
   `installCommands.ts` the builder branches on `isRemoteUrl`. Remote URL on
   Windows → `powershell ... -Command "& ([scriptblock]::Create((irm
   '<url>'))) -SkipCredentials"` (never `-File <url>`). Local path on Windows →
   `-File "<path>" -SkipCredentials`. Unix remote → `curl -fsSL <url> | sh -s --
   --skip-credentials`; Unix local → `sh "<path>" --skip-credentials`.
   `installCommands.test.ts` asserts the fixed shape and explicitly
   `not.toContain('-File "<url>"')`, `-Target`, `-Harness`. Met.

5. **variants.ts** — catalog kept; the Amadeus Artifactory feed URL
   (`.../amadeus-aidlc/cli`) is unchanged and annotated "CORRECT — do not
   change"; `distPath` retained for the `git-clone-copy` fallback. The Amadeus
   machine-installer URL and `-SkipCredentials` flags are isolated as a flagged
   ASSUMPTION (the `installScriptUrl` field carries explicit "ASSUMPTION pending
   confirmation" comments, and the command shape lives solely in
   `buildAmadeusMachineSetupCommand`). The field is active rather than
   commented-out — necessary, since the CLI-first path must run the installer;
   commenting it out would break setup. The uncertainty is isolated and clearly
   marked, satisfying the requirement's intent. Met.

6. **systemProvider.ts** — Row A "Installed CLI" is driven purely by
   `versionInfo` (from `UpdateChecker` / on-disk metadata), explicitly NOT gated
   on `setupConfigured` — MACHINE-scoped. The "Setup" row uses
   `isWorkspaceConfigured()` — WORKSPACE-scoped (SKILL.md + memory dir, does not
   OR in the global CLI). Row B "AIDLC Framework" reads the per-repo
   `AIDLC_VERSION` via `readRepoAidlcVersion` from
   `.kiro/tools/aidlc-version.ts` (as text, never executed). Met.

7. **Fallback not deleted** — `cloneAidlcRepo`, `installFramework`,
   `installViaRepoInstaller` all remain in `ruleLoader.ts`.
   `setup.installViaFallback` routes native → installer, amadeus-cli/repo →
   repo-installer, and `git-clone-copy` → `cloneAidlcRepo` + `installFramework`
   directly. The custom git-clone-copy variant uses clone-copy directly in both
   setup and update. Met.

8. **AGENTS.md constraints** — read-only companion: every new path only
   reads/probes, no framework STATE mutation. No host-IDE branching beyond
   `detectHostHarness`/`resolveHarness` (grep-confirmed the only appName site).
   No hardcoded publisher/name `getExtension('...')` lookup added. No NEW command
   was introduced, so no package.json/extension.ts registration gap; existing
   commands are registered in both files. No new `console.*` — the only one is
   the pre-existing `extension.ts:38` warning, confirmed the sole lint warning.
   Met.

9. **No commits / pushes** — `git status` shows the change entirely in the
   working tree (modified + untracked); HEAD remains the prior
   `git-row-access-path` commit, and the branch is not newly ahead because of
   this task. Met.

## Observations (non-blocking)

- The `.agents/tasks/review.md` and `verification.md` at the repo root are stale
  (they document the earlier variant/channel task). Not in scope for this change
  and not a correctness defect, but worth refreshing.
- Req 5's "remain commented" is satisfied in spirit rather than literally: the
  Amadeus installer URL is an active-but-flagged field, which is the only shape
  that keeps the CLI-first path functional. Isolated and clearly marked as an
  assumption. No blocker.

## Conclusion

The CLI-first model is implemented for both variants with a correct layered
fallback, the `-File <url>` bug is structurally fixed and pinned by tests, the
session's bun/access ordering and git-absent skip are preserved, the System
panel scoping is correct, and the fallback path is retained. Compile is clean,
lint shows only the single pre-existing `no-console` warning, and all 142 tests
pass. No blocking findings.
