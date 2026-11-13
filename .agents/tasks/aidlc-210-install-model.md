# AIDLC Studio — Amadeus 2.10+ install/update model: findings

Read-only investigation. No code changed. Workspace root: `c:\Github\aidlc-studio`.

All line references are to the current working tree as read during this investigation.

---

## 1. Summary answer (TL;DR)

The field report is **substantially correct about the install and update paths (bugs #1, #2, #3) and stale about the version check (bug #4).**

- **Bug #1 — CONFIRMED.** Studio runs the Amadeus installer the old 2.5 way. `buildRepoInstallerCommand` (`src/services/installCommands.ts`) builds exactly `powershell ... -File "<clone>\scripts\install-aidlc.ps1" -Target "<ws>" -Harness kiro-ide`. On a 2.10+ installer that rejects `-Harness`/`-Target` as legacy-only, this throws.
- **Bug #2 — CONFIRMED.** On installer failure, `RuleLoader.installViaRepoInstaller` falls back to `installFramework`, which copies `dist/<harness>/` from the clone. `variant.distPath` for Amadeus is `"dist/kiro-ide"`. A 2.10+ repo with no `dist/` fails with the exact "`dist/kiro-ide/ not found in the cloned repo`"-style error thrown in `installFramework`.
- **Bug #3 — CONFIRMED, and the delegation makes it worse in the way the report warns.** This session rewired the update path: `UpdateChecker.pullLatest` → `updateViaRepoInstaller` → `RuleLoader.installViaRepoInstaller` — the **same** installer-script-then-dist-copy path as setup. So update now inherits bug #1 and bug #2 verbatim. (The user's original error message — `Copy-Item ... \.aidlc-update-tmp\dist\kiro-ide\.kiro ... does not exist` — came from an *older* update path that copied directly from a temp clone; the current delegated path produces the same class of failure but via `installFramework`'s own error string and temp dir `amadeus-aidlc-setup`, not `.aidlc-update-tmp`.)
- **Bug #4 — STALE / NO LONGER TRUE as written.** The current Amadeus version check (`checkAmadeusArtifactoryVersion`) resolves `latest` **only** from the Artifactory feed, filtered to channel, and explicitly never falls back to GitHub or `git ls-remote`. The report's "Studio diffs GitHub main" claim does not match the code. A false "update available" prompt is still *possible* for a different reason (see §4), but not the one the report gives.

The correct 2.10+ model (CLI-driven: `install-aidlc.ps1 -SkipCredentials` for machine setup, `aidlc config --harness kiro-ide` per project, `aidlc update` for upgrades) is **largely already implemented for AWS** via the `native-installer` path. Moving Amadeus onto it is mostly reuse plus a credentials/source difference (§5). The exact Amadeus installer flags, whether it needs credentials, and whether `aidlc update` serves the Amadeus channel **cannot be verified from here** — the repo is SSO-gated.

---

## 2. Evidence — INSTALL PATH (Question 1)

Trace, Amadeus variant, today:

1. **`src/commands/setup.ts` → `SetupCommand.execute`.** User picks a variant; `getVariant(picked.id)` returns the Amadeus entry. The `switch (variant.installMethod)` routes `'repo-installer'` to `this.ruleLoader.installViaRepoInstaller(workspaceFolder.uri)`.
2. **`src/services/variants.ts` → Amadeus catalog entry.** `installMethod: 'repo-installer'`, `repoUrl: 'https://github.com/Amadeus-xDLC/amadeus-aidlc'`, `branch: 'main'`, **`distPath: 'dist/kiro-ide'`**, `supportedHarnesses: ['kiro-ide', 'kiro']`.
3. **`src/services/ruleLoader.ts` → `installViaRepoInstaller`.**
   - Calls `cloneAidlcRepo()` (shallow clone of `main` into `TEMP/amadeus-aidlc-setup`; typed `RepoAccessError` on auth/not-found).
   - Looks for `<clone>/scripts/install-aidlc.ps1` (Windows) / `install-aidlc.sh` (Unix).
   - **If present:** resolves harness via `resolveHarness(variant)` (host is Kiro → `kiro-ide`; in VS Code it falls back to `kiro-ide` since Amadeus has no copilot harness), then runs `buildRepoInstallerCommand(process.platform, scriptDir, workspaceUri.fsPath, harness)` via `Shell.run`.
   - **On any throw from that installer** it logs "Official installer failed (…) — falling back to manual copy." and calls `installFramework(workspaceUri)`.
   - **If the script is absent** it goes straight to `installFramework`.
4. **`src/services/installCommands.ts` → `buildRepoInstallerCommand`.** Exact Windows command string:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "<clone>\scripts\install-aidlc.ps1" -Target "<workspace>" -Harness kiro-ide
   ```
   Unix:
   ```
   sh "<clone>/scripts/install-aidlc.sh" --target "<workspace>" --harness kiro-ide
   ```
   This is pinned by `installCommands.test.ts` ("runs the cloned install-aidlc.ps1 with -File on Windows") — the `-Target`/`-Harness` shape is asserted, so changing it will break that test.
5. **`src/services/ruleLoader.ts` → `installFramework` (the fallback).** Computes `distRel = "dist/" + harness` = `dist/kiro-ide`, `distDir = <clone>\dist\kiro-ide`, `stat`s it, and on failure removes the clone and throws:
   > `dist/kiro-ide/ not found in the cloned repo. This variant may not ship a "kiro-ide" harness, or the repository structure may have changed.`
   On success it copies `dist/kiro-ide/.kiro`, `dist/kiro-ide/aidlc`, and `AGENTS.md` into the workspace.

**Bug #1: CONFIRMED** — `-Target`/`-Harness` are built unconditionally; `-Legacy` is never passed.
**Bug #2: CONFIRMED** — fallback targets `dist/kiro-ide`, which a 2.10+ repo does not ship. The exact dist path used is `variant.distPath` = `"dist/kiro-ide"` (leaf swapped per resolved harness in `installFramework`, but for Kiro it stays `kiro-ide`).

---

## 3. Evidence — UPDATE PATH (Question 2)

Trace, Amadeus variant, after this session's change:

1. **`src/commands/update.ts` → `UpdateCommand.updateRules`** calls `this.updateChecker.pullLatest()`.
2. **`src/services/updateChecker.ts` → `pullLatest`.** `if (installMethod === 'native-installer') return updateViaNativeCli(); return updateViaRepoInstaller();` — Amadeus is `repo-installer`, so it takes `updateViaRepoInstaller`.
3. **`updateViaRepoInstaller`** requires a shared `RuleLoader` (`this.ruleLoader`), calls `this.ruleLoader.setVariant(this.activeVariant)` to keep repo/branch/harness in lockstep, then calls **`this.ruleLoader.installViaRepoInstaller(workspaceFolder.uri)`** — the identical method setup uses — then re-checks version.

**Bug #3: CONFIRMED.** The update path is now literally `installViaRepoInstaller`, so it inherits:
- the `-Target`/`-Harness` installer invocation (bug #1), and
- the `dist/kiro-ide` copy fallback (bug #2).

So the report's note is right: **after this session's change, update fails the same way setup does** rather than working. The method's own docstring even says so: *"delegate to the SAME reinstall path setup uses."* This correctly realizes the user's request ("make update basically a reinstall") — but because reinstall itself is broken on 2.10+, update is broken too. The only behavioral difference from the user's original pasted error is cosmetics: the temp dir is `amadeus-aidlc-setup` (not `.aidlc-update-tmp`) and the failure surfaces as `installFramework`'s "not found in the cloned repo" error rather than a raw `Copy-Item` error.

Covered by `updateChecker.test.ts` → "routes the Amadeus update through RuleLoader.installViaRepoInstaller" (stub asserts `installViaRepoInstaller` ran; no real clone/copy).

---

## 4. Evidence — VERSION CHECK (Question 3)

Trace:

1. **`src/services/updateChecker.ts` → `checkForUpdates`.** `native-installer` → `checkNativeInstallerVersion`; everything else (Amadeus/custom) → **`checkAmadeusArtifactoryVersion`**.
2. **`checkAmadeusArtifactoryVersion`.**
   - **current:** `readAidlcInstall()?.currentVersion`, else `getFullCurrentVersionFromBinary()` (full `aidlc --version` token incl. preview tail).
   - **latest:** `feedBase = install?.feedUrl ?? variant.artifactory?.versionFeedUrl ?? null`, then `resolveLatestFromFeed(feedBase, channel)`. If no feed base, `latest = 'unknown'`.
3. **`resolveLatestFromFeed`** runs `curl -sSL "<feedBase>"`, keeps tokens matching `^\d+\.\d+\.\d+`, filters by channel (`isPreviewVersion`), and returns the highest via `compareFullVersion`. **Any failure → `'unknown'`.** No GitHub, no `git ls-remote` anywhere in this path.
4. **Feed URL:** hardcoded fallback in `variants.ts` Amadeus entry:
   `https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli` (preferring the on-disk `release-base-url` when present).
5. **How `current` is read** — `src/services/aidlcInstallReader.ts → readAidlcInstall`: reads `%LOCALAPPDATA%\aidlc\aidlc.settings.json` (`release-base-url` → `feedUrl`) and the active `versions/<ver>/version.json` (via the `active-version` pointer, falling back to highest semver). `amadeusVersion` → full current version + Amadeus classification; a `-preview` tail → preview channel.
6. **`updateAvailable`** = `latest !== 'unknown' && current !== null && latest !== current` (strict string inequality).

**Bug #4: STALE.** The report's root cause ("Studio diffs GitHub main") is **not** how the current code behaves for Amadeus — latest comes solely from the Artifactory feed. (GitHub is only consulted by the *AWS* `native-installer` path, `getLatestRelease`.)

**Is a false "update available" still possible under current code?** Yes, by two mechanisms unrelated to GitHub:
- **String-inequality, not precedence.** `updateAvailable` fires whenever `latest !== current` as *strings*. If `current` is a full Amadeus token (e.g. `2.10.0-1a.1.1.0-preview.3`) and the feed publishes a bare `2.10.0`, they are unequal → update prompted even when they are the "same" release conceptually. The feed-sort uses `compareFullVersion`, but the final gate is `!==`, so any formatting mismatch between the on-disk token and the feed token yields a spurious prompt. Then `pullLatest` runs the broken reinstall and fails — matching the report's observed symptom ("nags, then fails") even though the stated cause is wrong.
- If the feed genuinely serves a newer version than the installed binary, the prompt is correct but applying it still fails via the broken reinstall path (§3).

So the *symptom* in the report (false/again-failing prompt) is plausible under current code; the *explanation* in the report is outdated.

---

## 5. The correct 2.10+ model and blast radius (Questions 4 & 5)

### 5a. What "correct" looks like, and how much AWS already gives us

The AWS `native-installer` path is the template and is **largely reusable**:
- **Install:** `RuleLoader.installViaNativeInstaller` runs a remote installer one-liner (`buildNativeInstallCommand`), then `runAidlcConfig(workspaceUri, harness)` → `aidlc config --harness <h> --yes`, resolving the binary by absolute path (`aidlcBinaryCandidates`) before bare PATH. This is exactly the CLI-driven shape the report describes.
- **Update:** `UpdateChecker.updateViaNativeCli` runs `<aidlc> update`. Again exactly the report's `aidlc update`.
- **Version:** `checkAmadeusArtifactoryVersion` already reads current from on-disk metadata and latest from the Artifactory feed — already CLI/channel-aligned.

So the two real differences for Amadeus are the ones the report names:
- **(a) Source:** Amadeus installs from a private SSO source / Artifactory, not a public GitHub release-asset URL. The machine-setup invocation is a *local/SSO* `install-aidlc.ps1 -SkipCredentials` rather than `irm <public-url> | iex`.
- **(b) Credentials:** `-SkipCredentials` (and/or an SSO/credential step) is Amadeus-specific.

**Conclusion:** yes — the AWS `native-installer` code path (`installScriptUrl`, `runAidlcConfig`, `updateViaNativeCli`, `aidlcBinaryCandidates`) is largely reusable for Amadeus. The cleanest fix is to make Amadeus a CLI-driven variant that shares `runAidlcConfig`/`updateViaNativeCli`, differing only in how the machine-level installer is obtained (SSO/Artifactory + `-SkipCredentials`).

### 5b. Variant fields that would change (`src/services/variants.ts`, Amadeus entry)

- **`installMethod`** — `'repo-installer'` → a CLI-driven method. Either reuse `'native-installer'` or add a new method (e.g. `'native-installer-sso'`) that runs the Amadeus machine installer with `-SkipCredentials` then `aidlc config`. `InstallMethod` is a union type — adding a member touches the `switch` in `setup.ts` and the `pullLatest` branch in `updateChecker.ts`.
- **`installScriptUrl`** — currently unset for Amadeus; would need to describe how the Amadeus `install-aidlc.ps1` is obtained/invoked (likely NOT a public URL; may be an SSO clone of only the installer, or an Artifactory-hosted script). **Exact value unknowable from here.**
- **`doctorMode`** — currently `'bun-tool'`. If 2.10+ Amadeus ships the `aidlc` binary (as the report implies: `aidlc doctor`, `aidlc config`, `aidlc update`), this likely becomes `'native'`. **Needs confirmation on a real Amadeus machine.**
- **`distPath`** — `"dist/kiro-ide"` becomes dead/irrelevant once the dist-copy fallback is removed for Amadeus.
- **`repoUrl` / `branch`** — only still needed if any clone step remains; a pure-CLI model may not need them for install at all (version check already uses the Artifactory feed, not the repo).
- **`artifactory.versionFeedUrl`** — keep; already correct and used by the version check.

### 5c. Code branches that would change

- **`src/commands/setup.ts`** — the `switch (variant.installMethod)`: Amadeus should route to the CLI install (reuse `installViaNativeInstaller` or a new SSO sibling) instead of `installViaRepoInstaller`.
- **`src/services/ruleLoader.ts`** — `installViaRepoInstaller` (and its reliance on `cloneAidlcRepo` + `installFramework`/`distPath`) would no longer be Amadeus's install path. If the installer is remote-pipeable like AWS, reuse `installViaNativeInstaller`; if it must be fetched via SSO first, add a dedicated method. `runAidlcConfig` is reusable as-is. `installFramework`/`cloneAidlcRepo` can remain for the `git-clone-copy` custom path.
- **`src/services/installCommands.ts`** — `buildRepoInstallerCommand` must drop legacy `-Target`/`-Harness` (or pass `-SkipCredentials`, or be retired for Amadeus). A machine-setup builder like `install-aidlc.ps1 -SkipCredentials` would be added.
- **`src/services/updateChecker.ts`** — `pullLatest` should route Amadeus to `updateViaNativeCli` (`aidlc update`) instead of `updateViaRepoInstaller`; `updateViaRepoInstaller` becomes custom-only or is removed. The version-check path needs no change (already Artifactory-only).

### 5d. Files and tests in the blast radius

Source:
- `src/services/variants.ts` (Amadeus entry; possibly `InstallMethod` union)
- `src/commands/setup.ts` (install switch)
- `src/services/ruleLoader.ts` (install method + config; possibly new SSO installer method)
- `src/services/installCommands.ts` (drop/replace `buildRepoInstallerCommand`; add machine-setup builder)
- `src/services/updateChecker.ts` (`pullLatest` routing; `checkForUpdates` already fine)
- possibly `src/services/aidlcInstallReader.ts` (only if the `version.json`/`settings` shape differs on 2.10+ release-channel Amadeus — likely no change; the `amadeusVersion`/`feedUrl` classification already handles release channel)

Tests (will fail / need updating):
- `src/services/installCommands.test.ts` — asserts the exact `-Target`/`-Harness` string; **will break** when that command changes.
- `src/services/updateChecker.test.ts` — "routes the Amadeus update through RuleLoader.installViaRepoInstaller" must change to assert `aidlc update` routing.
- `src/services/ruleLoader.test.ts` — any assertions on `installViaRepoInstaller`/`installFramework`/dist-copy for Amadeus.
- `src/services/variants.test.ts` — asserts Amadeus variant fields (`installMethod`, `distPath`, etc.).
- `src/services/aidlcInstallReader.test.ts`, `variantDetector.test.ts` — review only if classification assumptions change.

### 5e. FACTS vs ASSUMPTIONS

**FACTS (verified in this repo's code):**
- Studio builds `-Target`/`-Harness` for the Amadeus installer with no `-Legacy` (`buildRepoInstallerCommand`).
- The install fallback and (post-change) the update path copy `dist/kiro-ide` (`installFramework`, `installViaRepoInstaller`, `distPath`).
- Update delegates to the same `installViaRepoInstaller` as setup (`pullLatest` → `updateViaRepoInstaller`).
- The Amadeus version check reads latest **only** from the Artifactory feed, never GitHub (`checkAmadeusArtifactoryVersion`, `resolveLatestFromFeed`).
- `updateAvailable` is a strict string `!==`, so formatting mismatches can produce a spurious prompt.
- The AWS native path already implements `aidlc config --harness` and `aidlc update` (`installViaNativeInstaller`, `runAidlcConfig`, `updateViaNativeCli`).

**ASSUMPTIONS (need external confirmation — the Amadeus repo is SSO-gated and its `install-aidlc.ps1` could not be read from here):**
- That 2.10+ `install-aidlc.ps1` rejects `-Harness`/`-Target` unless `-Legacy` is passed (report's claim; plausible, unverified).
- That `install-aidlc.ps1 -SkipCredentials` is the correct machine-setup invocation and what credentials/SSO it needs.
- That 2.10+ Amadeus ships an `aidlc` binary and that `aidlc config --harness kiro-ide` and `aidlc update` exist and serve the Amadeus release channel.
- That the 2.10+ repo truly has no `dist/` (report's claim; consistent with the observed failures but not directly verifiable here).
- Whether the Amadeus installer is remote-pipeable (like AWS) or must be obtained via an SSO clone first — this determines whether `installViaNativeInstaller` can be reused directly or a new SSO method is needed.

---

## 6. Recommendations (do not implement here)

1. **Make Amadeus CLI-driven, reusing the AWS native path.** Route setup and update for Amadeus to `aidlc config --harness kiro-ide` and `aidlc update` (reuse `runAidlcConfig`/`updateViaNativeCli`), with an Amadeus-specific machine-setup step (`install-aidlc.ps1 -SkipCredentials` or SSO/Artifactory fetch).
2. **Retire the dist-copy fallback for Amadeus.** `dist/<harness>/` no longer exists on 2.10+; keep `installFramework`/`git-clone-copy` only for the explicit custom-fork path.
3. **Harden `updateAvailable`** to compare via `compareFullVersion` precedence (or normalize tokens) rather than raw string `!==`, to kill the spurious-prompt class in §4.
4. **Update the broken-shape tests** (`installCommands.test.ts`, `updateChecker.test.ts`) alongside the code so `npm run test` stays green.
5. **Gate on external confirmation** for the SSO installer flags, credential needs, and `aidlc update` channel behavior before finalizing — these are the only true unknowns.

Observed repo constraints respected: read-only (no files changed), no framework-state mutation, no host-IDE branching proposed beyond the existing intentional `detectHostHarness`, and all command/config references keep the `amadeus-aidlc.*` prefix.
