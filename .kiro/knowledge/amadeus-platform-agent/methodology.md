# Amadeus platform targeting methodology

How to do platform work well on the Amadeus path: leading `infrastructure-design`
and `environment-provisioning`, and supporting `feasibility`, `nfr-design`,
`contract-design`, `domain-design`, and `feedback-optimization`.

## The question this work answers

A generic cloud design answers "what is a sound cloud-native design?". You answer
that **and** the question that decides whether it ships: **"can Amadeus host,
operate, and audit this, and on which platform?"**

You own both halves. Service selection and well-architected reasoning are yours,
and so is the translation into something Amadeus can actually run, including
saying no when a technically sound design is not a deployable one. Where an
upstream artifact (architecture, NFRs, contracts) already proposes a design,
reconcile it rather than redoing it.

## Work component by component

Build an explicit reconciliation table and keep it complete:

| Component | Core design assumption | Amadeus target | Capability used / declined | Verdict |

Every component in `infrastructure-specification` appears exactly once. A component
with no Amadeus target is a **blocking gap**, not an omission to smooth over. It is
better to end the stage with a named blocker than a comfortable narrative.

## Order the constraints by how hard they are

Resolve in this order, because later choices cannot relax earlier ones:

1. **Data classes** — what data does the component touch?
2. **Residency** — where may that data be processed and stored? Regulatory, not
   negotiable.
3. **Target and cluster** — which OpenShift cluster/project, in which target
   (`PRD-NE`, `PRD-WE`), given the above?
4. **Platform capability** — what does the PaaS catalogue
   (<https://platforms.acs.global.amadeus.net/>) offer for this component?
5. **Security zone** — what zone does it sit in, and what is the matrix verdict for
   every connection it needs?
6. **Reachability** — does **AUD** confirm each of those paths today?
7. **Access** — is every operational path routed via the jump server?
8. **Cost and tagging** — how is it attributed and charged back?

Starting at step 4 and working backwards is the common failure. It produces a design
that has to be unwound when residency or a BLOCKED zone pair is applied.

Steps 5 and 6 are distinct and both required. The matrix says whether a connection is
*permitted*; AUD says whether it is *reachable*. A design can pass one and fail the
other, and each failure has a different remedy.

## Deviations are first-class output

The deviation register is not a list of failures. It is the artifact that lets a
human decide, and it is the thing an auditor will ask for.

Every entry carries: the component, the core design assumption, the Amadeus
constraint, the resolution, an owner, and a review-by date. An entry without an
owner is not a deviation, it is a complaint.

An empty register is a valid outcome. An absent one is not.

## Readiness verdicts must be honest

At provisioning, a per-environment verdict of **blocked with named blockers** is a
successful stage outcome. An unqualified "ready" that hides an unresolved
registration gap is a failure, even though it reads better.

Drift between what was approved in targeting and what was actually provisioned is
always recorded, never silently reconciled.

## Where the facts live

This file is methodology — how to think. The concrete Amadeus facts live beside
it: `platform-catalogue.md` (OpenShift, PaaS offerings, environments, tagging,
residency, service management) and `security-zones.md` (AUD, the zone matrix,
production access).

Keep them separate. Methodology changes rarely; the catalogue changes whenever the
platform does.
