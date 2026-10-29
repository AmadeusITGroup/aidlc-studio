# Environment Strategy

Platform-neutral guidance for defining and provisioning environments.

## Environment set

Confirm which environments are needed (typical: dev, staging, prod). Ask the
user when the memory layers do not specify.

## Parity

Environments must differ only in **scale**, never in **topology**. Any
environment-specific behavior is a deployment bug waiting to surface. Derive all
environments from the same IaC definitions with different parameters.

## Provisioning & lifecycle

- Provision from IaC; never hand-build an environment.
- Automate creation, refresh, and teardown.
- Prefer ephemeral environments for preview/testing where the platform allows.

## Drift management

- Enable drift detection.
- Reconcile drift by updating IaC and re-applying — never by patching the live
  environment out of band.

## Secrets & configuration per environment

Keep secrets in the platform's secrets/parameter store, scoped per environment.
Inject at deploy time; keep them out of source control.

## Validation

After provisioning, run health checks and record an environment inventory and a
validation report so downstream stages have an explicit, verified baseline.
