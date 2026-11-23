# Repository Evidence Gathering (Feasibility)

Read-only protocol for pulling feasibility evidence from existing code
repositories. Used by the **feasibility** stage (Step 5). The user gives a flat
list of repos and does NOT classify the host; you detect the host per repo and
route: **GitHub → the GitHub MCP tools**, **everything else →
`git` CLI**. Inspection is scope-gated (only the repos the user listed) and
strictly read-only.

## Host detection & routing

For each repository reference the user provided, infer the host and pick the
access method automatically — never ask the user which host it is:

| Reference looks like | Host | Access method |
|----------------------|------|---------------|
| `github.com/...`, `git@github.com:...`, a `github.*` enterprise host, or a bare `owner/repo` that resolves on GitHub | GitHub | GitHub MCP tools (read-only) |
| `bitbucket.*`, `gitlab.*`, any self-hosted host, or any other clone URL | non-GitHub | `git` CLI (read-only) |

Fallback: if the GitHub MCP tools are not provisioned in this
session (an unreachable gateway simply leaves them absent), try the read-only
**`gh` CLI** (GitHub CLI) next when it is installed and authenticated
(`gh auth status` — e.g. `GH_PAGER=cat gh api ...`, `gh issue view`, `gh pr view`);
if `gh` is unavailable, inspect the GitHub repo with the read-only `git` CLI
instead, or ask the user to paste the details. Record which path was used.

## Golden rules

1. **Read-only, always.** Never write, branch, comment, open issues/PRs, add a
   remote, or `git push` against an inspected repo. Only read.
2. **Scope-gated.** Inspect only the repositories the user listed in the
   feasibility question (listing a repo authorizes reading it); skip any repo
   the user flagged as off-limits. Nothing listed → skip inspection entirely.
3. **Never block the stage.** If a server/credential/clone is unavailable,
   report it and ask the user to paste the details instead. Feasibility can
   always proceed from user answers alone.
4. **Traceable.** Tag every repo-derived fact `[repo:<host>/<owner>/<name>@<sha>]`
   and pin to the exact commit you read.
5. **No secrets in artifacts.** If a manifest or CI file exposes a token/secret,
   reference it by key name only — never copy the value into an artifact.

## What to collect (both hosts)

- **Dependency / build manifests** → tech stack + version constraints:
  `package.json`, `pom.xml`, `build.gradle(.kts)`, `requirements.txt`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `*.csproj`, etc.
- **CI / pipeline config** → build/test/deploy surface:
  `.github/workflows/*`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `.gitlab-ci.yml`.
- **Language mix** and repo size → effort/skill signal.
- **Recent commits + authorship** → maintenance cadence and code-ownership signal.
- **Open issues** (integration/deprecation relevant) → integration risk signal.
- **License** → build-vs-buy and compliance input.

## GitHub repos — via the GitHub MCP tools (read-only)

Use only these read tools, one call per `owner/repo` as needed:

- `github_get_file_contents` — read each manifest and CI file (the blob at the
  default-branch head; capture the commit SHA).
- `github_search_code` — locate a manifest/config across a repo you have not cloned.
- `github_list_commits` — recent commits (cadence, contributors).
- `github_list_issues` / `github_issue_read` — open issues filtered to
  integration or deprecation keywords.
- `github_get_me` — one-shot reachability/identity check.

Do NOT call a tool that mutates state (`github_issue_write`,
`github_create_pull_request`, `github_add_issue_comment`,
`github_update_pull_request`, `github_pull_request_review_write`). If a tool's
name or description implies a write, do not use it.

**Tools not provisioned?** If the GitHub MCP tools are not
present in the session, either:
- confirm the gateway is configured in `.kiro/settings/mcp.json` and reconnect
  it, then re-run, or
- fall back to the read-only `gh` CLI when it is installed and authenticated
  (`gh auth status`), using read-only subcommands only (`GH_PAGER=cat gh api`,
  `gh search code`, `gh issue view`, `gh pr view`), or
- fall back to a read-only `git` clone over HTTPS (see the `git` CLI section
  below — those commands work for any Git host, GitHub included), or
- ask the user to paste the manifest/CI contents.
Record which path was used in `repo-evidence.md`.

## Non-GitHub repos (Bitbucket, GitLab, self-hosted) — via the `git` CLI (read-only)

Use the user's existing credentials. Clone shallow into an OS temp dir OUTSIDE
the workspace and inspect via `git show`.

```bash
tmp="$(mktemp -d)"
git clone --depth 1 "<clone-url>" "$tmp/repo"        # shallow, read-only
git -C "$tmp/repo" rev-parse HEAD                     # pin the commit SHA
git -C "$tmp/repo" ls-files                           # enumerate tracked files
git -C "$tmp/repo" log --oneline -n 20                # cadence / authorship
git -C "$tmp/repo" show HEAD:package.json             # read a manifest blob
git -C "$tmp/repo" show HEAD:.github/workflows/ci.yml # read a CI config blob
```

Notes:
- Read file contents with `git -C "$tmp/repo" show HEAD:<path>` rather than a
  file reader — the temp clone lives outside the workspace and the sandboxed
  file-read tool cannot reach it.
- `git ls-remote <url>` lists refs without cloning — useful for a quick
  existence/branch check before a full clone.
- Never clone into `aidlc/` or the workspace root; never add a remote; never push.
- **Cleanup:** the clone is under the OS temp dir (`mktemp -d`), which the OS
  reaps; recursive `rm` is intentionally blocked by the tool sandbox, so do not
  attempt to delete the clone yourself.
- If the clone fails (auth, network, private repo), report and ask the user to
  paste details — do not retry destructively.

## Feeding the artifacts

| Evidence | Artifact | Notes |
|----------|----------|-------|
| Observed stack + versions | feasibility-assessment | tag `[repo:...@sha]` |
| Version/license/deprecation limits | constraint-register | one row per constraint |
| Integration dependencies + risks | raid-log | Dependencies / Risks sections |
| Maintenance cadence, ownership | feasibility-assessment | skill/effort signal |

Raw findings live in `<record>/ideation/feasibility/repo-evidence.md`; the three
gated artifacts carry the synthesized, source-tagged rows.
