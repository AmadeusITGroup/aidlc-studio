# Remote Repository Evidence (Inception)

Read-only protocol for pulling **remote-only** evidence from a repository's
hosting platform during Inception. Used by **reverse-engineering** (Step 2
developer scan, Step 3 architect synthesis) and **practices-discovery**
(Step 2 lead draft). Both stages already read the local working tree; this
protocol adds the signals a local clone does **not** carry — open issues, pull
requests, review threads, branch/status-check configuration, and the contents
of a repo that was never cloned locally.

The host is detected per repo and routed automatically — never ask the user
which host it is: **GitHub → the GitHub MCP tools**,
**everything else (Bitbucket, GitLab, self-hosted) → the read-only `git` CLI**.
Inspection is strictly read-only.

## Mode note — this protocol must be delivered in the dispatch brief

reverse-engineering is `mode: pipeline` and practices-discovery is
`mode: subagent`: the agents that gather this evidence run as **dispatched
subagents in isolated context**. Unlike an `inline` stage (where the conductor
holds every voice and this file loads into its own context), a dispatched agent
only auto-loads its own persona + knowledge dir. So the conductor MUST, in the
dispatch brief:

1. name this file's path (`.kiro/knowledge/aidlc-shared/repo-remote-evidence.md`)
   so the agent loads it — it is under `knowledge/aidlc-shared/`, which every
   participating agent already resolves; and
2. pass the resolved repo set (host + `owner/repo` or clone URL per entry) into
   the brief, since the subagent cannot see the conductor's context.

Only the evidence-gathering agents carry the `github_*` grant (developer +
architect for reverse-engineering; the pipeline-deploy lead for
practices-discovery). Blind support spokes review the gathered evidence — they
do not re-fetch.

## Host detection & routing

| Reference looks like | Host | Access method |
|----------------------|------|---------------|
| `github.com/...`, `git@github.com:...`, a `github.*` enterprise host, or a bare `owner/repo` that resolves on GitHub | GitHub | GitHub MCP tools (read-only) |
| `bitbucket.*`, `gitlab.*`, any self-hosted host, or any other clone URL | non-GitHub | `git` CLI (read-only) |

Fallback: if the GitHub MCP tools are not present in the
session (an unreachable or unconfigured gateway simply leaves them absent),
try the **`gh` CLI** (GitHub CLI) next — when it is installed and authenticated
(`gh auth status`), its read-only subcommands reach the same GitHub surface (see
"GitHub fallback — via the `gh` CLI" below). If `gh` is unavailable or not
authenticated, inspect the GitHub repo with the read-only `git` CLI instead, or
ask the user to paste the details. Record which path was used.

## Golden rules

1. **Read-only, always.** Never write, branch, comment, open or edit an
   issue/PR, merge, add a remote, or `git push`. Only read. Use only the
   read tools listed below — never a `*_write`, `create_*`, `update_*`, or
   `add_*` GitHub tool.
2. **Remote-only.** Do not re-fetch what the local working tree already gives
   you (source, manifests on disk, local `git log`). Pull the signals that live
   on the host: open issues, pull requests, review threads, required status
   checks, branch protection, and the contents of an uncloned repo.
3. **Scope-gated.** Inspect only the repos in the intent's resolved set. Never
   discover or wander to linked/forked repos.
4. **Never block the stage.** If the gateway, a credential, or a clone is
   unavailable, note it and proceed from the local scan and user answers. The
   stage always has a fallback.
5. **Traceable.** Tag every remote-derived fact
   `[repo:<host>/<owner>/<name>@<sha-or-ref>]` and pin to the commit/ref you read.
6. **No secrets in artifacts.** If a workflow or config file exposes a
   token/secret, reference it by key name only — never copy the value.

## GitHub — via the GitHub MCP tools (read-only)

Use only these read tools (all are on the GitHub MCP auto-approve
list, so they run without a per-call prompt):

| Tool | Use it for |
|------|------------|
| `github_get_me` | One-shot reachability/identity probe — confirm the GitHub surface is live before relying on it. |
| `github_get_file_contents` | Read a file or directory at a ref: dependency/build manifests, `.github/workflows/*`, `CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE*`, `.github/ISSUE_TEMPLATE/*`, and other config. Capture the commit SHA. |
| `github_search_code` | Locate files/patterns across a repo that is not cloned locally. |
| `github_list_commits` | Commit cadence, authorship, commit-message conventions, release rhythm. |
| `github_list_issues` | Open issues: tech-debt/defect signal, triage labels, issue-template usage. |
| `github_issue_read` | One issue's detail/comments when a specific issue matters. |
| `github_list_pull_requests` | PR flow: merge strategy, review cadence, branch-naming convention. |
| `github_pull_request_read` | One PR's reviews, status checks, and changed files: review posture and required-check practice. |

Never call a GitHub tool whose name implies a write (`github_issue_write`,
`github_create_pull_request`, `github_add_issue_comment`,
`github_update_pull_request`, `github_pull_request_review_write`). If a tool's
name or description implies a mutation, do not use it.

## GitHub fallback — via the `gh` CLI (read-only)

When the GitHub MCP tools are absent, the `gh` CLI reaches the same surface —
but only when it is installed and authenticated (check `gh auth status` first).
Use **read-only subcommands only**, and prefix calls with `GH_PAGER=cat` so they
do not block on an interactive pager:

| MCP tool | `gh` equivalent (read-only) |
|----------|-----------------------------|
| `github_get_me` | `gh api user` |
| `github_get_file_contents` | `gh api repos/<owner>/<repo>/contents/<path>?ref=<ref>` |
| `github_search_code` | `gh search code <query> --repo <owner>/<repo>` |
| `github_list_commits` | `gh api repos/<owner>/<repo>/commits` |
| `github_list_issues` / `github_issue_read` | `gh issue list` / `gh issue view <n> --comments` |
| `github_list_pull_requests` / `github_pull_request_read` | `gh pr list` / `gh pr view <n> --comments` |

The read-only rule applies to `gh` exactly as it does to the MCP tools: never
run a `gh` subcommand that mutates state (`gh pr create`, `gh issue create`,
`gh pr merge`, `gh repo delete`, or `gh api` with `-X POST|PATCH|PUT|DELETE`).
`gh` is not on an auto-approve list, so each call prompts for approval — that is
expected for a fallback. If `gh` is also unavailable, fall back to the `git` CLI
below or ask the user to paste the details.

## Non-GitHub repos (Bitbucket, GitLab, self-hosted) — via the `git` CLI (read-only)

Plain `git` exposes commits, refs, and file blobs — but **not** pull requests,
issues, reviews, or branch-protection config (those need the host's own API,
which is not provisioned here). So for a non-GitHub host: read what `git` gives,
and record the PR/issue/review signals as "unavailable via git — host API not
configured" rather than blocking.

For a repo already cloned locally (the sibling dir the stage scans), read its
history in place. For an uncloned repo, shallow-clone into an OS temp dir
OUTSIDE the workspace and inspect via `git show`:

```bash
tmp="$(mktemp -d)"
git clone --depth 1 "<clone-url>" "$tmp/repo"        # shallow, read-only
git -C "$tmp/repo" rev-parse HEAD                     # pin the commit SHA
git -C "$tmp/repo" ls-files                           # enumerate tracked files
git -C "$tmp/repo" log --oneline -n 20                # cadence / authorship / message style
git -C "$tmp/repo" show HEAD:.github/workflows/ci.yml # read a CI config blob
```

Notes:
- Read blobs with `git -C "$tmp/repo" show HEAD:<path>` — the temp clone lives
  outside the workspace and the sandboxed file reader cannot reach it.
- `git ls-remote <url>` lists refs without cloning — a quick existence/branch check.
- Never clone into `aidlc/` or the workspace root; never add a remote; never push.
- **Cleanup:** the clone is under `mktemp -d`, which the OS reaps; recursive
  `rm` is blocked by the tool sandbox — do not attempt to delete it yourself.
- If the clone fails (auth, network, private repo), report it and proceed from
  the local scan — do not retry destructively.

## Feeding the artifacts

**reverse-engineering** — fold remote findings into the 9 codekb artifacts,
each fact source-tagged:

| Remote evidence | Artifact |
|-----------------|----------|
| Manifests / `.github/workflows/*` read at ref (esp. for an uncloned repo) | technology-stack, dependencies, api-documentation |
| Open-issue / PR churn, review cadence, required checks | code-quality-assessment |
| Commit cadence & authorship | code-quality-assessment (tech-debt / ownership signal) |

**practices-discovery** — fold remote findings into `evidence.md` and the lead
draft, each fact source-tagged:

| Remote evidence | team.md section |
|-----------------|-----------------|
| Branch protection, required status checks, `CODEOWNERS`, PR review threads | Way of Working / Testing Posture |
| Merge strategy, branch naming, release tags & cadence | Deployment |
| `.github/workflows/*` gates, lint/scan steps, PR/issue templates | Testing Posture / Code Style |

Treat the code and host configuration as the source of truth; where a wiki or
user answer conflicts with the observed configuration, flag the drift and keep
the human's stated intent authoritative for team-intent questions.
