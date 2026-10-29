# Infrastructure-as-Code Patterns

Tool-agnostic IaC discipline for the Amadeus platform. Apply with whichever tool
the team confirmed (Helm, Terraform, Pulumi, Ansible, Kustomize, …) targeting
OpenShift and the PaaS catalogue.

## Universal principles

- **Everything as code.** No manual console/portal changes; those are drift.
- **Modular composition.** Factor reusable modules/charts/constructs for repeated
  patterns.
- **Independent deployability.** Organize stacks/modules so units deploy on their
  own; avoid circular cross-stack references.
- **Explicit parameters.** Pass configuration in; never hardcode
  environment/target values. This is what makes the environment **parity** in
  `environment-strategy.md` achievable.
- **Validated changes.** Run the tool's plan/diff and any linters/policy checks
  before apply.

## Stack organization

Separate by lifecycle and blast radius, e.g. network, compute (OpenShift
workloads), data. Keep cross-stack references one-directional and named.

## Testing & validation

- Static: format, lint, policy-as-code (where the tool supports it).
- Plan review: require a human-readable diff before apply.
- Post-apply: smoke checks that resources are healthy; feed the result into the
  environment validation report.

## Secrets & configuration

Use the Amadeus enterprise secrets/parameter store (see `environment-strategy.md`)
integrated with enterprise identity. Never commit secrets to IaC source;
reference them by name, injected at deploy time.
