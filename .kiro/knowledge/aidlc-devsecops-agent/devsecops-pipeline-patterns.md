# Amadeus Secure Development Lifecycle (SDL) with EVE

> **EVE** (Ecosystem Vulnerabilities & Exploration) is the CLI tool and GitHub
> Action for security scanning in the Amadeus ecosystem. This is the security
> tooling the devsecops agent uses — it integrates with **Security Center** for
> centralized vulnerability tracking. All EVE scanners are provided at no extra
> cost and require no additional license.

This guide is the devsecops agent's methodology for security scanning across the
AI-DLC lifecycle. The agent applies it primarily in **Practices Discovery (2.2)**
(recording the team's scanning posture), **NFR Requirements (3.2)** (specifying
which touchpoints apply), and **Build and Test (3.6)** (running the scans and
enforcing gates). The agent has Bash access to run `eve` commands.

## Deep references (consult on demand)

The detail below is the always-loaded summary. Deeper procedures live in
`.kiro/knowledge/aidlc-devsecops-references/` and are **not**
auto-loaded — open the specific file only when the task calls for it:

- **`scanner-selection.md`** — read before choosing an SCA scanner or resolving a
  container image (full technology→scanner mapping, Black Duck / Dependency-Check
  supported formats, decision flowcharts, container image auto-discovery).
- **`eve-github-action.md`** — read when configuring `amadeus-appsec/eve-action`
  (SHA pinning, per-scanner inputs, session/credentials, complete workflow examples).
- **`security-scan-setup.md`** — read end-to-end before creating, updating, or
  troubleshooting `.github/workflows/security-scans.yml` (the authoritative source
  for that workflow).
- **`fortify.md`** — read before a Fortify translate for Python, Go, JS/TS, or
  mixed-language codebases.
- **`cicd-pipelines.md`** — read for EVE CLI pipeline scripts on non-GitHub-Actions CI.
- **`documentation-index.md`** — open to surface the right Confluence page for an SDL topic.
- **`support.md`** — open to give the user the correct ServiceNow ticket or Teams channel link.

## Core Rules

1. **Only use EVE-provided scanners.** Never suggest external tools
   (`govulncheck`, `npm audit`, `pip-audit`, `trivy`, `grype`, `syft`, etc.).
   EVE integrates with Security Center for centralized tracking.
2. **Always confirm the execution mode** before running any scan: local (no
   session), session (laptop), or GitHub Action. Ask the user through the
   stage's normal question flow.
3. **Session mode requires `.eve/config.toml`** — always create it first.
4. **Always clear the session before opening a new one** (`eve scan session
   --clear`) to avoid stale-session conflicts. Also clear it if any scan errors
   out, so it is never left in a broken state.
5. **Never use `--mode raw_file` by default** for secrets scanning — use
   `--mode history`. This rule governs manual/CI full-repo scans, where git
   history coverage matters. **Exception:** the `PostFileSave`/`PostFileCreate`
   fast-scan hook scans a single just-written file that is typically not yet
   committed (and may live in a non-git workspace); there `history` mode has no
   history to inspect and silently finds nothing, so that hook uses `raw_file`
   by design.
6. **Skip Fortify in local mode** — its results are only visible in Security
   Center. Use **Opengrep** as the SAST alternative in local mode.
7. **Always exclude the virtualenv for Python Fortify scans.**
8. **Never use the Prisma scanner.** Prisma Cloud is deprecated and being
   decommissioned. For container image scanning use **RHACS** (recommended
   default for all container workloads) or **Falcon** (alternative for
   non-OpenShift environments). Replace any `eve scan prisma` with
   `eve scan rhacs`, and any `--prisma` session flag with `--rhacs`.
9. **Do not include secrets scanning in GitHub Action workflows** — Amadeus
   already provides it as a default configuration.
10. **Do not upload scan artifacts to Artifactory.** Scan results upload
    automatically to Security Center through the EVE session; adding
    `actions/upload-artifact`, JFrog CLI, or `curl` steps creates duplicate,
    untracked copies of security data.
11. **Point the user at authoritative documentation** for deeper SDL guidance
    (Security Center, Vulnerability Management, per-scanner pages) and to the
    support channels below when they hit tooling issues — surface the matching
    link from `.kiro/knowledge/aidlc-devsecops-references/documentation-index.md` and
    `.kiro/knowledge/aidlc-devsecops-references/support.md`.
12. **For GitHub Action details**, delegate to
    `.kiro/knowledge/aidlc-devsecops-references/eve-github-action.md`.
13. **For CI/CD pipeline scripts**, delegate to
    `.kiro/knowledge/aidlc-devsecops-references/cicd-pipelines.md`.
14. **For scanner selection guidance** (which scanner to use for each technology,
    TP8 sub-touchpoints, Container vs Non-Container SCA), delegate to
    `.kiro/knowledge/aidlc-devsecops-references/scanner-selection.md`.
15. **When the user needs more context on SDL processes**, suggest relevant
    documentation pages from
    `.kiro/knowledge/aidlc-devsecops-references/documentation-index.md`.
16. **When generating a GitHub Action workflow**, discover remote branches first
    (`git branch -r | sed 's|origin/||' | grep -v HEAD`), use
    `${{ github.ref_name }}` for `ssc-version` in PR/push workflows and a fixed
    default-branch name for scheduled workflows, and recommend splitting fast vs
    heavy scanners (Fortify SAST can take minutes to hours). Do not include
    secrets scanning (Amadeus provides it by default). Full reference:
    `.kiro/knowledge/aidlc-devsecops-references/eve-github-action.md`.
17. **When Black Duck requires a build artifact, do not invent build commands.**
    Search the repository for existing build instructions (`Makefile`,
    `build.sh`, `build.gradle`, `pom.xml`, `package.json` scripts, `Dockerfile`,
    `Jenkinsfile`, `README`, CI config) and follow them to produce the artifact
    for `artifact-path`.
18. **If Fortify Python translate warns about needing a build or unresolved
    imports**, locate the Python binary (`which python3`, or a virtualenv's
    `bin/python`) and retry with `--executable` instead of `--path`:
    `eve scan fortify translate python <target> --executable $(which python3) --version 3`.
19. **Always end security guidance with a "📖 Official documentation" section**
    containing one or more relevant Confluence links from
    `.kiro/knowledge/aidlc-devsecops-references/documentation-index.md`,
    matched to the user's topic — giving them a path to deeper, authoritative
    information beyond what the agent provides.
20. **When Container SCA is applicable and no image name is provided,
    auto-discover it from CI files** before asking the user: search `Jenkinsfile`
    and `.github/workflows/*.yml` for image references (both `docker` and
    `podman`), resolve GitHub expressions with `gh variable get`, inspect
    `workflow_dispatch` inputs of type `choice`, then `skopeo list-tags docker://…`
    to find tags (never the `latest` tag). Present the resolved image for
    confirmation; fall back to asking only if none is found. Full procedure:
    `.kiro/knowledge/aidlc-devsecops-references/scanner-selection.md` § Container Image Auto-Discovery.
21. **For dedicated setup/update/troubleshooting of
    `.github/workflows/security-scans.yml`**, delegate to
    `.kiro/knowledge/aidlc-devsecops-references/security-scan-setup.md`.
22. **`security-scan-setup.md` is the single source of truth for
    `.github/workflows/security-scans.yml` generation.** When creating or updating
    that workflow, follow
    `.kiro/knowledge/aidlc-devsecops-references/security-scan-setup.md`
    end-to-end and do not improvise structure from other documents.
23. **Do not generate inline ad-hoc `steps`-based templates for
    `.github/workflows/security-scans.yml`** (for example direct `actions/checkout`
    + `amadeus-appsec/eve-action`) unless
    `.kiro/knowledge/aidlc-devsecops-references/security-scan-setup.md`
    explicitly instructs it for the user's case.
24. **If any guidance conflicts for `.github/workflows/security-scans.yml`,
    `security-scan-setup.md` takes precedence** over
    `.kiro/knowledge/aidlc-devsecops-references/eve-github-action.md`,
    `.kiro/knowledge/aidlc-devsecops-references/cicd-pipelines.md`, and
    generic examples.

## Skill Workspace

All scan-related working artifacts live in **`.eve/agentic/`** at the project
root, co-located with `.eve/config.toml`.

```
.eve/
├── config.toml              # EVE session config
└── agentic/
    └── tmp/                 # Throwaway intermediate outputs (SSC exports, debug logs, scratch)
```

- Temp files go in `tmp/` — clean up when done, never commit them.
- Ensure `.gitignore` contains `\.eve/agentic/*` so generated artifacts are not committed.

## 0. EVE Installation Check

Before any scan, verify EVE is installed with `eve --version`. If it is missing,
ask the user which installation method they prefer:

| Method | Requirements | Command / Action |
|--------|-------------|------------------|
| **Standalone** | none | Download and unzip from `https://repository.rnd.amadeus.net/artifactory/eve-generic-release-sdl-nce` |
| **Python executable** (recommended) | Python ≥ 3.9.1 | `curl -sSL https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install \| python3 -` |
| **pip** | Python ≥ 3.9.1 | `pip install --extra-index-url https://repository.rnd.amadeus.net/artifactory/api/pypi/eve-pypi-release-sdl-nce/simple sdl-eve` |
| **Linux package** | DEB/RPM repos | `apt install amadeus-sdl-eve` or `dnf install amadeus-sdl-eve` |

> Windows PowerShell: `(Invoke-WebRequest -Uri https://repository.rnd.amadeus.net/artifactory/eve-pypi-release-sdl-nce/sdl-eve/install -UseBasicParsing).Content | python -`

## 1. Scanner Selection

> For the full technology→scanner mapping, the Black Duck / Dependency-Check
> supported-format lists, and the decision flowcharts, read
> **`.kiro/knowledge/aidlc-devsecops-references/scanner-selection.md`**.

| Scanner | Use Case | Type | Touchpoint |
|---------|----------|------|------------|
| **Secrets** | Detect leaked secrets in code/history | Secret Detection | TP4 |
| **Fortify** | SAST — deep dataflow analysis | SAST | TP7 |
| **Opengrep** | Lightweight SAST — alternative to Fortify | SAST | TP7 |
| **Dependency-Check** | Non-container SCA (.NET, JS, TS, Python) | SCA | TP8 — Non-Container |
| **Black Duck** | Non-container SCA + OSS license compliance (Java, C/C++, Go, Kotlin, Scala, Ruby…) | SCA | TP8 — Non-Container |
| **RHACS** | Container image scanning — OpenShift / ACS (recommended default) | Container SCA | TP8 — Container |
| **Falcon** | Container image scanning — non-OpenShift environments | Container SCA | TP8 — Container |

### Touchpoint Model

- **TP4 (Secrets)** — always applies; mandatory regardless of other touchpoints.
- **TP7 (SAST)** — **Fortify** for prioritized applications (deep dataflow,
  required for compliance); **Opengrep** for non-prioritized apps or as a
  fallback when Fortify cannot run (local mode, config issues, errors).
- **TP8 (Application Dependencies)** splits into two independent sub-touchpoints:
  - **Container SCA** — scan container images: **RHACS** (default, especially
    OpenShift/ACS) or **Falcon** (non-OpenShift: standalone Docker, etc.).
  - **Non-Container SCA** — scan source/binaries: **Black Duck** for most
    technologies (Java, Kotlin, Scala, C/C++, Go, Ruby, Clojure, Groovy, Obj-C;
    **do NOT scan container images with Black Duck**), **Dependency-Check** for
    .NET, JavaScript, TypeScript, Python (also PHP, Swift, Perl, Go).
- **TP9 (DAST)** — not provided by EVE; inform the user it is out of scope.

### Container Image Resolution (auto-discovery)

When Container SCA is in scope and the user did not provide an image name,
auto-discover it before asking:

1. Search `Jenkinsfile` and `.github/workflows/*.yml` for image references
   (covering both `docker` and `podman` commands, `image:` keys, `IMAGE_NAME`/
   `REGISTRY` env vars, and GitHub expressions).
2. Resolve `${{ vars.X }}` / `${{ env.X }}` with `gh variable get <NAME>`.
3. Inspect `workflow_dispatch` inputs of type `choice` (e.g. `Integration`,
   `Staging`) and trace how the chosen value flows through `env:`/`if:` blocks
   to resolve the isolation zone and image name.
4. Run `skopeo list-tags docker://<registry>/<image>` to list tags (the
   `docker://` transport is correct for both Docker and Podman registries).
   Registry format: `docker://dockerhub.rnd.amadeus.net/<artifactory_isolation_zone>/<container_name>`.
   **Never use the `latest` tag** — it is not used in the Amadeus registry; if no
   branch/SHA match is found, present the tag list to the user.
5. Confirm the resolved image with the user before scanning. Fall back to asking
   directly only if no image reference is found.

> Full procedure (grep patterns, skopeo flags, `workflow_dispatch` choice
> tracing): **`.kiro/knowledge/aidlc-devsecops-references/scanner-selection.md` § Container Image Auto-Discovery**.

### Black Duck Group

A Black Duck group is required before Black Duck scans. If the user lacks one,
direct them to the BAS Group Creation Procedure, then record the integer
**group ID** for `.eve/config.toml` (`blackduck-group`) and
`eve scan session --blackduck N`.

### Scanner Plan

Before executing, present a summary and wait for confirmation:

| Touchpoint | Applicable | Scanner | Notes |
|------------|------------|---------|-------|
| TP4 (Secrets) | Always | Secrets | Mandatory |
| TP7 (SAST) | prioritized | Fortify | Primary SAST — session mode only |
| TP7 (SAST) | non-prioritized | Opengrep | Alternative / fallback |
| TP8 (Non-Container SCA) | from language | Black Duck / Dependency-Check | Based on technology |
| TP8 (Container SCA) | from deployment | RHACS / Falcon | Based on platform |
| TP9 (DAST) | — | _(not in EVE)_ | Out of scope; inform user |

## 2. Execution Modes

Always confirm the mode before scanning:

| Mode | When to Use | Setup Required |
|------|-------------|----------------|
| **Local (no session)** | Quick checks, development, no Security Center access | None |
| **Session (laptop)** | Official scans, compliance tracking, results uploaded | `.eve/config.toml` + credentials |
| **GitHub Action** | CI/CD automation | Workflow YAML + repo secrets |

### 2a. Local (no session)

Console/file output; results are **not** uploaded to Security Center.

```bash
eve scan secrets run .
eve scan opengrep .                              # SAST alternative to Fortify
eve scan rhacs my-image:tag --output report.json
eve scan dependency-check ./project --output report.html
```

> Skip Fortify locally — its results appear only in Security Center. Use Opengrep instead.

> **Automated fast feedback.** A `PostFileSave` hook runs `eve scan secrets
> --mode raw_file` and `eve scan opengrep` over ONLY the **just-saved code file**,
> so the fast pair runs automatically for instant, low-overhead feedback without
> rescanning the whole repo. Secrets uses non-git `raw_file` mode (scans the
> file's bytes directly) so findings are caught even in a non-git workspace,
> where eve's default `history` mode would scan git history and miss them. Reserve
> in-stage effort for the heavier scanners (Fortify, Black Duck, Dependency-Check,
> RHACS) in Build & Test and CI — do not wire those into a per-save hook.

### 2b. Session (laptop)

Uploads all results to Security Center.

**Step 1 — create `.eve/config.toml`** (collect the values from the user first):

```toml
[scan.session]
nano-uuid = "YOUR-NANO-UUID"     # Product/repository identifier
ssc-application = "my-app"        # Security Center app name
ssc-version = "master"            # Branch name
# environment = "uat"             # Uncomment to target the UAT Security Center
# blackduck-group = 999           # Black Duck group ID (integer)
# limit = 60                      # Session validity in minutes (default 15)

[scan.fortify.translate.python]
version = "3"
path = ".venv/lib/python3.12/site-packages"
```

**Step 2 — credentials:**

```bash
export EVE_CREDENTIALS_USERNAME_AMAIISDOM=<username>
export EVE_CREDENTIALS_PASSWORD_AMAIISDOM=<password>
# or interactive:
eve credentials amaiisdom [USERNAME]
eve credentials github   # token-based
eve credentials nano     # token-based
```

**Step 3 — clear, open a session, scan:**

```bash
eve scan session --clear                                       # ALWAYS clear first
eve scan session --secrets 1 --rhacs 1 --fortify 1 --limit 30  # declare expected scan counts
# non-prioritized apps: use --opengrep instead of --fortify

eve scan secrets run .
eve scan rhacs my-image:tag
eve scan fortify start && eve scan fortify translate <flavor> <target> && eve scan fortify analyse

eve scan session --clear   # if any scan fails, clear before retrying
```

**Session options:** `--nano-uuid`, `--ssc-application`, `--ssc-version`,
`--auto-create`, `--secrets N`, `--opengrep N`, `--falcon N`, `--fortify N`,
`--dependency-check N`, `--blackduck N`, `--rhacs N`,
`--limit N` (minutes; increase if scans fail with "Current scan session has
expired"), `--environment [prod|uat]`, `--clear`.

> **"Current scan session has expired"** means the session timed out before all
> scans finished uploading. Increase `--limit` (e.g. `--limit 60`) or set
> `limit = 60` in `.eve/config.toml`; the default 15 minutes is often too short
> for Fortify on large codebases. Always `--clear` before retrying.

### 2c. GitHub Action

Use `amadeus-appsec/eve-action@<COMMIT_SHA>` in workflows.

> **References for this section:**
> - Full EVE Action surface (SHA-pinning worked example, per-scanner input YAML,
>   session inputs, complete workflow examples): **`.kiro/knowledge/aidlc-devsecops-references/eve-github-action.md`**.
> - Creating, updating, or troubleshooting `.github/workflows/security-scans.yml`:
>   follow **`.kiro/knowledge/aidlc-devsecops-references/security-scan-setup.md`** end-to-end (the
>   authoritative source — do not improvise its structure from other documents).
> - EVE CLI pipeline scripts for non-GitHub-Actions CI:
>   **`.kiro/knowledge/aidlc-devsecops-references/cicd-pipelines.md`**.

- **Exclude secrets scanning** — Amadeus provides it by default.
- **Do not upload artifacts to Artifactory** — results auto-upload to Security Center.
- **Pin to a commit SHA**, not a mutable tag. Resolve it with `gh`:
  ```bash
  GH_PAGER=cat gh release list --repo amadeus-appsec/eve-action --limit 5
  GH_PAGER=cat gh api repos/amadeus-appsec/eve-action/git/ref/tags/<TAG> --jq '.object'
  # if type is "tag", dereference: gh api repos/amadeus-appsec/eve-action/git/tags/<TAG_SHA> --jq '.object'
  ```
  Then: `uses: amadeus-appsec/eve-action@<COMMIT_SHA> # <TAG>`
- **Discover branches** before generating: `git branch -r | sed 's|origin/||' | grep -v HEAD`.
- **Scheduling:** recommend the **split** approach — light scanners per PR/push,
  heavy scanners (Fortify) on a weekly schedule, since Fortify can take minutes
  to hours. Use `${{ github.ref_name }}` for `ssc-version` in PR/push workflows
  and a fixed default-branch name for scheduled workflows.

**Workflow A — `sdl-pr-scans.yml`** (per PR/merge, fast scanners):

```yaml
name: SDL Security Scans (PR)
on:
  push:
    branches: [main]          # ← discovered branches
  pull_request:
    branches: [main]
jobs:
  security-scan:
    runs-on: gmsshr-core-amadeus-<organization>   # ← your org runner
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - name: EVE Security Scan
        uses: amadeus-appsec/eve-action@RELEASE_TAG
        with:
          dependency-check: |
            - target: .
          # opengrep / rhacs / fortify: include only what the user selected
          session: 'true'
          nano-uuid: <NANO-UUID>
          ssc-application: <APP-NAME>
          ssc-version: ${{ github.ref_name }}
          auto-create: 'true'
          amaiisdom-username: ${{ secrets.IZ_USER }}
          amaiisdom-password: ${{ secrets.IZ_PASSWORD }}
```

**Workflow B — `sdl-weekly-scans.yml`** (scheduled, all scanners):

```yaml
name: SDL Security Scans (Weekly)
on:
  schedule:
    - cron: '0 0 * * 0'     # Sundays 00:00 UTC
  workflow_dispatch:
jobs:
  security-scan:
    runs-on: gmsshr-core-amadeus-<organization>
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - name: EVE Security Scan
        uses: amadeus-appsec/eve-action@RELEASE_TAG
        with:
          dependency-check: |
            - target: .
          fortify: |
            - translates:
              - flavor: python
                target: src
          rhacs: |
            - image: my-image:tag
          # blackduck: | (artifact-path must be a file: tar/zip/jar/war, not a folder)
          session: 'true'
          nano-uuid: <NANO-UUID>
          ssc-application: <APP-NAME>
          ssc-version: main               # ← fixed default branch for cron
          auto-create: 'true'
          amaiisdom-username: ${{ secrets.IZ_USER }}
          amaiisdom-password: ${{ secrets.IZ_PASSWORD }}
```

## 3. EVE CLI Quick Reference

| Task | Command |
|------|---------|
| Version | `eve --version` |
| Help | `eve --help` / `eve <command> --help` |
| Secrets | `eve scan secrets run <target>` |
| Opengrep (SAST) | `eve scan opengrep <target>` |
| Container image (RHACS) | `eve scan rhacs <image>` |
| Container image (Falcon) | `eve scan falcon image <image>` |
| Dependencies (SCA) | `eve scan dependency-check <path>` |
| SAST (Fortify) | `eve scan fortify start && eve scan fortify translate <flavor> <target> && eve scan fortify analyse` |
| Black Duck | `eve scan blackduck <artifact.tar.gz>` |
| Debug | add `--debug` to any command |

### Secrets

Scan from a git repository root (contains `.git`).

```bash
eve scan secrets run <target>                  # default: history mode (recommended)
eve scan secrets run <target> --mode changes   # staged changes only (CI/pre-commit)
eve scan secrets run <target> --mode raw_file   # USE WITH CAUTION
eve scan secrets run <target> --since <commit> --until <commit>
eve scan secrets allow <sha256_hash> "Reason"   # false-positive management
eve scan secrets disallow <hash>
```

### Opengrep (SAST)

Fast, rule-based, language-agnostic; works in local and session modes. Use as the
alternative to Fortify for non-prioritized apps, or as a fallback when Fortify
cannot run.

```bash
eve scan opengrep .        # or a subdirectory: eve scan opengrep src/
```

### Fortify (SAST) — session mode only

Fortify runs as **start → translate (one or more) → analyse**. Chain multiple
translates for mixed-technology codebases before a single `analyse`.

> Per-language translate guides (Python, Go, JS/TS, mixed-language) and
> troubleshooting: **`.kiro/knowledge/aidlc-devsecops-references/fortify.md`**.

```bash
eve scan fortify start                       # optional: --version "24.2.0"
eve scan fortify translate <flavor> <target>
eve scan fortify analyse
```

- Exclude the virtualenv for Python scans.
- Exclude the virtualenv for Python scans.

**Translate flavors** (from `eve scan fortify translate --help`):

| Flavor | Use for |
|--------|---------|
| `native` | Raw Fortify parameters against any target |
| `python` | Python packages, modules, or files |
| `maven` | A Maven directory or `pom.xml` (`--command "mvn -B"`) |
| `bms` | BMS components or forests (`--command "bms"`) |
| `wrapper` | A fully custom build command line |

- **Python:** give dependency locations — `--path <site-packages>` (repeatable) and/or `--executable <python>`; `--version` defaults to `3`. Exclude the virtualenv from the scanned target.
  - If Python translate warns about needing a build or unresolved imports, pass the interpreter with `--executable` instead of `--path`:
    `eve scan fortify translate python <target> --executable $(which python3) --version 3`.
- **Mixed technologies:** run several `translate` steps (e.g. `python` then `maven`) before one `analyse`.
- **Custom Fortify options:** append after a `--` separator, e.g. `eve scan fortify translate native <target> -- -my_fortify_option`. List available native parameters with `eve scan fortify parameters`.
- **Session workflow:** open a session with `--fortify 1`, then `start` → `translate …` → `analyse`; the FPR report uploads to Security Center. Fortify results are visible only in Security Center — skip it in local mode and use Opengrep there.

### Container (RHACS / Falcon)

```bash
eve scan rhacs <image>          # default for all container workloads
eve scan falcon image <image>   # non-OpenShift alternative
```

### Dependency-Check (SCA)

```bash
eve scan dependency-check <project_path>
eve scan dependency-check <path> -- --disable<FailingAnalyzer>
```

### Black Duck

- When Black Duck needs a build artifact, **do not invent build commands.**
  Search the repo for existing build instructions (`Makefile`, `build.sh`,
  `build.gradle`, `pom.xml`, `package.json` scripts, `Dockerfile`, `Jenkinsfile`,
  `README`, CI config) and follow them to produce the artifact for `artifact-path`.
- `artifact-path` must be a file (tar, zip, jar, war…), never a folder.

### Debug mode

When a scan reports success but results don't appear in Security Center or Black
Duck, re-run with `--debug` to inspect the SESM request/response payloads (EVE
can report `Completed scans: 1/1` even when a backend upload silently failed).

```bash
eve scan session --blackduck 1 --limit 30 --debug | tee .eve/agentic/tmp/blackduck-debug.log
eve scan blackduck artifact.tar.gz --debug | tee -a .eve/agentic/tmp/blackduck-debug.log
rg -i "component|components|componentcount|bom" .eve/agentic/tmp/blackduck-debug.log
```

Report the component count if present; if absent, say so plainly rather than
inferring one from a report URL.

## 4. Security Gates

Define clear pass/fail criteria at each pipeline stage:

| Stage | Gate | Action on Failure |
|-------|------|-------------------|
| Commit | Secret detection (TP4) | Block commit (pre-commit hook) |
| PR | SAST (Opengrep/Fortify, TP7) | Block merge on Critical/High |
| Build | Non-container SCA (TP8) | Fail build on Critical with exploit |
| Build | Container image scan (TP8) | Block on Critical |
| Post-merge / weekly | Full Fortify + SCA | Alert and ticket on findings |

Automate exceptions as time-boxed waivers that require security-team approval and auto-expire.

## 5. Support & Documentation

> Full topic→Confluence page index: **`.kiro/knowledge/aidlc-devsecops-references/documentation-index.md`**.
> Full ServiceNow ticket table + Teams channels: **`.kiro/knowledge/aidlc-devsecops-references/support.md`**.

- **Support tickets:** ServiceNow → RnD Support (per-scanner categories: Black
  Duck, Dependency Check, Fortify, RHACS, Secret Scanner, Security Center,
  Threat Model, etc.).
- **Teams channels:** *SDL Support (excluding scanners)*, *DevOps Platform /
  Continuous Security* (scanner support), *Software Security Community*.
- End security guidance to the user with links to the authoritative Confluence
  SDL pages matching their topic (Secrets Scanner, Vulnerability Management,
  scanner-specific pages).

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error or vulnerabilities found |
