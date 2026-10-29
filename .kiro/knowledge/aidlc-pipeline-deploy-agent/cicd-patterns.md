# CI/CD Pipeline Patterns

Patterns for building reliable continuous integration and continuous delivery pipelines.

> **Amadeus CI/CD toolchain (roles).** CI engines: **Jenkins Pipeline ToolBox**
> and **GitHub Actions**. Reusable pipeline definitions: **CI Workflows**.
> Build & packaging: **Packaging Service** (container images built with
> **Podman**). In-pipeline security scanning: the **EVE Security Scanner**
> (Black Duck, Dependency-Check, RHACS — see the devsecops agent's SDL).
> Continuous delivery to **OpenShift**:
> **Argo Workflows** and **Argo CD**. Any additional or team-specific tools are
> recorded in team knowledge (`aidlc/knowledge/aidlc-pipeline-deploy-agent/`).

## CI Pipeline Stages

A well-structured CI pipeline runs these stages in order:

1. **Lint** — Code formatting and style checks (ESLint, Prettier, Ruff, Black). Catch trivial issues before deeper analysis. Fast (< 30 seconds).
2. **Build** — Compile, transpile, or bundle the application. Verify the code produces valid artifacts. For containers, build the image with **Podman** (via the Packaging Service).
3. **Unit Test** — Run fast, isolated tests. Target: < 3 minutes. Fail the pipeline on any test failure.
4. **Static Analysis / Security Scan** — SAST, IaC scanning, dependency audit. Report findings; gate on severity thresholds.
5. **Integration Test** — Test against real dependencies (databases, queues) using testcontainers or ephemeral test environments. Target: < 10 minutes.
6. **Package** — Build and package deployable artifacts (container images, via the Packaging Service / Podman). Tag with commit SHA and semantic version.

## CD Pipeline Patterns

### Continuous Delivery
Every commit that passes CI is deployable, but a human triggers the production deployment. Use manual approval gates in your CD system (Argo CD promotion gates, GitHub Actions environments, or Jenkins input steps).

### Continuous Deployment
Every commit that passes CI and staging validation deploys to production automatically. Requires high confidence in test coverage and automated rollback.

**Recommendation**: Start with continuous delivery. Graduate to continuous deployment as test maturity and observability improve.

## Branch Strategies

> See `branching-strategies.md` in this directory for the deeper menu aidlc-pipeline-deploy-agent surveys at Bolt-merge dispatch — including diagrams, common problems, AIDLC worktree mapping per strategy, and parallel-Bolts notes for each. The summaries below cover the CI-flow context.

### Trunk-Based Development (Preferred)
- All developers commit to `main` (or short-lived feature branches merged within 1-2 days).
- Feature flags gate incomplete work. No long-lived branches.
- CI runs on every push to main. CD deploys from main.
- Benefits: Fewer merge conflicts, faster feedback, simpler pipeline.

### GitFlow
- `main` (production), `develop` (integration), `feature/*`, `release/*`, `hotfix/*`.
- Suitable for teams with infrequent releases or strict release management.
- Drawback: Long-lived branches cause painful merges and delayed integration.

### GitHub Flow
- `main` + short-lived feature branches. PRs merge to main.
- Simpler than GitFlow but still relies on branching. Good middle ground.

## Quality Gates

Define explicit pass/fail criteria that block pipeline progression:

| Gate | Criteria | Stage |
|------|----------|-------|
| Lint | Zero lint errors | Pre-build |
| Test coverage | >= 80% line coverage, no decrease | Post-test |
| Security scan | Zero Critical/High findings | Post-scan |
| Integration tests | 100% pass rate | Post-integration |
| Manual approval | Tech lead or product owner sign-off | Pre-production |
| Smoke tests | Critical path tests pass in production | Post-deploy |

## Artifact Management

- **Image registry**: Store container images with immutable tags (commit SHA), never `latest`.
- **Package registry**: Host npm, pip, Maven packages; proxy upstream registries for caching and security.
- **Artifact / object storage**: Store build outputs and deployment bundles.
- Tag every artifact with: commit SHA, build number, branch, timestamp.
- Set lifecycle policies: keep the last 30 tagged images; expire untagged images after 7 days.

The concrete image and package registries are recorded in team knowledge.

## Pipeline as Code

- Define pipelines in version-controlled files, not UI configurations.
- **GitHub Actions**: `.github/workflows/*.yml`. Matrix builds for multi-version testing.
- **Jenkins Pipeline ToolBox**: version-controlled `Jenkinsfile` pipelines, with shared **CI Workflows** as reusable libraries.
- **Reusable workflows / CI Workflows**: Extract common steps (lint, test, package, scan) into shared templates. Avoid copy-paste across repos.

## Monorepo vs Polyrepo CI Strategies

### Monorepo
- Use path-based triggers: only build/test services whose files changed.
- Tools: Nx, Turborepo, Pants. These understand dependency graphs and skip unchanged packages.
- Shared CI steps (lint, security scan) run once; service-specific steps run conditionally.

### Polyrepo
- Each repo has its own pipeline. Simpler per-repo but harder to coordinate cross-service changes.
- Use contract testing (Pact) to verify compatibility across repos without a monolithic integration test.
- Automate dependency updates across repos with Renovate or a custom bot.

## Pipeline Performance

- Target: commit to production in under 30 minutes (excluding manual approval).
- Parallelize independent stages (lint + unit test, SAST + dependency scan).
- Cache dependencies aggressively (npm cache, pip cache, Docker layer caching).
- Use elastic or dedicated build workers to balance feedback speed and cost.
- Monitor pipeline duration as a team metric; alert when it exceeds thresholds.
