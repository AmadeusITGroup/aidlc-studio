# Verification — Make AIDLC Studio work in both VS Code and Kiro

## Change summary

Removed the two hardcoded `vscode.extensions.getExtension('amadeus.aidlc-studio')`
self-lookups in `src/views/welcomePanel.ts` and replaced them with
`vscode.ExtensionContext`-based resolution threaded from `activate()`.

- `WelcomePanel.show()` → `WelcomePanel.show(context: vscode.ExtensionContext)`.
  Logo webview URI now built from `context.extensionUri`
  (`asWebviewUri(Uri.joinPath(context.extensionUri, 'resources', 'AIDLC Studio Logo.png'))`).
- `getVersion()` → `getVersion(context)`, returning
  `context.extension.packageJSON.version ?? ''`.
- Both call sites in `src/extension.ts` (the `amadeus-aidlc.openWelcome` command
  handler and the first-activation `showWelcomeOnStartup` block) now pass `context`.
- Existing fallbacks preserved: `<img>` logo → `<h1>AIDLC Studio</h1>` when the
  URI is undefined; version badge omitted when version is empty.

This makes the welcome page's logo and version badge survive a different
publisher, side-loading, or alternative packaging — and work identically under
stock VS Code and Kiro, with no IDE-identity branching.

## Review-iteration fix (addresses CHANGES_REQUESTED on commit 4a76b38)

The prior commit `4a76b38` entangled the in-scope welcomePanel fix with an
out-of-scope removal of `ExtensionUpdateChecker`: it dropped the
`ExtensionUpdateChecker` import, instantiation, the `SystemProvider` 4th
constructor argument, and the two self-update command registrations from
`src/extension.ts`, but the matching cleanup to `systemProvider.ts`,
`package.json`, and the deletion of `extensionUpdateChecker.ts` live only as
uncommitted working-tree changes belonging to the separate logo/sidebar task.
The committed tree therefore failed `tsc` with `TS2554` (SystemProvider still
requires the 4th `ExtensionUpdateChecker` parameter).

Resolution (per review Option B — keep this task scoped to welcomePanel):
reverted the `ExtensionUpdateChecker` changes in `src/extension.ts` so it again
constructs `SystemProvider(ruleLoader, updateChecker, bunInstaller,
extUpdateChecker)` and re-registers `amadeus-aidlc.checkExtensionUpdate` /
`amadeus-aidlc.updateExtension`. The commit now touches only welcomePanel-scoped
code and is self-consistent with the committed `systemProvider.ts` (4-param),
`extensionUpdateChecker.ts` (present), and `package.json` (two commands present).

## Verification method (addresses "evidence must match the commit")

Because the main working tree carries the separate logo/sidebar task's
uncommitted changes (3-param `systemProvider.ts`, deleted
`extensionUpdateChecker.ts`), the suites were run against the EXACT committed
tree in an isolated detached worktree (`git worktree add --detach` at the
commit, with the scoped `extension.ts` applied), using the main tree's
`node_modules`. The worktree was removed afterward. This guarantees the evidence
below reflects the committed state, not the working tree.

## Full-audit result

Grep over `src/**/*.ts` for `getExtension(`, `env.appName`, `env.appHost`,
`env.uriScheme`, and the literal `amadeus.aidlc-studio`:

- Only self-lookups were the two in `welcomePanel.ts` (now removed/host-agnostic).
- `WorkspaceDetector.getExtension` is an unrelated private file-extension parser —
  left untouched.
- `docsPanel.ts` / `analyticsPanel.ts`: self-contained HTML, no bundled-resource
  loading, no extension lookup — no change needed.
- `updateChecker.ts` / `update.ts`: git/curl/GitHub-releases with try/catch
  graceful degradation; no Marketplace / VS-Code-only update assumption;
  `openExternal` targets external URLs — left as-is.
- `bunInstaller.ts` / `shell.ts` / `aidlcCli.ts`: branch only on
  `process.platform` and read generic env/paths — no IDE-specific assumption,
  no change.
- `package.json` `engines.vscode "^1.85.0"`: left as-is (Kiro reports a
  compatible engine); not raised.

Post-change grep for `vscode.extensions.getExtension` / `amadeus.aidlc-studio`
in `src/`: **no matches**.

## Commands run against the committed tree (single-run mode)

- `tsc -p ./` (compile) — PASS, exit 0, no TypeScript errors.
- `eslint src --ext ts` (lint) — PASS, exit 0, 0 errors, 1 warning
  (pre-existing `no-console` at `src/extension.ts:38`, not introduced here).
- `vitest --run` (test) — PASS, 14/14 tests across 2 files.

Temp verification worktree cleaned up; no temp files left behind.

## Note on the untracked logo asset (non-blocking review finding)

`resources/AIDLC Studio Logo.png` is produced by the companion logo/sidebar task
and is untracked here; it is intentionally NOT part of this welcomePanel commit.
Because `context.extensionUri` is always truthy at runtime, the `<img>` branch
renders and a missing asset would show a broken image rather than the `<h1>`
text-brand fallback. This is a sequencing coupling to the companion task (which
ships the asset), not a logic defect in welcomePanel. Flagged for release
sequencing; no code change made here.
