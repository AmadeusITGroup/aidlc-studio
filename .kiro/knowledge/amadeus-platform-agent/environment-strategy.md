# Environment Strategy

Guidance for defining and provisioning environments on the Amadeus platform.
Platform-neutral discipline, applied to OpenShift projects/clusters and aligned
with Amadeus change-management.

## Environment set

Confirm which environments are needed (typical: dev, staging, prod) and which
Amadeus target each lands in (`PRD-NE`, `PRD-WE`, per `platform-catalogue.md`).
Read `aidlc/spaces/<active-space>/memory/{org,team,project}.md` (`## Deployment`)
first; ask the user only what the memory layers leave unspecified.

## Parity

Environments must differ only in **scale**, never in **topology**. Any
environment-specific behavior is a deployment bug waiting to surface. Derive all
environments from the same IaC/OpenShift definitions with different parameters
(see `infrastructure-as-code-patterns.md`).

## Provisioning & lifecycle

- Provision from IaC/OpenShift objects; never hand-build an environment in a
  console. Access to any production environment is **via the jump server** only
  (see `security-zones.md`).
- Automate creation, refresh, and teardown; prefer ephemeral environments for
  preview/testing where the platform allows.
- Align environment changes with Amadeus **change-management**: know what needs a
  change record, what is pre-approved, and what freeze windows apply.

## Drift management

- Enable drift detection.
- Reconcile drift by updating IaC and re-applying — never by patching the live
  environment out of band. Record any targeting-vs-provisioned drift in the
  deviation register (`methodology.md`) rather than silently reconciling it.

## Secrets & configuration per environment

Keep secrets in the **Amadeus enterprise secret/parameter store**, scoped per
environment and integrated with enterprise identity — never a parallel local
store, never in source control. Inject at deploy time.

## Validation

After provisioning, run health checks and record an environment inventory and a
validation report so downstream stages have an explicit, verified baseline. A
per-environment readiness verdict of **blocked with named blockers** is a valid,
honest outcome (`methodology.md`); an unqualified "ready" that hides a
registration or reachability gap is not.
