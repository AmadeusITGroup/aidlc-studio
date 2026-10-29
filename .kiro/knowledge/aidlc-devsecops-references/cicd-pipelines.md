# CI/CD Pipeline Examples (on-demand reference)

> **On-demand reference for the devsecops agent.** Consult this for EVE CLI
> pipeline scripts on non-GitHub-Actions CI systems (or local automation). For
> GitHub Actions with `amadeus-appsec/eve-action`, see `eve-github-action.md`.
> For setup/update/troubleshooting of `.github/workflows/security-scans.yml`,
> see `security-scan-setup.md`.

## GitHub Actions — Branch Discovery & Scheduling

Before setting up GitHub Action workflows, discover available remote branches:

```bash
git branch -r | sed 's|origin/||' | grep -v HEAD
```

**Recommended workflow split:**
- **PR/push workflow** (`sdl-pr-scans.yml`) — fast scanners (e.g., Dependency-Check) on every merge. Use `ssc-version: ${{ github.ref_name }}` for dynamic branch tracking.
- **Weekly workflow** (`sdl-weekly-scans.yml`) — all scanners (Dependency-Check, Fortify, Falcon/RHACS, Blackduck) on a cron schedule. Use a fixed `ssc-version` (the default branch name).

Fortify SAST scan time depends on code complexity (minutes to hours) — consider running it only in the weekly workflow. Secrets scanning is excluded — Amadeus provides it as a default configuration.

See `eve-github-action.md` for complete workflow examples and scanner configuration.

For full setup/update/troubleshooting flow of `.github/workflows/security-scans.yml`, see `security-scan-setup.md`.

---

## EVE CLI Pipeline Scripts

The examples below use EVE CLI directly (for non-GitHub-Actions CI systems or local automation).

## Python Project

```bash
#!/bin/bash
# Assumes .eve/config.toml exists with nano-uuid, ssc-application, ssc-version

eve scan session --secrets 1 --falcon 1 --fortify 1 --limit 30

eve scan secrets run . --mode changes
eve scan falcon image "$DOCKER_IMAGE"

eve scan fortify start
eve scan fortify translate python ./src --path .venv/lib/python3.11/site-packages --version 3 -- -exclude "**/.venv/**" -exclude "**/venv/**" -exclude "**/__pycache__/**"
eve scan fortify analyse
```

## Go Project (Single Module)

```bash
#!/bin/bash
eve scan session --secrets 1 --dependency-check 1 --fortify 1 --limit 30

eve scan secrets run .
eve scan dependency-check .

eve scan fortify start
eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."
eve scan fortify analyse
```

## Go Monorepo (Multiple Modules)

```bash
#!/bin/bash
eve scan session --secrets 1 --dependency-check 1 --fortify 1 --limit 30

eve scan secrets run .
eve scan dependency-check .

eve scan fortify start

# Translate all Go modules
for dir in module1 module2 module3; do
  cd "$dir"
  eve scan fortify translate wrapper -- "sourceanalyzer" "-b" "@BUILD_ID@" "."
  cd ..
done

eve scan fortify analyse
```
