# Amadeus platform catalogue

The concrete inventory the Amadeus Platform Agent reasons over. Keep this current —
it changes whenever the platform does, and it is deliberately separate from
`methodology.md` so updating a fact needs no change to how the agent thinks.

Network connectivity and security zones are in
[`security-zones.md`](security-zones.md). Agents read knowledge files literally and
in full, so keep entries factual and terse.

## Deployment runs on OpenShift

**Amadeus deployment is based on OpenShift.** That is the default runtime target, and
it shapes design more than any cloud-service choice:

- Workloads are **containerised**. A design that assumes a VM, a bare-metal host, or
  a cloud-managed compute service is almost certainly wrong for Amadeus.
- Deployment units are OpenShift objects — Deployment / StatefulSet, Service, Route,
  ConfigMap, Secret — not raw cloud infrastructure primitives.
- Scaling is expressed through OpenShift constructs (replica counts, HPA, resource
  requests and limits), bounded by the project's quota, not by raw cloud service
  limits.
- Ingress is an OpenShift Route, and its security zone follows the cluster's zone.
  See `security-zones.md` before designing any inbound or outbound path.
- Statefulness, persistent volumes, and storage classes are cluster capabilities
  with their own constraints. Confirm what the target cluster offers before assuming
  a storage model.

When a design (yours or an upstream artifact) calls for a cloud-native service, the question here
is not "is that a good AWS design" but **"what is the OpenShift equivalent on the
Amadeus platform, and does it exist?"**

## The PaaS catalogue

**All available PaaS offerings are listed at
<https://platforms.acs.global.amadeus.net/>.** Consult it before designing any
supporting capability — database, cache, message broker, object store, search,
observability.

This is the practical form of *platform before primitive*: if the portal offers the
capability, target it. Self-managing an equivalent inside your own OpenShift project
means taking on patching, backup, DR, compliance evidence, and on-call for it. That
is sometimes the right call, but it is a decision to state and justify against the
PaaS offering it declined — never a default reached by not checking the catalogue.

When the catalogue has no offering for a needed capability, that is a platform
request, not a licence to build it locally without saying so.

| Capability needed | PaaS offering | Self-managed alternative | Decision + rationale |
| --- | --- | --- | --- |
| _TODO(amadeus): fill from the portal for your common patterns_ | | | |

## Production access goes through the jump server

Developer machines do **not** connect to production directly. See
`security-zones.md` for the full rule and its design consequences.

## Environments and targets

Production targets are referred to as `PRD-NE` and `PRD-WE`. The Security Zone
Matrix governs connections **within** a target, not across them.

| Environment | Target | Cluster / project | Access route | Notes |
| --- | --- | --- | --- | --- |
| _TODO(amadeus)_ | | | | |

## Identity integration

- Workload identity pattern: _TODO(amadeus)_
- Human access pattern: _TODO(amadeus)_
- Secret store (OpenShift Secrets, external vault, or both): _TODO(amadeus)_
- Explicitly forbidden: local identity stores, parallel secret stores, production
  credentials on developer machines

## Tagging, labelling, and chargeback

OpenShift labels and annotations carry ownership and cost attribution here, rather
than cloud resource tags.

| Label / annotation | Required | Allowed values | Drives |
| --- | --- | --- | --- |
| _TODO(amadeus)_ | | | |

Chargeback model: _TODO(amadeus) — how the owning unit is billed for cluster and PaaS
consumption, so cost can be expressed in the number someone is accountable for._

## Data residency by data class

The residency table. Resolve this **before** platform or cluster selection, because
it constrains both.

| Data class | Examples | Permitted targets / regions | Basis (regulation / contract) |
| --- | --- | --- | --- |
| _TODO(amadeus)_ | | | |

Note that `cde` zone involvement generally signals cardholder-data scope; route the
specifics to the Compliance and DevSecOps agents.

## Service management

- CMDB / ITSM system: _TODO(amadeus)_
- Fields required to register a service: _TODO(amadeus)_
- Change classes and what each requires: _TODO(amadeus)_
- Freeze windows: _TODO(amadeus)_
- Observability tooling to target: _TODO(amadeus)_

## Requesting a missing capability

When a design needs a platform capability or network path that does not exist yet, it
is routed as a request rather than solved locally.

- PaaS / platform capability intake: _TODO(amadeus)_ (start from
  <https://platforms.acs.global.amadeus.net/>)
- Network / firewall path intake: _TODO(amadeus)_ (confirm current state in AUD first)
- Typical lead times: _TODO(amadeus)_
- Acceptable interim pattern while waiting: _TODO(amadeus)_
