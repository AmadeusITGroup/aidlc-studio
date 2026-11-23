# Cost & Resource Optimization

Platform-neutral cost discipline. Adapt the levers to the confirmed platform.

## Estimate per environment

Produce a cost estimate for each environment tier (dev/staging/prod). No design
ships without one.

## Optimization levers (map to the platform)

- **Right-sizing** — match capacity to observed/expected load.
- **Committed capacity** — reserved/committed/savings plans for steady workloads.
- **Elastic capacity** — spot/preemptible/burstable for tolerant workloads.
- **Autoscaling** — scale to demand; scale to zero where supported.
- **Storage tiering** — move cold data to cheaper tiers.
- **Managed vs self-hosted** — weigh operational cost, not just sticker price.

## Accountability

- Apply cost-allocation tags/labels per workload and environment.
- Configure budget alerts and anomaly detection.
- Track a per-transaction (or per-request) efficiency signal to catch regressions.

## Teardown

Automate teardown of ephemeral environments. Orphaned resources are the most
common hidden cost leak.
