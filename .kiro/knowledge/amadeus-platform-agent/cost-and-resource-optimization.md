# Cost & Resource Optimization

Cost discipline for the Amadeus platform. The levers are platform-neutral; apply
them to OpenShift and the PaaS catalogue, and express the numbers in the
**chargeback model the owning unit is actually billed under** — not raw cloud
list price.

## Estimate per environment

Produce a cost estimate for each environment tier (dev/staging/prod). No
targeting or provisioning design ships without one. State the estimate in the
owning unit's chargeback terms and attribute it to the cost centre from
`platform-catalogue.md`.

## Optimization levers (map to the platform)

- **Right-sizing** — set OpenShift requests/limits to observed/expected load;
  do not over-request headroom "just in case."
- **Committed vs elastic capacity** — use committed/reserved platform capacity
  for steady workloads; burstable/preemptible where the PaaS offering supports
  it and the workload tolerates it.
- **Autoscaling** — scale to demand (HPA/where supported); scale to zero for
  idle non-prod where the platform allows.
- **Storage tiering** — move cold data to cheaper tiers offered by the catalogue.
- **Managed (PaaS) vs self-managed** — weigh operational cost, not sticker price.
  Per the "platform before primitive" principle, a self-managed component must
  justify the PaaS offering it declined, cost included.

## Accountability

- Apply the mandated Amadeus **cost-allocation tagging/labelling taxonomy** per
  workload and environment so the workload is attributable from day one
  (see `platform-catalogue.md`).
- Configure budget alerts / anomaly detection where the platform exposes them.
- Track a per-transaction (or per-request) efficiency signal to catch
  regressions between analyses.

## Teardown

Automate teardown of ephemeral (preview/test) environments. Orphaned resources
are the most common hidden cost leak — and, on a chargeback model, they bill a
real owner. Align teardown with the environment lifecycle in
`environment-strategy.md`.
