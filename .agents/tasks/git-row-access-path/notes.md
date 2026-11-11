# Git row + variant access pre-check + Mac aidlc-on-PATH — implementation notes

Workspace: `c:\Github\aidlc-studio`. Edited in place on `main` (no worktree).

## What changed

### Part 1 — "Git CLI" row + git installer (mirrors bun)
- `src/services/gitInstaller.ts` (new): `GitInstaller` with `check()` /
  `install()` / `ensure()` mirroring `BunInstaller`. `check()` runs
  `git --version`, parses the semver (`parseGitVersion`), resolves the path via
  `where git` / `which git`, swallows failures to `{ installed: false }`.
  `install()` is per-platform with graceful link fallback: Windows →
  `winget install --id Git.Git -e --source winget` else
  https://git-scm.com/download/win ; macOS → `xcode-select --install` else
  https://git-scm.com/download/mac ; Linux → never a blind package-manager
  install, show https://git-scm.com/download/linux with a distro-pm note.
  Always confirms with a modal first. No non-interactive-PATH rc writing (git
  installers put git on the global PATH).
- `src/services/gitInstaller.test.ts` (new): version-parse, per-platform link,
  and `check()` state (installed+path / installed-no-path / absent).
- `src/views/systemProvider.ts`: `buildGitItem()` mirrors `buildBunItem()`
  exactly (loading / installed green `pass-filled` / missing warning
  `cloud-download` → `amadeus-aidlc.installGit`). git checked in the fast/local
  Phase 1 of `loadStatus` (same as bun), `gitInstalled`/`gitVersion` fields,
  pushed into `getChildren()` right after the bun row. The Git row is purely
  informational: clicking it installs ONLY git (no setup flow), and git does
  NOT affect the Health row (scope change — Health gates on framework + bun).
- `package.json` + `src/extension.ts`: registered `amadeus-aidlc.installGit`
  in BOTH, wired to `gitInstaller.install()` then `reloadStatusAndViews()`,
  mirroring `installBun`. `SystemProvider` now takes a `GitInstaller`.

### Part 2 — check variant ACCESS before installing prerequisites
- `src/services/variantAccessChecker.ts` (new): `VariantAccessChecker.check()`
  — AWS → always `{ accessible: true }` (no network); gated variants
  (amadeus-cli / repo-installer / git-clone-copy) → `git ls-remote <repoUrl>`
  with a 15s timeout and `GIT_TERMINAL_PROMPT=0`. Pure `classifyAccessFailure`
  reuses the exact auth/not-found regexes from `cloneAidlcRepo`; unclassified
  failures degrade to a clean generic reason (never leaks raw git output).
  `isAccessGated()` helper.
  - GIT-ABSENT GRACEFUL SKIP (scope change): the access pre-check USES git only
    if present. `isGitUnavailable()` detects "git executable can't spawn"
    (ENOENT / "command not found" / Windows "not recognized"), distinct from a
    remote auth/not-found response. When git is unavailable, `check()` returns
    `{ accessible: true, reason: GIT_UNAVAILABLE_SKIP }` so setup PROCEEDS to
    the normal install (install-time `RepoAccessError` is the authoritative
    backstop). A genuine auth/not-found from `git ls-remote` still
    short-circuits with the friendly "no access" message.
- `src/services/variantAccessChecker.test.ts` (new): classification (auth /
  not-found / unrelated), `isGitUnavailable` (spawn-failure vs remote-response),
  `isAccessGated`, AWS-no-network, ls-remote success/fail, no-leak, custom
  variant, and git-absent → skip-pre-check (ENOENT + Windows "not recognized").
- `src/commands/setup.ts`: reordered `execute`. New order (scope change): pick
  variant → access pre-check IF git available, else silently skip (STOP via
  `RepoAccessError` only on a genuine auth/not-found) → ensure bun (the ONLY
  setup prerequisite) → framework install (RuleLoader's `RepoAccessError` is
  the real backstop) → doctor. **git is NOT a setup prerequisite** — never
  ensured/installed by setup. Friendly message reuses the existing
  `RepoAccessError` catch.

### Part 3 — Mac/Unix non-interactive PATH for the aidlc CLI
- `src/services/pathExport.ts` (new): small shared, dependency-light helper for
  the "append a PATH export to ~/.zshenv + ~/.bashrc guarded by a marker"
  pattern (`planPathExport` is the pure idempotency decision;
  `buildPathExportBlock`, `nonInteractiveShellEnvFiles`, `applyPathExport`).
- `src/services/pathExport.test.ts` (new): marker/idempotency (append once,
  no-op when present, empty file, repeated plans).
- `src/services/ruleLoader.ts`: `ensureAidlcOnPath()` called after a successful
  CLI install in BOTH `installViaNativeInstaller` and `installViaAmadeusCli`.
  Unix: picks the bin dir that actually exists (prefer `~/.local/bin`, then
  `~/.aidlc/bin`), writes the guarded export, updates `process.env.PATH`.
  Windows: no-op (native installer updates registry PATH, like bun). Comment
  notes `/etc/paths.d` is the system-wide alternative but needs sudo, so the
  rc-file route (same as bun) is the permission-safe equivalent.

## Part 3 "important" verification (no re-fix of bugs #1/#2/#3)
Confirmed current `main` for Amadeus routes through `installViaAmadeusCli`
(not `installViaRepoInstaller`) and does NOT build `--target`/`--harness`:
- `variants.ts` Amadeus entry: `installMethod: 'amadeus-cli'`.
- `setup.ts` switch: `'amadeus-cli'` → `installViaAmadeusCli`.
- `installViaAmadeusCli` → `buildAmadeusMachineSetupCommand` uses
  `-SkipCredentials` / `--skip-credentials`, no `--target`/`--harness`.
- The only `-Target`/`-Harness` usage is `buildRepoInstallerCommand`, used ONLY
  by the legacy/custom `git-clone-copy` path. No change made there.

## Verification (run from workspace root)
- `npm run compile` → exit 0, no errors.
- `npm run lint` → exit 0, 1 warning only: the pre-existing `no-console` in
  `src/extension.ts` (shifted 37→38 by one added import line; same statement,
  no new warnings).
- `npm run test` → 11 files, 122 tests passed (was 96; +26 new).
