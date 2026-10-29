# Platform Selection Guide

Platform-neutral guidance for choosing a deployment platform. The Platform Agent
uses this to frame questions to the user, never to pre-decide a vendor.

## Resolve defaults first

Before asking anything, read `aidlc/spaces/<active-space>/memory/{org,team,project}.md`
(especially `## Deployment` / `## Way of Working`). Only elicit what is unspecified.

## Hosting model decision axes

| Axis | Options | Ask when unspecified |
|------|---------|----------------------|
| Provider | AWS / Azure / GCP / other cloud / on-prem / hybrid / managed PaaS | Always, if memory is silent |
| Compute | Containers / serverless / VMs / managed PaaS | Always |
| Orchestration | Kubernetes / ECS / Nomad / none | When containers chosen |
| Data | Managed vs self-hosted; engine choice | Always |
| Networking | Public / private; ingress, DNS, TLS | Always for user-facing |
| IaC tool | Terraform / Pulumi / CDK / CloudFormation / Bicep / Helm / Ansible / none | Always |
| CI/CD | Existing system or none | Always |

## Selection heuristics

- Prefer the team's existing platform and tooling unless a requirement forces otherwise.
- Match the compute model to the workload shape (bursty → serverless; steady → containers/VMs).
- Choose managed services over self-hosted when the team lacks operational capacity.
- Keep the IaC tool consistent with what the team already operates.

Content is intentionally vendor-neutral; vendor-specific detail belongs in team
knowledge under `aidlc/spaces/<active-space>/knowledge/aidlc-platform-agent/`.
