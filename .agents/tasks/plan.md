# Implementation Plan — variant/channel feature + two-row System version display

Scope: make the 12 RED tests pass (updateChecker.test.ts, ruleLoader.test.ts) and add the
two-row System panel version display. Tightly coupled: `channel`/display-id data flows
variants → ruleLoader → updateChecker → systemProvider. Do the work in dependency order so
each item leaves the tree buildable and never regresses already-green tests.

Verified baseline (`npm test`): 12 failed / 67 passed. Field name is `latestVersion` (not
`latest`). `describeVariant` does not exist yet — it is NEW (no test imports it directly;
its three display states `aws | amadeus | amadeus-preview` are asserted via
`info.variantDisplayId` in updateChecker.test.ts). `RuleLoader` is constructed in
ruleLoader.test.ts with a context-only stub (no outputChannel), so the outputChannel param
MUST stay optional and all logging stays guarded with `?.`.

Hard constraints (AGENTS.md): read-only companion (never write framework state — reading
install/version files is fine); no host-IDE-name branching beyond the existing
`detectHostHarness()`; no hardcoded extension-id lookup; new config keys under
`amadeus-aidlc.*`; no `git commit`/`git push`; keep within the `no-console` baseline (the
only allowed warning is the pre-existing one at `src/extension.ts:37`).

---

- [ ] 1. Add `channel` to the variant model and a `describeVariant()` display-state helper in variants.ts.
      Add `channel: 'release' | 'preview'` to the `AidlcVariant` interface. Set `channel: 'release'`
      on BOTH catalog entries (aws and amadeus) in `AIDLC_VARIANTS`, and add `channel: 'release'`
      to the `custom` overlay object returned by `getVariant()` so the spread stays type-complete.
      Add the Artifactory feed to the amadeus entry as a new optional field
      `artifactory?: { versionFeedUrl: string }` (or `releaseBaseUrl`) holding the hardcoded
      `https://repository.rnd.amadeus.net/artifactory/generic-prod-aidlc-nce/amadeus-aidlc/cli`
      base — this is the fallback feed base used by updateChecker when settings has none; leave aws
      without it. Add and export a pure `describeVariant(variant: Pick<AidlcVariant,'id'|'channel'>): 'aws' | 'amadeus' | 'amadeus-preview'`:
      return `'aws'` for id `aws`/default, `'amadeus-preview'` when id is `amadeus` AND channel is
      `preview`, else `'amadeus'`. Keep `detectHostHarness`/`resolveHarness` untouched.
      Files: src/services/variants.ts
      Verify: `npx vitest run src/services/variants.test.ts` — still green (the existing 17 cases
      must keep passing; adding a field and a helper must not break them). `npx tsc --noEmit` clean.

- [ ] 2. Make RuleLoader channel-aware and wire on-disk install metadata as the authoritative first signal in restoreVariant(), plus capability-based isWorkspaceConfigured().
      Import `readAidlcInstall` from `./aidlcInstallReader`. Track the resolved channel on the
      instance (e.g. `private activeChannel: 'release' | 'preview' = 'release'`) and fold it into
      the variant the getter returns so `loader.variant.channel` is correct (either store a
      channel-stamped variant via `{ ...getVariant(id), channel }`, or merge the channel in the
      `variant` getter). Rewrite `restoreVariant()` to resolve in THIS priority order, persisting
      `aidlc.variantId` AND `aidlc.channel` whenever a non-default signal wins, and logging which
      signal won via `this.outputChannel?.appendLine(...)`:
        (a) AUTHORITATIVE — `await readAidlcInstall()`: if non-null, use its `variantId` + `channel`,
            reconcile/persist both workspaceState keys (this overrides a stale persisted value), and
            return the channel-stamped variant. This satisfies the three on-disk tests:
            `classifies from on-disk version.json (amadeus preview) without running the binary`,
            `on-disk amadeus-preview wins over a STALE persisted aws id (reconciles the cache)`,
            `on-disk preview wins over a persisted amadeus/release channel`.
        (b) Persisted `aidlc.variantId` (+ `aidlc.channel`, default 'release' when the key is
            absent): return the channel-stamped persisted variant. Satisfies
            `restores a persisted amadeus preview variant with its channel` and
            `uses persisted state when there is no on-disk install metadata`.
        (c) File heuristic: existing `.kiro/tools/aidlc-utility.ts` stat → amadeus (channel defaults
            to 'release' here; persist). Keep existing behavior.
        (d) Binary `--version` probe (bare PATH `aidlc --version` via `Shell.run`, matching the
            mock): classify with `classifyVariant(stdout, '')` from `./variantDetector`; if it yields
            amadeus, use its channel and persist. Satisfies
            `classifies a binary-only Amadeus preview install as amadeus/preview (not AWS)` and
            `defaults to AWS when the binary reports a plain awslabs semver` and
            `falls back to the binary probe / aws default when nothing persisted and no on-disk metadata`.
        (e) Default AWS/release (no persistence), unchanged.
      Rewrite `isWorkspaceConfigured()` to be capability-based: return true when EITHER the
      clone-copy layout exists (existing `SKILL.md` + `aidlc/spaces/default/memory` stat, keep as-is)
      OR a resolvable aidlc binary/metadata reports a version — reuse `readAidlcInstall()`
      (non-null with a `currentVersion`) OR a bare-PATH `aidlc --version` probe that yields a semver.
      Satisfies `returns true when only a binary reports a version`, keeps
      `returns true when the clone-copy layout exists` and `returns false when neither ... is present`.
      Keep all install/clone methods untouched. Keep the outputChannel param optional.
      Files: src/services/ruleLoader.ts
      Verify: `npx vitest run src/services/ruleLoader.test.ts` — all 11 cases green.

- [ ] 3. Teach UpdateChecker the Amadeus Artifactory path, channel filtering, and the new VersionInfo fields.
      Extend the `VersionInfo` interface with `channel: 'release' | 'preview'` and
      `variantDisplayId: 'aws' | 'amadeus' | 'amadeus-preview'`; populate both on every return path
      via `describeVariant(this.activeVariant)` and `this.activeVariant.channel`. Split
      `checkForUpdates()` by variant:
        - native-installer (aws): keep the existing GitHub-releases path (`checkNativeInstallerVersion`
          → `getCurrentVersionFromBinary` + `getLatestRelease`). Satisfies
          `reports aws display id and uses the GitHub release` (variantDisplayId 'aws', channel
          'release', current 2.9.0, latest 2.9.1, updateAvailable true).
        - amadeus (repo-installer / custom): NEW dedicated method that resolves `latest` ONLY from
          the Artifactory feed and NEVER calls `getLatestRelease()`, `getGitHubApiUrl()`, or
          `git ls-remote`. Current version: prefer on-disk `readAidlcInstall()` `currentVersion`
          (full string incl. preview suffix); when absent (updateChecker.test mocks fs to ENOENT),
          fall back to a FULL-string binary `--version` parse — capture the whole token after
          `aidlc ` (numeric semver PLUS any `-preview...` / pre-release suffix), e.g.
          `2.10.0-1a.1.1.0-preview.3`, not just the numeric semver. Feed URL: read the Artifactory
          base from on-disk `aidlc.settings.json` (via `readAidlcInstall().feedUrl`) PREFERRED over
          the hardcoded `variant.artifactory` constant from step 1. Fetch the feed with a `curl ...`
          command (the mock keys on `cmd.includes('curl')`), split the response on whitespace into
          version tokens, filter to the active channel (release = tokens WITHOUT a preview/pre-release
          suffix via `isPreviewVersion`; preview = tokens WITH one), pick the highest by semver
          compare, and set `latestVersion`. On ANY failure (curl throws, unparseable/HTML response,
          no matching tokens) set `latestVersion: 'unknown'` and `updateAvailable: false` — never
          fall back to GitHub/git. Compare FULL version strings for `updateAvailable`
          (`latest !== 'unknown' && current !== null && latest !== current`).
          Satisfies: `picks the latest RELEASE build for the release channel` (latest 2.11.0, ignores
          2.12.0-1a.1.0.0 preview), `picks the latest PREVIEW build and detects a newer preview`
          (current 2.10.0-1a.1.0.0 → latest 2.11.0-1a.2.0.0, display 'amadeus-preview'),
          `degrades gracefully to unknown latest when the feed throws`,
          `never falls back to a GitHub/git tag lookup (no bogus 7.161.26)` (current from the full
          `--version` string, latest 'unknown', display 'amadeus-preview'),
          `degrades gracefully when the feed returns an unexpected shape`.
      Leave `pullLatest`/update paths unchanged. Keep logging via `this.outputChannel.appendLine`.
      Files: src/services/updateChecker.ts
      Verify: `npx vitest run src/services/updateChecker.test.ts` — all 6 cases green.

- [ ] 4. Create the pure, vscode-free repo-version reader helper repoVersionReader.ts with a vscode-fs wrapper.
      Export `parseRepoAidlcVersion(fileText: string): string | null` — regex
      `/AIDLC_VERSION\s*=\s*["']([^"']+)["']/` capturing the version between single OR double quotes,
      tolerant of extra whitespace; return `null` when no match (missing export / malformed). Export
      `async readRepoAidlcVersion(workspaceUri: vscode.Uri): Promise<string | null>` that reads
      `.kiro/tools/aidlc-version.ts` under the workspace via `vscode.workspace.fs.readFile`
      (`vscode.Uri.joinPath`), returns `parseRepoAidlcVersion(text)`, and returns `null` (never
      throws) when the file is absent or unparseable. Put the pure parser first so the test imports
      it without touching vscode.
      Files: src/services/repoVersionReader.ts (new)
      Verify: builds under `npx tsc --noEmit`; exercised by the test added in step 5.

- [ ] 5. Add co-located repoVersionReader.test.ts covering the parser branches.
      Follow the existing co-located vitest pattern (see variantDetector/aidlcInstallReader tests).
      Cover `parseRepoAidlcVersion`: well-formed `export const AIDLC_VERSION = "2.5.67";` → '2.5.67';
      single-quoted value → parsed; extra whitespace around `=` → parsed; input with no
      `AIDLC_VERSION` export → null; malformed (e.g. `export const AIDLC_VERSION = ;`) → null. No
      vscode mock needed for the pure parser (keep the file importing only `./repoVersionReader`).
      Files: src/services/repoVersionReader.test.ts (new)
      Verify: `npx vitest run src/services/repoVersionReader.test.ts` — all new cases green.

- [ ] 6. Render the two-row version display in SystemProvider (Row A installed CLI, Row B repo configured).
      Inject the workspace uri source already available (SystemProvider has `ruleLoader`; read the
      first `vscode.workspace.workspaceFolders?.[0]?.uri` inside the provider, or pass it in — keep
      fs reads in the service layer, NOT in the SystemItem). Add a `repoVersion: string | null`
      field; in `loadStatus()`/`loadVersionInfo()` set it via `readRepoAidlcVersion(workspaceUri)`
      (swallow failures → null) alongside the existing version lookup.
      Row A — rework `buildVersionItem()` into an "Installed CLI" row driven by
      `this.versionInfo.variantDisplayId` + `currentVersion`: render 'AWS <ver>',
      'Amadeus <ver>', or 'Amadeus (Preview) <ver>' (e.g.
      'Amadeus (Preview) 2.10.0-1a.1.1.0-preview.3'); show 'Not installed' when no version resolves.
      Preserve the existing update-available affordance (keep the `system-update` item +
      `amadeus-aidlc.updateRules` inline menu wiring so package.json's `view/item/context` still
      matches) and the click-to-check command.
      Row B — add a new `buildRepoVersionItem()` returning a distinct SystemItem labelled
      'Repo configured' that shows `this.repoVersion` (e.g. '2.5.67') or 'Not configured' when null,
      with a tooltip clarifying this is the per-repo AIDLC_VERSION constant (distinct from the
      installed CLI). Push it in `getChildren()` right after the installed-CLI/version row.
      Keep all rendering in the view; file reads live in repoVersionReader + updateChecker.
      Files: src/views/systemProvider.ts
      Verify: `npm run compile` succeeds; `npx vitest run` stays green (no systemProvider unit test
      exists, so this is a compile/lint-gated change — confirm no type errors and no new lint
      warnings).

- [ ] 7. Confirm/adjust extension.ts downstream wiring and keep logging within the no-console baseline.
      Verify the existing activation flow still holds: `ruleLoader.restoreVariant()` → on resolve
      `updateChecker.setVariant(variant)` → `outputChannel.appendLine('Active variant: ...')`. If the
      active-variant log line benefits from the resolved channel, extend it to include
      `variant.channel` / `describeVariant(variant)` (optional, cosmetic). Do NOT add `console.*`;
      the only permitted lint warning remains the pre-existing `no-console` at extension.ts:37
      (the `console.error` in the activate() catch). No new command is registered (reuse
      `amadeus-aidlc.checkForUpdates`/`amadeus-aidlc.updateRules`) and no new config key is required
      (Row B reads the repo file directly), so package.json needs no command/config additions. If a
      config key is introduced for any reason, add it under `amadeus-aidlc.*` in BOTH
      package.json `contributes.configuration` and the consuming code.
      Files: src/extension.ts (minimal/none), package.json (none expected)
      Verify: `npm run compile` + `npm run lint` — lint shows ONLY the pre-existing
      no-console warning at extension.ts:37.

- [ ] 8. Full green-bar verification.
      Run the project's real commands end to end.
      Files: (none)
      Verify: `npm run compile` (clean, emits to out/), `npm run lint` (0 errors; exactly the one
      pre-existing no-console warning at src/extension.ts:37, no new warnings), `npm run test`
      (vitest `--run`: 0 failing, all 79+ tests green including the 12 previously-RED cases and the
      new repoVersionReader cases).

---

## Notes / assumptions
- `describeVariant` is introduced here rather than assumed pre-existing; its contract is pinned
  indirectly by updateChecker.test.ts (`variantDisplayId` values). Keep it pure so systemProvider
  and updateChecker share one source of truth for the three display states.
- The Amadeus "current version" is intentionally the FULL string (with the preview suffix). The
  AWS path keeps the numeric-only semver it already parses — only the amadeus path needs the full
  token, and the "never falls back" test pins that.
- Feed-URL precedence is: on-disk `aidlc.settings.json release-base-url` (via `readAidlcInstall`)
  first, hardcoded `variant.artifactory` constant second. The updateChecker test mocks fs to
  ENOENT, so in that suite the hardcoded constant supplies the base and the `curl` mock returns the
  token list regardless of exact URL — keep the curl command shape so `cmd.includes('curl')` matches.
- Row B reads `.kiro/tools/aidlc-version.ts` as text and regex-parses it — never `import`/execute the
  TS file (it would drag in a module the extension must not run), honoring the read-only constraint.
- Do not weaken/delete any test. Make production satisfy the asserted API.
```