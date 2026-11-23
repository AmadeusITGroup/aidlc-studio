# EVE GitHub Action (on-demand reference)

> **On-demand reference for the devsecops agent.** Consult this for the full EVE
> GitHub Action surface: SHA pinning, per-scanner inputs, session config,
> credentials, and complete workflow examples. The compact GitHub Action summary
> lives in `../aidlc-devsecops-agent/devsecops-pipeline-patterns.md`.
>
> `amadeus-appsec/eve-action@RELEASE_TAG` — a GitHub Action wrapping the EVE CLI for CI/CD security scans.

## Pinning the Action to a Commit SHA

GitHub best practice is to pin third-party actions to a full commit SHA rather than a mutable tag. To find the correct SHA for the latest release:

```bash
# 1. List recent releases to find the latest tag
GH_PAGER=cat gh release list --repo amadeus-appsec/eve-action --limit 5

# 2. Get the tag object SHA (annotated tags point to a tag object, not a commit)
GH_PAGER=cat gh api repos/amadeus-appsec/eve-action/git/ref/tags/<TAG> --jq '.object'

# 3. If .object.type is "tag" (annotated), dereference to the actual commit
GH_PAGER=cat gh api repos/amadeus-appsec/eve-action/git/tags/<TAG_SHA> --jq '.object'
```

**Example for v0.6.1:**

```bash
# Step 1 — find latest release
GH_PAGER=cat gh release list --repo amadeus-appsec/eve-action --limit 5
# → v0.6.1  Latest  v0.6.1  ...

# Step 2 — get tag ref
GH_PAGER=cat gh api repos/amadeus-appsec/eve-action/git/ref/tags/v0.6.1 --jq '.object'
# → {"sha":"2c0cc458...","type":"tag",...}   ← annotated tag, NOT a commit

# Step 3 — dereference annotated tag to commit
GH_PAGER=cat gh api repos/amadeus-appsec/eve-action/git/tags/2c0cc458... --jq '.object'
# → {"sha":"1650b155d096b4ff7eabd381a3f2c7c14ab43a44","type":"commit",...}   ← use this
```

Use the **commit SHA** (from step 3) in your workflow, with a trailing comment for readability:

```yaml
uses: amadeus-appsec/eve-action@1650b155d096b4ff7eabd381a3f2c7c14ab43a44 # v0.6.1
```

> **Important:** If step 2 returns `"type": "commit"` directly (lightweight tag), use that SHA immediately — skip step 3.

**`RELEASE_TAG` is a placeholder, not a usable ref.** Every workflow example below shows `amadeus-appsec/eve-action@RELEASE_TAG` — you MUST replace `RELEASE_TAG` with the resolved **commit SHA** (from step 3) before the workflow will run. Never ship `@RELEASE_TAG`, `@main`, `@latest`, or a bare tag to production.

## Prerequisites

- Node >= 20
- Git >= 2.25.0 (Unix) / >= 2.38.0 (Windows)
- Network access to: Artifactory (`http://repository.rnd.amadeus.net/artifactory`), LDAP (`ldaps://ldap.iis.amadeus.net`), SESM

The Amadeus self-hosted GitHub runner meets these requirements.

## Session Setup

Blackduck, Falcon, and Fortify support result upload to Security Center via sessions.

| Input | Description |
|-------|-------------|
| `session` | `'true'` to force session creation, `'false'` to disable |
| `nano-uuid` | Nano/YAC UUID for the product |
| `ssc-application` | Application name in Fortify SSC |
| `ssc-version` | Version name in Fortify SSC |
| `blackduck-group` | Blackduck group ID (integer) |
| `auto-create` | Auto-create SSC version if missing (default: `true`) |
| `ssc-source-version` | Source version for new version creation (default: `default`) |
| `no-ssc-source-version-history` | Do not copy triage history from source version |

> Ensure the SSC application exists and the scanning user is part of the isolation zone. Create applications via COMPaaS Control Tower.

## Credentials

**Required** — use repository secrets, never personal accounts (use robotic/IZ_USER accounts):

```yaml
amaiisdom-username: ${{ secrets.IZ_USER }}
amaiisdom-password: ${{ secrets.IZ_PASSWORD }}
```

## Branch Configuration

Before generating a workflow, discover the branches available in the repository:

```bash
git branch -r | sed 's|origin/||' | grep -v HEAD
```

Use the discovered branches to populate the `on:` trigger in your workflow YAML.

**`ssc-version` strategy:**

| Workflow Type | `ssc-version` Value | Rationale |
|---------------|---------------------|-----------|
| PR/push | `${{ github.ref_name }}` | Dynamic — creates an SSC version per branch (with `auto-create: true`) |
| Weekly scheduled | Fixed branch name (e.g., `weekly`) | Cron always runs on the default branch |

> **Note:** Using `${{ github.ref_name }}` with `auto-create: true` will automatically create a new SSC version for each branch that triggers a scan. Consider limiting PR/push triggers to protected branches if you want to avoid SSC version proliferation.

## Scheduling Recommendations

> **Secrets scanning is excluded** from EVE Action workflows — Amadeus already provides it as a default configuration.

**Fortify SAST scan time depends on code complexity** and can range from minutes to hours. Running Fortify on every merge may significantly slow down CI feedback loops.

**Recommended approach — split workflows:**

| Workflow | Trigger | Scanners |
|----------|---------|----------|
| `sdl-pr-scans.yml` | `push` / `pull_request` on target branches | User-selected fast scanners (e.g., Dependency-Check, Opengrep for non-prioritized apps) |
| `sdl-weekly-scans.yml` | `schedule: cron` + `workflow_dispatch` | All scanners (Fortify or Opengrep, Dependency-Check, Falcon/RHACS, Blackduck) |

**Cron syntax examples:**

| Schedule | Cron Expression |
|----------|-----------------|
| Sunday 02:00 UTC | `0 2 * * 0` |
| Monday 06:00 UTC | `0 6 * * 1` |
| Daily at midnight | `0 0 * * *` |

Add `workflow_dispatch` to the scheduled workflow to allow on-demand full scans (e.g., before a release).

## Scanner Inputs

### Secrets

```yaml
secrets: |
  - target: .
```

> Set `fetch-depth: 0` in the checkout action for pull request scanning. Secret scanner only runs on pull requests.

### Opengrep

```yaml
opengrep: |
  - target: .
  - target: src/
```

> Opengrep is a fast, rule-based SAST scanner. Use it as an **alternative to Fortify** for non-prioritized applications or as a fallback when Fortify is unavailable. It is language-agnostic and fast enough for every PR/push workflow.

### Falcon

```yaml
falcon: |
  - image: debian
  - image: alpine:3.6
  - images:
    - python:3.9-slim
    - python:3.10-slim
```

> **Note:** Prisma Cloud is deprecated. Use Falcon for container image scanning (Kubernetes, ECS, general workloads) or RHACS for OpenShift environments.

### RHACS

```yaml
rhacs: |
  - image: debian
  - images:
    - python:3.11-slim
    - python:3.12-slim
```

> RHACS is experimental. Support is not guaranteed.

### Blackduck

```yaml
blackduck: |
  - artifact-path: vulnerable-artifact.zip
  - artifact-path: second-vulnerable-artifact.zip
```

### Dependency-Check

```yaml
dependency-check: |
  - target: .venv
  - target: /path/to/my/repository
    parameters: '--nodeAuditSkipDevDependencies --disableYarnAudit'
```

### Fortify

```yaml
fortify: |
  - translates:
    - flavor: python
      target: client
    - flavor: maven
      target: server/pom.xml
      arguments: -Dparam=true
    - flavor: maven
      target: pom.xml
      command: "./mvnw -B"
    - flavor: bms
      target: Description.xml
    - flavor: native
      parameters: target/ -python-version 3 -python-path .venv/lib/python3.11/site-packages
    - flavor: wrapper
      arguments: target/ -python-version 3 -python-path .venv/lib/python3.11/site-packages
```

**Fortify translate flavors:** `bms`, `wrapper`, `python`, `maven`, `native`

**Additional Fortify attributes:**
- `target` — directory/package/module/file (required for `bms`, `python`, `maven`)
- `paths` — list of Python paths (use output of `python -c "import sys; print(':'.join(sys.path).removeprefix(':'))"`)
- `parameters` — native Fortify parameters (only `native` flavor)
- `arguments` — additional arguments (only `wrapper` and `maven` flavors)
- `command` — base command (only `maven` and `bms` flavors; defaults: `mvn -B`, `bms`)
- `analyse` — forward native Fortify analyse parameters

## Complete Workflow Examples

### PR/Push Workflow (fast scanners)

```yaml
name: SDL Security Scans (PR)

on:
  push:
    branches: [main]          # ← Replace with discovered branches
  pull_request:
    branches: [main]          # ← Replace with discovered branches

jobs:
  security-scan:
    runs-on: gmsshr-core-amadeus-<organization> # ← Replace with your organization name
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: EVE Security Scan
        uses: amadeus-appsec/eve-action@RELEASE_TAG # ← Pin to a commit SHA before use — see "Pinning the Action to a Commit SHA" above
        with:
          dependency-check: |
            - target: .
          # opengrep: |              # Use instead of Fortify for non-prioritized apps
          #   - target: .

          session: 'true'
          nano-uuid: 015d6740-4bce-12ee-8141-0060560c4911
          ssc-application: juice-shop
          ssc-version: ${{ github.ref_name }}
          auto-create: 'true'

          amaiisdom-username: ${{ secrets.IZ_USER }}
          amaiisdom-password: ${{ secrets.IZ_PASSWORD }}
```

### Weekly Scheduled Workflow (all scanners)

```yaml
name: SDL Security Scans (Weekly)

on:
  schedule:
    - cron: '0 2 * * 0'      # Every Sunday at 02:00 UTC
  workflow_dispatch:            # Allow manual trigger

jobs:
  security-scan:
    runs-on: gmsshr-core-amadeus-<organization> # ← Replace with your organization name
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: EVE Security Scan
        uses: amadeus-appsec/eve-action@RELEASE_TAG # ← Pin to a commit SHA before use — see "Pinning the Action to a Commit SHA" above
        with:
          dependency-check: |
            - target: .venv
          fortify: |
            - translates:
              - flavor: maven
                target: pom.xml
          # opengrep: |              # Use instead of Fortify for non-prioritized apps
          #   - target: .
          falcon: |
            - image: debian
            - image: alpine:3.6
          blackduck: |
            - artifact-path: vulnerable-artifact.zip
          rhacs: |
            - image: debian
            - images:
              - python:3.11-slim
              - python:3.12-slim

          session: 'true'
          nano-uuid: 015d6740-4bce-12ee-8141-0060560c4911
          ssc-application: juice-shop
          ssc-version: main              # ← Fixed: default branch name
          blackduck-group: 1234
          auto-create: 'true'

          amaiisdom-username: ${{ secrets.IZ_USER }}
          amaiisdom-password: ${{ secrets.IZ_PASSWORD }}
```

> **Note:** Secrets scanning is not included — Amadeus already provides it as a default configuration.
