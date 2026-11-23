# AIDLC Studio — Read-Only Project Audit

**Scope:** Whole-project pre-open-source quality review of the AIDLC Studio VS Code / Kiro extension (TypeScript) at `c:\Github\aidlc-studio`.
**Mode:** READ-ONLY. Nothing was modified, installed, committed, or pushed. All remediation below is advisory.
**Branch:** `main`. The working tree carries a large, uncommitted in-flight feature (variant/channel detection).
**Verification run during audit:** `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm audit`, `npm audit --omit=dev` (all read-only).

---

## Executive summary

Overall health: **good architecture, but the working tree is NOT in a shippable state right now.** The codebase is clean, well-commented, and the services/views/commands/providers separation is genuinely well kept. Open-source scaffolding (README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE, issue/PR templates, CI/CD, publish, dependency-review) is present and mostly high quality. The CI/CD and publish pipelines are above-average: hardened runners, least-privilege permissions, SLSA provenance, VSIX size guards, checksum verification, pinned publish tooling.

The single most important finding overturns a premise in the brief: **the test suite does not pass.** `npm run test` reports **12 failed / 67 passed (79 tests, 2 failing files)** — not the "91 tests pass" the brief expected. The in-flight variant/channel feature is **half-wired**: the two new pure modules (`variantDetector.ts`, `aidlcInstallReader.ts`) and their tests are complete and green, but the tests for `ruleLoader.ts` and `updateChecker.ts` describe a target API (`variant.channel`, `VersionInfo.variantDisplayId`, on-disk install reader wired into restore, Artifactory-feed version lookup) that the production code in those two files **has not yet been updated to provide.** `tsc --noEmit` and `eslint` still pass because the tests use structural/loose typing, so the break is only visible at runtime/test time.

This matters directly for the user's original goal (bugs #3–#9: wrong variant/version shown, bogus `7.161.26`, preview vs main). The failing tests encode the exact fixes the user asked for, and the production code has not caught up to them. See Area 2 and Area 4.

### Top 5 things to fix before an open-source release

1. **Make the test suite green (BLOCKER).** Finish wiring the in-flight feature: `ruleLoader.restoreVariant()` must consult `readAidlcInstall()` and persist a `channel`; `variants.AidlcVariant` needs a `channel` field; `updateChecker` must expose `variantDisplayId`/`channel` and use the Artifactory feed (not GitHub/`git ls-remote`) on the Amadeus path; `isWorkspaceConfigured()` must accept a binary-only install. A public repo whose `npm test` fails on a clean checkout reads as abandoned. (The in-flight work is uncommitted — this is expected mid-feature, but it must not ship or be the state a first visitor clones.)
2. **Resolve the "which version is installed in the repo" architecture question (HIGH, open decision).** Confirmed: clone-copy repos (`aidlc/` + `.kiro/`) store **no** framework version on disk — only an opaque `.aidlc-clone-id` and `harness.json`. The only authoritative version is the **global native install** metadata (`%LOCALAPPDATA%\aidlc`: `active-version` + `versions/<v>/version.json` `amadeusVersion` + `aidlc.settings.json`). `aidlcInstallReader.ts` already reads exactly that. Decide and document what "AIDLC Version" in the System panel actually reports (global install vs in-repo rules), because today the two can legitimately disagree.
3. **Remove internal/cruft files from the public repo (HIGH).** `$stage` (empty, a stray shell redirect artifact), `my reference.md`, `OPEN_SOURCE_READINESS.md`, `PRODUCT_FEATURES.md`, and the `.agents/tasks/` scratch (including this report) should not be in a public open-source tree. Some are gitignored/`.vscodeignore`'d for packaging but still tracked/visible in the repo.
4. **Add a Content-Security-Policy and `localResourceRoots` to all three webviews (HIGH, security/best-practice).** `welcomePanel.ts`, `docsPanel.ts`, `analyticsPanel.ts` all run with `enableScripts: true` and inline scripts/styles but set no CSP and no `localResourceRoots`. This is the standard VS Code webview hardening and marketplace reviewers look for it.
5. **Address the dev-dependency vulnerabilities and pin the floating action (MEDIUM).** `npm audit` = **15 vulns (2 critical, 9 high, 4 moderate)**, all transitive `undici` (dev-only; `npm audit --omit=dev` = 0, so no runtime/shipped exposure). Still worth clearing before the repo is public and Dependabot opens ~15 alerts. Separately, `aquasecurity/trivy-action@master` is unpinned in both CI workflows.

---

## Area 1 — Architecture & structure

The layering is clean and the "read-only companion" discipline holds.

- **NICE** Separation is real. `services/` hold logic, `views/` render, `commands/` orchestrate, `providers/` host the CodeLens provider, `types/` centralizes shared types (`src/types/index.ts`). Views receive data via injected services (e.g. `SystemProvider` takes `RuleLoader`, `UpdateChecker`, `BunInstaller`). No god-objects.
- **NICE** `StateManager` (`src/services/stateManager.ts`) is deliberately stateless — every call reads fresh from disk, `invalidateCache()`/`setCurrentState()` are explicit no-ops. This is the right model for a read-only visualizer and is well documented.
- **LOW** The new `variantDetector.ts` / `aidlcInstallReader.ts` split is coherent *in isolation*: both are pure, `vscode`-free, unit-testable, and each isolates its assumptions behind named constants. The problem is integration, not design — they are not yet consumed by `ruleLoader.ts`/`updateChecker.ts` (see Area 2/4). Once wired, the split is a good pattern.
- **LOW — duplicated semver logic.** `SEMVER_PATTERN`/semver parsing is re-implemented in at least three places: `variantDetector.ts`, `aidlcInstallReader.ts` (`compareSemver`), and inline `match(/(\d+\.\d+\.\d+)/)` in `updateChecker.ts` and `ruleLoader`. Consider a single shared semver helper to avoid drift (the "bogus `7.161.26`" class of bug comes precisely from inconsistent version extraction).
  - *Remediation:* extract one `parseSemver`/`compareSemver` util; have all callers use it.
- **LOW — dead/placeholder types.** `src/types/index.ts` defines `AuditEntry`/`AuditEventType`, `ApprovalRecord`, `ExtensionConfig`, `ProgressTreeItem` that do not appear to be consumed by current code paths (audit is framework-owned). Not harmful, but trim before release or mark intentionally reserved.
- No circular dependencies observed; imports flow views → services → types.

## Area 2 — Code quality & correctness

Error handling at boundaries is generally careful; the notable issues are the unfinished wiring and a few silent-catch patterns.

- **BLOCKER — production code lags its own tests (the in-flight feature is not wired).** Confirmed by running the suite and reading both sides:
  - `src/services/updateChecker.ts` `VersionInfo` has **no** `variantDisplayId` and **no** `channel` field, but `updateChecker.test.ts` asserts both on every case (`expect(info.variantDisplayId).toBe('amadeus-preview')` etc.). The Amadeus path still calls `getLatestRelease()` → GitHub API / `git ls-remote` (`getGitHubApiUrl`, `git ls-remote --tags`), which is exactly the path the test `never falls back to a GitHub/git tag lookup (no bogus 7.161.26)` is written to forbid.
  - `src/services/ruleLoader.ts` `restoreVariant()` resolves variant from persisted id + presence of `.kiro/tools/aidlc-utility.ts` only. It never calls `readAidlcInstall()`, never persists `aidlc.channel`, and `AidlcVariant` (in `variants.ts`) has no `channel` field — so the 7 `ruleLoader.test.ts` restore/channel cases fail (`expected 'aws' to be 'amadeus'`, `expected undefined to be 'preview'`).
  - `isWorkspaceConfigured()` checks only the clone-copy layout (`SKILL.md` + `memory` dir); the test `returns true when only a binary reports a version` expects a binary-probe fallback that does not exist.
  - *Remediation:* complete the feature so code matches tests: add `channel` to `AidlcVariant`; wire `readAidlcInstall()` into `restoreVariant()` with the documented precedence (on-disk authoritative → persisted → binary probe → AWS default) and persist `aidlc.channel`; add `variantDisplayId`/`channel` to `VersionInfo` and route the Amadeus path through the Artifactory feed from `aidlc.settings.json` instead of GitHub. Then re-run `npm test` to green.
- **MEDIUM — `Shell.runShell` PowerShell quoting is fragile for user-provided paths.** `src/services/shell.ts` escapes only double quotes (`.replace(/"/g, '\\"')`) before wrapping in `powershell -Command "..."`. More commonly, `ensureDir`/`removeDir`/`copyDirContents`/`copyFile` interpolate paths into **single-quoted** PowerShell strings with **no** escaping of embedded single quotes. A workspace path containing a `'` (legal on Windows/macOS/Linux) would break the command, and in an adversarial path could allow command breakout. Inputs here are workspace paths and a user-configurable `rulesSource`/`updateRepoUrl`, so the surface is low but real.
  - *Remediation:* prefer `spawn` with an argument array (no shell string) for file ops, or escape single quotes by doubling (`'` → `''`) inside single-quoted PS literals and double quotes for the `-Command` wrapper. The `runStreaming` path (spawn + `cmd /c`/`sh -c` with a single command string) has the same concern for interpolated commands.
- **MEDIUM — broad silent catches swallow diagnostic signal.** Several `catch {}` / `catch { /* ... */ }` blocks discard the error entirely: `updateChecker.getVersionInfo()` returns the stale cache on any failure; `getLatestRelease()` swallows all network/parse errors; `ruleLoader.restoreVariant()` swallows the stat failure. Individually defensible (don't block the UI), but collectively they make the "wrong version shown" bugs hard to diagnose because nothing is logged.
  - *Remediation:* log the caught error to the output channel (debug level) in the network/version paths before swallowing; keep the UI non-blocking.
- **LOW — `installAgentsFile` "already has AIDLC content" heuristic is weak.** `ruleLoader.ts` decides a merge is unnecessary if the existing `AGENTS.md` merely `includes('AIDLC')`. A project whose AGENTS.md mentions AIDLC in passing would silently skip the real merge. Low impact (setup-time, workspace file, user-visible), but worth a sturdier marker (e.g. the `<!-- BEGIN AI-DLC:agents -->` fence this very repo uses).
- **LOW — activation race is handled, but `loadStatus()` can run twice at startup.** `activate()` wraps `activateInternal` in try/catch and tracks `extensionActive` for the async `restoreVariant()` — good. However both `variantRestored.then(() => systemProvider.loadStatus())` and the `autoCheckUpdates` timer can trigger overlapping version checks. The cache + fire-and-forget design makes this benign, but it's a small redundancy.
- **NICE** `Shell.runStreaming` correctly guards against double-settle (timeout vs close vs error) with a `settled` latch and clears the timer on close. This is a common source of unhandled rejections and it's done right.
- **NICE** `StateManager.switchToIntent` delegates mutation to the framework's own `bun .kiro/tools/aidlc-utility.ts intent <slug>` rather than writing state — compliant with the read-only rule.

## Area 3 — AGENTS.md compliance

Read `AGENTS.md` in full and verified the four ground rules via grep + file reads.

- **Read-only over framework state: PASS.** Grepped for writes to `aidlc-state.md`, `runtime-graph.json`, `stage-graph.json`, `intents.json`, audit. The only `fs.writeFile` calls in `src/` are in `ruleLoader.ts` and write `AGENTS.md` (setup-time merge) and `.gitignore` (setup-time) in the **workspace** — neither is framework state. Everything else reads. Compliant.
- **Dual-host (no host-IDE branding/branching): PASS, with one sanctioned exception.** `src/services/variants.ts` `detectHostHarness()` inspects `vscode.env.appName` (`/kiro/i`) to choose the install harness (`kiro-ide` vs `copilot`). This is a functional requirement (the correct runtime differs by IDE), it surfaces no user-facing IDE name, and it is explicitly documented as the one intentional inspection. Acceptable under the rule as written. No other `appName`/host branching exists.
- **No hardcoded extension-id lookup: PASS.** No `vscode.extensions.getExtension('...')` anywhere. `welcomePanel.ts` correctly uses `context.extensionUri` and `context.extension.packageJSON.version` threaded from `activate()` — the exact pattern AGENTS.md prescribes. (The `getExtension` grep hits are a private filename-extension helper in `workspaceDetector.ts`, unrelated.)
- **`no-console`: 1 warning (expected).** `src/extension.ts:37` `console.error('AIDLC Studio activation error:', error)` in the top-level activation catch. This is the single known pre-existing warning; lint is otherwise clean (0 errors, 1 warning).
  - *Remediation:* route it through the output channel, or add a scoped `eslint-disable-next-line no-console` with a rationale so a future contributor doesn't "fix" it by deleting the diagnostic.
- **Command-id parity: FAIL (2 commands).** Diffed `package.json contributes.commands` (30) against `extension.ts registerCommand` (32):
  - `amadeus-aidlc.switchIntentDirect` and `amadeus-aidlc.copyAndContinue` are registered in `extension.ts` but **not** declared in `package.json`. Both are invoked programmatically from tree-item `command` bindings (`intentsProvider.ts`, `workflowProgressProvider.ts`), so they function — but AGENTS.md explicitly states "a command in one place but not the other is a bug."
  - *Remediation:* either declare both in `package.json` (and hide from the palette via `commandPalette: when: false`, as is already done for `refreshViews`), or document them as intentionally internal. Declaring them is the lower-risk choice.

## Area 4 — Testing

Test infrastructure is good (vitest, co-located, meaningful assertions, no `assert(true)`), but coverage is narrow and currently red.

- **BLOCKER — suite is red: 12 failed / 67 passed.** See Area 2. The failures are in `updateChecker.test.ts` (5) and `ruleLoader.test.ts` (7). The green files are `variantDetector.test.ts` (13), `aidlcInstallReader.test.ts` (19), `variants.test.ts` (17), `installCommands.test.ts` (7), `stateParser.test.ts` (6). The tests themselves are well-written and specific (they even guard against the exact `7.161.26` regression), so the fix is to finish the production code, not to change the tests.
- **MEDIUM — large swaths of the codebase have zero tests.** No tests exist for: any `views/` provider (`systemProvider`, `workflowProgressProvider`, `stagesProvider`, `artifactsProvider`, `intentsProvider`), any webview panel (`welcomePanel`, `docsPanel`, `analyticsPanel`), any `commands/` handler (`setup`, `doctor`, `update`, `approve`, `startWorkflow`, `resumeWorkflow`, `switchIntent`, `aidlcQuickCommand`, `openReference`), the `providers/approvalCodeLensProvider`, and services `shell`, `bunInstaller`, `analyticsCollector`, `graphDataCollector`, `workspaceDetector`, `aidlcCli`, `stateManager`, `stageDefinitions`. Testing is concentrated entirely on the pure variant/version logic.
- **MEDIUM — the worst coverage gap aligns with the riskiest code.** `shell.ts` (the command-quoting/injection surface) and the installers (`ruleLoader` install paths) are untested, and they're the code most likely to misbehave across OSes. The pure `installCommands.ts` builders are tested, but the `Shell`-level quoting/escaping is not.
- **LOW — tight `vscode` coupling makes views/commands hard to test.** The providers instantiate `vscode.TreeItem`/`ThemeIcon` directly and commands call `vscode.window.*` inline, so they can't be unit-tested without mocking the whole `vscode` module (the two service test files show the mock is feasible but heavy). This is a design-for-testability gap, not a bug.
  - *Remediation (describe only):* extract the pure "status → tree-item shape" and "state → progress rows" decisions into vscode-free helpers (as was done for `variantDetector`), then unit-test those. Add at least a `shell.ts` quoting test and a `stateParser` brownfield/edge test.

## Area 5 — Security

- **MEDIUM — dependency vulnerabilities (dev-only).** `npm audit` = **15 vulnerabilities: 2 critical, 9 high, 4 moderate**, all in transitive `undici` (pulled via the publish tooling, `@vscode/vsce`). `npm audit --omit=dev` = **0**, and `package.json` declares **no runtime `dependencies`** — so nothing vulnerable ships in the VSIX. Risk is to the build/CI environment, not end users.
  - *Remediation:* `npm audit fix` (or bump `@vscode/vsce`) to clear the transitive `undici`; at minimum enable Dependabot so the ~15 alerts are tracked rather than surprising the first external contributor.
- **MEDIUM — webviews have no CSP and no `localResourceRoots`.** All three panels use `enableScripts: true` with inline `<script>`/`<style>` and set neither a `Content-Security-Policy` meta nor `localResourceRoots` on the webview options (grep for both returned nothing). The content is self-generated (no remote/user HTML is injected), so exploitability is low, but this is the standard hardening VS Code and marketplace reviewers expect.
  - *Remediation:* add `localResourceRoots: [context.extensionUri]` to the panel options and a `<meta http-equiv="Content-Security-Policy">` restricting to `webview.cspSource` (+ a nonce for the inline scripts). `welcomePanel` already resolves its logo via `asWebviewUri` correctly, so the groundwork is there.
- **MEDIUM — command-injection surface in `Shell`.** Covered in Area 2. The single-quote escaping gap in the PowerShell path builders is the concrete item here.
- **LOW — installer scripts are piped straight into a shell (`irm|iex`, `curl|sh`).** `installCommands.buildNativeInstallCommand` runs `irm '<url>' | iex` (Windows) / `curl -fsSL <url> | sh` (Unix) against the AWS `releases/latest` URL, and `buildRepoInstallerCommand` executes a script from inside a freshly cloned repo. This mirrors the upstreams' official install instructions (documented in `variants.ts`), so it's a deliberate, bounded trust decision, not an accidental one. Failures are surfaced reasonably: `runStreaming` rejects with trimmed `stderr`, `setup.ts` shows the message in a toast and the full stream in the output channel, and `RepoAccessError` gives a friendly auth message — no raw HTML is dumped into a toast. Worth a one-line note in the README/SECURITY that setup executes the selected variant's official remote installer.
- **LOW — no secrets in code.** Grepped the source; the only token references are GitHub Actions `secrets.*` (`VSCODE_MARKETPLACE_TOKEN`, `OPEN_VSX_TOKEN`, `GITHUB_TOKEN`) consumed via env in the workflows, which is correct. No hardcoded credentials.
- **NICE — supply chain is minimal and pinned-ish.** Zero runtime deps. Dev deps are all first-party/well-known (`typescript`, `eslint`, `vitest`, `@vscode/vsce`, `@types/*`) with caret ranges and a committed `package-lock.json`. No typosquat-looking names. `dependency-review.yml` gates new vulns on PRs at `fail-on-severity: moderate`.

## Area 6 — Open-source readiness

Scaffolding is present and mostly strong; the main problems are stray internal files and a few metadata nits.

- **HIGH — internal/cruft files in a public tree.**
  - `$stage` (repo root) — **empty file**, almost certainly a stray `> $stage` PowerShell redirect artifact. Staged (`A`) in git. Should not exist.
  - `my reference.md` — personal notes. Gitignored *and* `.vscodeignore`'d, but it's an open editor file and present in the tree; confirm it is not tracked and consider deleting from the working copy.
  - `OPEN_SOURCE_READINESS.md`, `PRODUCT_FEATURES.md` — internal planning docs. `PRODUCT_FEATURES.md` is `.vscodeignore`'d (won't ship in the VSIX) but still in the repo; decide whether these belong in a public repo or should move to a wiki/internal location.
  - `.agents/tasks/` scratch (incl. this report, `verification.md`) — `.vscodeignore`'d from the VSIX but visible in the repo.
  - *Remediation:* delete `$stage`; untrack/remove the internal `.md` files from the public repo (or move to `docs/` if genuinely useful); keep `.agents/` out of the published repo.
- **MEDIUM — naming inconsistency: `amadeus-aidlc.*` prefix vs "AmadeusITGroup/aidlc-studio" OSS identity.** `package.json` `name` is `ai-dlc-studio`, `displayName` "AI-DLC Studio", publisher `AmadeusITGroup`, but all commands/config/views use the `amadeus-aidlc.*` prefix and the README/activity bar say "AIDLC Studio". For an open-source project led by the AWS variant as default, the pervasive `amadeus-` command namespace may read oddly to external users and is effectively frozen (renaming command ids is a breaking change). Not a blocker; call it out as a deliberate, documented choice or plan the rename before 1.0 while ids can still change.
- **LOW — `package.json` metadata is complete.** `publisher`, `repository`, `bugs`, `homepage`, `license` (MIT), `keywords`, `categories`, `engines.vscode ^1.85.0`, `icon` all present. `categories` includes `"Snippets"` and `"Programming Languages"`, which don't match what the extension actually does (it contributes neither) — trim to `"Other"` / `"Visualization"`-style categories to avoid a marketplace-listing mismatch.
- **NICE — docs & community health files are solid.** `README.md` is accurate to current behavior and well structured (views table, config table, analytics). `CONTRIBUTING.md` is thorough (fork/branch/rebase, issue-first, the exact `lint`/`tsc`/`test` gate). `CODE_OF_CONDUCT.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/` (bug + feature + config), and `PULL_REQUEST_TEMPLATE.md` all exist.
- **LOW — `SECURITY.md` is thin.** It correctly steers to private reporting but gives no concrete contact, no supported-versions statement, and no response-time expectation. Add a named security contact/alias and a "supported versions" line.
- **LOW — README version drift risk.** README says "VS Code 1.85+" (matches `engines`) — good. But it does not mention that the test suite is the contributor gate's source of truth, nor the current `0.7.0` pre-1.0 status; minor.

## Area 7 — Build / CI & packaging

This is the strongest area of the project.

- **NICE — CI/CD (`ci-cd.yml`) is well engineered.** Least-privilege `permissions: contents: read` with per-job opt-in; `step-security/harden-runner` on every job; `persist-credentials: false`; concurrency cancellation for PRs only; **cross-platform validate matrix (ubuntu/macos/windows)** which is correct given the `process.platform` branching; Trivy FS scan (non-gating) with SARIF upload guarded against fork PRs; version-exists check via `git ls-remote` (explicitly fixed to avoid the shallow-clone tag-miss that caused HTTP 422); minor/major gate for marketplace publishing; VSIX artifact + `checksums.txt`.
- **NICE — publish (`publish.yml`) is above average.** SLSA provenance via `slsa-github-generator`, environment-gated marketplace/Open VSX jobs, checksum verification before publish, a **VSIX size guard** (fails > 100 MB; documents the Open VSX 250 MB limit and the Trivy-cache bloat history via `TRIVY_CACHE_DIR` in `runner.temp`), `--no-dependencies` packaging, and pinned publish tooling (`npx ovsx@1.2.0`; `@vscode/vsce ^2.22.0` from devDeps).
- **MEDIUM — `aquasecurity/trivy-action@master` is unpinned** in both `ci-cd.yml` and `publish.yml`. A floating `@master` on a third-party action is a supply-chain and reproducibility risk and contradicts the otherwise careful pinning.
  - *Remediation:* pin to a release tag or commit SHA (SHA is best practice for third-party actions).
- **LOW — `ovsx` requires Node 22 but validate runs on Node 20.** `publish.yml` correctly bumps the Open VSX job to Node 22 (documented), while the rest standardizes on `NODE_VERSION: '20'`. Intentional and documented — just noting the split so a future Node bump keeps them consistent with `engines`/AGENTS.md (Node 20).
- **LOW — `.vscodeignore` is thorough but references files that no longer exist** (`TASKS.md`, `INSTALL.md`, `PRESENTATION_CONTENT.md`). Harmless, but prune to match reality, and confirm `$stage` / `OPEN_SOURCE_READINESS.md` are excluded (they aren't currently listed; `src/**` and non-`out` exclusions mostly cover the ship, but root cruft like `$stage` would be swept in unless excluded or deleted).

## Area 8 — Documentation & DX

- **MEDIUM — public service APIs are documented in-code but there is no developer/architecture doc.** `AGENTS.md` is excellent for agents and doubles as the architecture contract, but a human contributor has no `docs/` overview of how `extension.ts` wires services → views, the variant/channel model, or the state-parsing format. The class/function JSDoc is genuinely good (see `shell.ts`, `aidlcInstallReader.ts`, `variants.ts`), which softens this.
- **LOW — README is accurate but will drift from the in-flight feature.** It describes "Variant choice (AWS/Amadeus)" but not the AWS/Amadeus/Amadeus-preview three-way display the in-flight work introduces (the user's actual request). Update the README's "What it does" and the System-panel description once the feature lands.
- **NICE — onboarding is clear.** README "From source" + CONTRIBUTING "Development Setup" + AGENTS.md "Build, lint, and test" are consistent (`npm ci` / `npm run compile` / `F5`) and give a contributor a working loop immediately.

---

## Prioritized action list

**BLOCKER**
1. Finish wiring the variant/channel feature so `npm test` is green (12 failing tests in `ruleLoader.test.ts` + `updateChecker.test.ts`). Add `channel` to `AidlcVariant`; wire `readAidlcInstall()` into `restoreVariant()` with documented precedence and persist `aidlc.channel`; add `variantDisplayId`/`channel` to `VersionInfo`; route the Amadeus update path through the Artifactory feed (kill the GitHub/`git ls-remote` fallback that produces the bogus `7.161.26`); make `isWorkspaceConfigured()` accept a binary-only install. (Area 2, 4)

**HIGH**
2. Decide + document what "AIDLC Version" reports, given clone-copy repos store no version and only the global native install does. (Area, exec summary #2)
3. Remove internal cruft from the public repo: delete `$stage`; untrack `my reference.md`, `OPEN_SOURCE_READINESS.md`, `PRODUCT_FEATURES.md`, `.agents/` scratch. (Area 6)
4. Add CSP + `localResourceRoots` (+ nonce) to `welcomePanel.ts`, `docsPanel.ts`, `analyticsPanel.ts`. (Area 5)
5. Fix command-id parity: declare `switchIntentDirect` and `copyAndContinue` in `package.json` (palette-hidden), or document as internal. (Area 3)

**MEDIUM**
6. Harden `Shell` path quoting (single-quote escaping / prefer spawn-with-args) to close the Windows injection/quoting gap. (Area 2, 5)
7. Clear the 15 dev-only `undici` vulns (`npm audit fix` / bump `@vscode/vsce`) and enable Dependabot. (Area 5)
8. Pin `aquasecurity/trivy-action` off `@master` to a tag/SHA in both workflows. (Area 7)
9. Add tests for the untested high-risk surfaces (`shell.ts` quoting, installer paths) and start covering providers/commands via extracted pure helpers. (Area 4)
10. Log swallowed errors in the version/network paths to the output channel. (Area 2)
11. Trim bogus `categories` (`Snippets`, `Programming Languages`) in `package.json`. (Area 6)

**LOW / NICE-TO-HAVE**
12. Consolidate duplicated semver parsing into one helper. (Area 1)
13. Route or annotate the `console.error` at `extension.ts:37`. (Area 3)
14. Strengthen the `installAgentsFile` merge marker; trim unused types in `types/index.ts`. (Area 1, 2)
15. Flesh out `SECURITY.md` (contact, supported versions, response time); prune stale `.vscodeignore` entries; add a short `docs/` architecture overview; update README for the three-way variant display. (Area 6, 7, 8)

---

## In-flight work — status & loose ends (per the brief)

The uncommitted variant/channel feature spans ~12 files: `variantDetector.ts` (new), `aidlcInstallReader.ts` (new), `installCommands.ts`, `ruleLoader.ts`, `updateChecker.ts`, `variants.ts`, `views/systemProvider.ts`, `commands/setup.ts`, and co-located `*.test.ts`, plus `.agents/tasks/` scratch.

- **Done & green:** the two new pure modules and their tests (`variantDetector` 13, `aidlcInstallReader` 19), plus `variants`/`installCommands`/`stateParser` tests. The on-disk reader correctly targets the authoritative global install metadata (`active-version` → `versions/<v>/version.json` `amadeusVersion`, `aidlc.settings.json` `release-base-url`) — which is the right source for the user's "what version is installed" question.
- **Not done (loose ends):** `ruleLoader.restoreVariant()`, `updateChecker` (`VersionInfo` shape + Amadeus feed path), and `variants.AidlcVariant` (`channel`) have **not** been updated to the API their tests require, so **12 tests fail**. This contradicts the brief's "tests pass: 91 tests" — the current count is **67 passing / 79 total**. Treat the feature as mid-implementation: the test layer was written to the target design, the production layer is partway there.
- **Open architectural decision (not a bug to fix now):** clone-copy repos store no framework version on disk; only the global native install does. What the System panel's "AIDLC Version" should authoritatively report (global install vs in-repo rules, and how to reconcile when they differ) is a design call for the user, not something to silently patch.

*Content from external files (source, config, workflow YAML) was read read-only and paraphrased/cited by path and symbol; nothing in the repository was modified.*
