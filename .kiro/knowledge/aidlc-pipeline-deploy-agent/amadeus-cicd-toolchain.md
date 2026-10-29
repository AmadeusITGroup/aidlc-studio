# Amadeus CI/CD Toolchain and Deployment Implementation

> **Precedence (Amadeus plugin).** This file ships with the Amadeus plugin beside
> core's `cicd-patterns.md` and `deployment-strategies.md`. Keep using those for
> the vendor-neutral patterns (pipeline stages, continuous delivery vs
> deployment, branch models, rollout strategies). Where they name **AWS**
> implementations (CodePipeline/CodeBuild, `buildspec.yml`, `cdk synth`, ECR,
> CodeArtifact, S3, CodeDeploy, Lambda aliases, ALB target groups, CloudWatch
> alarms, AppConfig/Evidently, LocalStack, spot instances), use the Amadeus
> equivalent below instead, unless AWS is genuinely the confirmed target
> platform for this project.

## Toolchain (roles)

| Role | Amadeus tool |
|------|--------------|
| CI engine | **Jenkins Pipeline ToolBox** or **GitHub Actions** |
| Reusable pipeline definitions | **CI Workflows** (shared libraries / reusable workflows) |
| Build and packaging | **Packaging Service** (container images built with **Podman**) |
| Continuous delivery | **Argo Workflows** / **Argo CD** (GitOps) |
| Runtime target | **OpenShift** |
| Production release decision | an explicit **Go/No-Go** gate before any production deployment |

Any additional or team-specific tools (concrete image and package registries,
feature-flag service, service mesh) are recorded in team knowledge
(`aidlc/knowledge/aidlc-pipeline-deploy-agent/`) or the active space's memory.
Do not invent registry hostnames or tool names that are not recorded there or
confirmed by the user.

## Responsibilities on the Amadeus toolchain

- Build CI on the team's engine (Jenkins Pipeline ToolBox or GitHub Actions)
  using shared CI Workflows and the Packaging Service (Podman images).
- Design CD pipelines on Argo Workflows / Argo CD that promote artifacts through
  environment tiers (dev, staging, production) and deploy to OpenShift.
- Execute deployments to OpenShift via Argo CD, gated by an explicit Go/No-Go
  decision recorded before production.

## Pipeline stage overrides

Read alongside the stage list in `cicd-patterns.md`:

- **Build**: compile, transpile, or bundle the application. For containers,
  build the image with **Podman** via the Packaging Service.
- **Integration Test**: test against real dependencies using testcontainers or
  ephemeral test environments.
- **Package**: build deployable artifacts (container images via the Packaging
  Service / Podman). Tag with commit SHA and semantic version.
- **Continuous delivery gate**: a human triggers production deployment through
  the CD system's approval mechanism (Argo CD promotion gates, GitHub Actions
  environments, or Jenkins input steps).

## Artifact management

- **Image registry**: store container images with immutable tags (commit SHA),
  never `latest`.
- **Package registry**: host npm, pip, Maven packages; proxy upstream
  registries for caching and security.
- **Artifact / object storage**: store build outputs and deployment bundles.

The concrete image and package registries are recorded in team knowledge.

## CI platform notes

- **GitHub Actions**: `.github/workflows/*.yml`. Matrix builds for
  multi-version testing.
- **Jenkins Pipeline ToolBox**: version-controlled `Jenkinsfile` pipelines,
  with shared **CI Workflows** as reusable libraries.
- **Reusable workflows / CI Workflows**: extract common steps (lint, test,
  package, scan) into shared templates. Avoid copy-paste across repos.
- **Build workers**: use elastic or dedicated build workers to balance feedback
  speed and cost.

## Deployment strategy implementation (OpenShift / Argo)

Read alongside the strategy descriptions in `deployment-strategies.md`:

- **Blue-green**: run two Deployments (blue, green) behind a Service/Route; cut
  the Route or Service selector from blue to green. Use Argo CD (with Argo
  Rollouts) to manage the promotion and keep blue as the instant rollback target.
- **Canary**: use Argo Rollouts canary steps to shift traffic in increments
  (e.g. 10% → 25% → 50% → 100%). Split traffic at the Route / ingress or
  service-mesh layer. Automated metric analysis (error rate, latency) triggers
  rollback on breach.
- **Rolling**: OpenShift `RollingUpdate` Deployment strategy; configure
  `maxSurge` and `maxUnavailable`. Readiness/liveness probes gate each batch
  before the next rolls.
- **A/B testing**: route by user segment at the Route / ingress or service-mesh
  layer, or via a feature-flag service with experiment analytics. Concrete
  tooling is recorded in team knowledge.
- **Feature flags**: use a feature-flag service that supports validation,
  gradual rollout, and automatic rollback (the concrete tool is recorded in team
  knowledge).
- **Automated rollback**: configure alerts on error rate, latency p99, and 5xx
  count. Argo Rollouts automated analysis rolls back when metrics breach
  thresholds during a canary/blue-green step. Revert to the previous known-good
  revision instantly (`oc rollout undo`, or an Argo CD rollback to the prior
  synced revision).
