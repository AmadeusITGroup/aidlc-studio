# Infrastructure-as-Code Patterns

Tool-agnostic IaC guidance. Apply with whichever tool the team confirmed
(Terraform, Pulumi, CDK, CloudFormation, Bicep, Helm, Ansible, …).

## Universal principles

- **Everything as code.** No manual console/portal changes; those are drift.
- **Modular composition.** Factor reusable modules/constructs for repeated patterns.
- **Independent deployability.** Organize stacks/modules so units deploy on their own; avoid circular cross-stack references.
- **Explicit parameters.** Pass configuration in; do not hardcode environment values.
- **Validated changes.** Run the tool's plan/diff and any linters/policy checks before apply.

## Stack organization

Separate by lifecycle and blast radius, e.g. network, compute, data. Keep
cross-stack references one-directional and named.

## Testing & validation

- Static: format, lint, policy-as-code (where the tool supports it).
- Plan review: require a human-readable diff before apply.
- Post-apply: smoke checks that resources are healthy.

## Secrets & configuration

Use the platform's chosen secrets/parameter store. Never commit secrets to IaC
source. Reference secrets by name, injected at deploy time.
