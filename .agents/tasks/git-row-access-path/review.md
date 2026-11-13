# Review — Git CLI row, variant access pre-check, Mac aidlc-on-PATH fix

Commit under review: `40c1758` on `main` (one commit ahead of `origin/main`).
Verdict: **APPROVED** — no blockers.

## Scope checked
Diff vs `232ec11` across `package.json`, `src/extension.ts`, `src/commands/setup.ts`,
`src/views/systemProvider.ts`, `src/services/{gitInstaller,variantAccessChecker,pathExport,ruleLoader}.ts`,
plus the three new test files. New untracked task notes only under `.agents/`.

## Evidence used
Recorded verification in the commit message and `notes.md`:
- `npm run compile` → exit 0, no errors.
- `npm run lint` → exit 0, 1 warning only (the pre-existing `no-console` in `extension.ts`, shifted one line by an added import; I confirmed no new `console.*` in any changed source via grep).
- `npm run test` → all passing, +new tests for gitInstaller, variantAccessChecker (incl. git-absent skip), pathExport.

I did not re-run the suites (instructed not to). The recorded verification is appropriate for this read-only extension: pure helpers (`parseGitVersion`, `gitDownloadUrl`, `classifyAccessFailure`, `isGitUnavailable`, `isAccessGated`, `planPathExport`) and mocked `check()` paths are unit-tested; the vscode UI glue is thin and not unit-testable without a host.

Minor record inconsistency (not a blocker): the commit message cites 126 passing tests while `notes.md` cites 122. The suites still pass either way; the count is cosmetic.

## Part 1 — Git CLI row + installer (mirrors bun)
- `buildGitItem()` in `systemProvider.ts` mirrors `buildBunItem()`: loading (`loading~spin`), installed (green `pass-filled`, version shown), missing (`cloud-download` warning → `amadeus-aidlc.installGit`). ✔
- Git checked in the **fast/local Phase 1** of `loadStatus` alongside bun, never in the async network phase. ✔
- Graceful per-OS degrade with correct links: Windows `winget install --id Git.Git` else `git-scm.com/download/win`; macOS `xcode-select --install` else `.../download/mac`; Linux never a blind package-manager install, points at `.../download/linux`. Always confirms with a modal first. ✔
- `amadeus-aidlc.installGit` registered in **both** `package.json` (`contributes.commands`) and `src/extension.ts` (`registerCommand`, wired to `gitInstaller.install()` then `reloadStatusAndViews`). ✔

On "Health row folds in git": the implementation deliberately keeps Health gating on framework + bun only and makes Git purely informational. This matches the authoritative user request — message 9 asks for a git row with the same green/red display as bun ("same logic as bun cli"), and message 11 scopes it to "add only git cli for now, similar to bun." The user never asked git to gate Health, and bun gates Health precisely because it is a hard prerequisite (git is explicitly not). The choice is internally coherent and consistent with the user's words, so the divergence from the brief's checklist phrasing is not a defect.

## Part 2 — variant access pre-check before prerequisites
- `setup.ts` reorders to: pick variant → access pre-check (gated variants only) → ensure bun → install (per variant method) → gitignore → doctor. The access check runs at "Step 1/3" strictly before "Step 2/3: Checking bun," directly fixing the message-8 complaint ("asking to install bun before checking access"). ✔
- On no access, it throws `RepoAccessError` and the catch shows the friendly "you don't have access / restricted / choose open-source" message; nothing is installed because bun install has not yet run. ✔
- `VariantAccessChecker.check()` returns `{ accessible: true }` for AWS with **no network call** (verified by `isAccessGated` short-circuit and the "no network call" unit test). ✔
- `git ls-remote` runs **only** for access-gated variants (`amadeus-cli` / `repo-installer` / `git-clone-copy`), with a 15s timeout and `GIT_TERMINAL_PROMPT=0`. `Shell.run` merges the `env` and honors `timeout`. ✔
- Auth/not-found classification reuses the same regex family as `cloneAidlcRepo`; unclassified failures degrade to a clean generic reason and never leak raw git output (unit-tested). ✔

On "git-presence → access check → prerequisites (git then bun)": the implementation makes git a *soft* input to the pre-check rather than a setup prerequisite. When git is absent the pre-check returns `{ accessible: true, reason: git-unavailable-skip }` so setup proceeds and the install-time `RepoAccessError` remains the authoritative backstop. This is a sound, reachable-path-safe degrade and aligns with message 11 ("add only git cli for now") — git is offered via its own row, not force-installed by setup. Not a defect.

## Part 3 — Mac/Unix non-interactive PATH for the aidlc CLI
- `ensureAidlcOnPath()` is called after a **successful** install + harness-config in **both** `installViaNativeInstaller` and `installViaAmadeusCli` (both call sites sit after awaited steps that throw on failure, so a failed install never reaches it). ✔
- Writes a marker-guarded (`AIDLC Studio — aidlc on PATH`) export to `~/.zshenv` and `~/.bashrc`, idempotently (via the pure `planPathExport`/`applyPathExport` helpers; unit-tested for append-once / no-op-when-present / empty-file / repeated plans). ✔
- No-op on Windows (`process.platform === 'win32'` early return; relies on the installer's registry PATH, same as bun). ✔
- Updates `process.env.PATH` for the current session. Bin dir chosen is whichever of `~/.local/bin` / `~/.aidlc/bin` actually holds the binary (preferring `~/.local/bin`), matching the confirmed Mac "aidlc is interactive-only" symptom. ✔

## Constraints
- No host-IDE branching introduced; platform branches are on `process.platform` only. ✔
- No hardcoded publisher/name extension id; `SystemProvider` takes injected services. ✔
- All new command IDs and context use the `amadeus-aidlc.` prefix. ✔
- No new `console.*`; lint warning count unchanged (1 pre-existing). ✔
- Change is focused and additive; pure helpers factored for testability. ✔

## Amadeus routing (explicitly confirmed)
- `variants.ts` Amadeus entry: `installMethod: 'amadeus-cli'`.
- `setup.ts` switch: `'amadeus-cli'` → `installViaAmadeusCli`.
- `installViaAmadeusCli` → `buildAmadeusMachineSetupCommand`, which emits `-SkipCredentials` / `--skip-credentials` and builds **no** `--target` / `--harness`.
- The only `-Target`/`-Harness` builder (`buildRepoInstallerCommand`) is used solely by the legacy/custom `git-clone-copy` path and is unchanged. ✔

## Findings
None. No reachable correctness, security, or data-loss issue. The two divergences from the brief's checklist phrasing (git not folding into Health; git not a forced prerequisite) are reconciled against the authoritative original user request and are correct.
