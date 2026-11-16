# Review: amadeus-align

Verdict: APPROVED

Evidence
- git status: 15 files modified (unstaged), 1 untracked README copy. Nothing staged. HEAD is still 21e0e4b, so there are no new commits. `my reference.md` and package.json are untouched.
- The coder's final message was not supplied. I spot-checked instead of re-running in depth: `tsc --noEmit` is clean, eslint shows 0 errors and 1 warning (the pre-existing one), and vitest passes 14 files / 171 tests.
- (1) The Amadeus URLs use `/scripts/`. The `/cli` base is kept only for variant detection.
- (2) and (3) `buildAmadeusInstallerTerminal` returns exactly the required Unix and Windows commands, with shellPath /bin/bash and powershell.exe. The test forbids irm, iex, `| sh`, `-File http` and preview. `buildAmadeusMachineSetupCommand` is gone.
- (4) `supportedHarnesses` includes copilot, the comment is fixed and the variants tests are updated.
- (5) `fixHookShellPath` runs `aidlc config runtime` when doctor reports the interactive-only PATH, then re-runs doctor. `ensureAidlcOnPath` runs only if that fails.
- (6) update.ts runs `--dry-run`, logs it, shows the modal "Apply these changes to this workspace?", then `config --yes`. It falls back to `--harness`, surfaces conflicts, and shows the new-chat reminder. The CLI-then-workspace order is kept.
- (7) The access check is a curl probe (curl.exe on Windows) with a 15s timeout, mapped to the friendly no-access result. The git path is kept for custom variants and AWS makes no network call.
- (8) `compareTail` compares tail identifiers numerically (1.10.0 > 1.9.0), and a test covers it. The comparison functions are exported. There is no preview logic.
- A. `launchAmadeusInstaller` uses `createTerminal({ name: 'AIDLC Installer', shellPath })`, `show()` and an un-awaited `sendText`. It runs before any bun install. The info message gives next steps, the eve amaiisdom note and a "Run Setup Again" button for `amadeus-aidlc.setup`.
- D. In setup.ts and updateChecker.ts the Amadeus flows no longer reach clone/dist. They log loudly and throw or show an error carrying the exact official OS command, plus an "Open Installer Terminal" action. `installViaAmadeusCli` and `buildAmadeusMachineSetupCommand` are deleted, and grep finds no remaining references. clone/dist remains only for custom git-clone-copy.
- No new console.* and no new commands or config keys. New tests contain no process.env or homedir references.

Non-blocking notes
- The dry-run modal, the doctor PATH fix and the new-chat reminder are not variant-gated, so AWS update/setup also gains them. AWS `configureWorkspace` no longer calls `ensureAidlcOnPath` unconditionally. This follows (5) and (6), which are not Amadeus-scoped, but it is a small AWS behaviour change.
- The access probe uses `curl -I` (HEAD). A server that rejects HEAD would read as no access. This is unverified against the real Artifactory.
