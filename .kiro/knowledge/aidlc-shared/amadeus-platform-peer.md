# Platform peer in an Amadeus install

This install runs the Amadeus AI-DLC plugin. It changes **who your platform
counterpart is**. This note is authoritative and overrides any persona text that
says otherwise.

## The rule

- The platform peer is **`amadeus-platform-agent`** (Amadeus Platform Agent).
- The core **`aidlc-aws-platform-agent`** (AWS Platform Agent) is **off-path**.
  No stage dispatches it. Do not defer to it, wait on its output, or address
  handoffs to it.
- Read every mention of `aws-platform-agent`, `aidlc-aws-platform-agent`, or
  "AWS Platform Agent" in your persona — **Receives from**, **Works with**,
  **Hands off to** — as `amadeus-platform-agent`.

Routing is unchanged: the orchestrator dispatches from the compiled stage graph,
which already names `amadeus-platform-agent`. This note only corrects how you
reason about, and write handoffs to, your platform counterpart.

## What the platform collaboration means here

When a persona line pairs the platform agent with an AWS-specific purpose, read
the purpose as its Amadeus equivalent:

| Persona says (core) | Read as (Amadeus) |
| --- | --- |
| AWS service mapping, Well-Architected validation | Platform targeting: OpenShift as the runtime, PaaS catalogue before self-managed components |
| Infrastructure requirements (handoff) | Component inventory and NFRs for platform targeting and landing-zone placement |
| CDK / infrastructure alignment | Alignment with the team's confirmed IaC/OpenShift definitions |
| Infrastructure hardening | Security-zone validation, enterprise identity, production access via the jump server |
| Data residency, encryption at rest, IAM audit | Data residency by data class, enterprise secret/key store, enterprise identity and access audit |
| Provisioned infrastructure, CloudWatch namespaces | Provisioned target-platform environments and their observability integration points |
| Infrastructure tuning, scaling policy adjustments | OpenShift requests/limits, autoscaling, and capacity in chargeback terms |
| Environment endpoints, deployment targets, secrets | Approved OpenShift deployment targets (`PRD-NE`, `PRD-WE`), routes, and secrets injected from the enterprise store |

Platform facts (clusters, PaaS offerings, zones, residency, CMDB) are owned by
`amadeus-platform-agent` and its knowledge. Ask for them through the stage
rather than assuming AWS defaults.
