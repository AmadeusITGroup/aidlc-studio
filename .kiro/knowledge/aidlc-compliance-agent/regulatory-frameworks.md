# Regulatory Frameworks

Overview of major compliance frameworks, their requirements, and practical implementation guidance for cloud-native applications. Guidance is written vendor-neutrally — map each control to the equivalent capability in your chosen platform (any public cloud, private cloud, or on-prem).

## PCI-DSS (Payment Card Industry Data Security Standard)

**Applies to**: Any system that stores, processes, or transmits cardholder data.

**Key Requirements** (organized by the 12 requirements):
1. **Network security**: Use network segmentation (firewalls, security groups, network ACLs) to isolate the cardholder data environment (CDE). No public internet access to CDE resources.
2. **Default credentials**: Change all vendor-supplied defaults. Automate with hardened base images and container images.
3. **Protect stored data**: Encrypt cardholder data at rest (AES-256) via a managed key service or equivalent. Implement data retention and disposal policies.
4. **Encrypt transmission**: TLS 1.2+ for all data in transit. Enforce HTTPS at the load balancer / API gateway.
5. **Anti-malware**: Run vulnerability scanning and threat detection on workloads and images.
6. **Secure systems**: Automated patch management. IaC security scanning in CI.
7. **Access control**: Least-privilege identity-and-access policies. No shared credentials. Role-based access.
8. **Authentication**: MFA for all administrative access. Use a centralized identity provider for user management.
9. **Physical security**: For cloud infrastructure this is inherited from the provider — document the shared responsibility model. For on-prem, document facility controls.
10. **Logging and monitoring**: Capture control-plane/API activity and application logs in a centralized log store. Retain for 1 year minimum.
11. **Testing**: Quarterly vulnerability scans. Annual penetration testing. IaC scanning in CI.
12. **Security policy**: Document and maintain an information security policy. Review annually.

**Scope reduction**: Use tokenization (via a PCI-compliant payment processor like Stripe) to minimize the CDE footprint. If you never touch raw card numbers, most PCI requirements do not apply.

## HIPAA (Health Insurance Portability and Accountability Act)

**Applies to**: Organizations handling Protected Health Information (PHI) in the US healthcare context.

**Key Requirements**:
- **BAA (Business Associate Agreement)**: Required with any cloud provider or third-party processor before storing PHI. Confirm the provider offers a BAA and which of its services the BAA covers.
- **Eligible services only**: Not every managed service is covered by a provider's BAA. Verify each service against the provider's HIPAA-eligibility documentation before placing PHI on it.
- **Encryption**: PHI must be encrypted at rest (managed key service or equivalent) and in transit (TLS). This satisfies the Safe Harbor provision.
- **Access controls**: Role-based access to PHI. Audit all access via centralized activity logging.
- **Audit trail**: Log all access to, creation of, and modification of PHI. Retain logs for 6 years.
- **Minimum necessary**: Only access and expose the minimum PHI required for the specific purpose.
- **Breach notification**: Notify affected individuals within 60 days of discovering a breach. Report to HHS.

**Architecture considerations**: Isolate PHI in dedicated accounts/projects or private network segments. Use private connectivity (private endpoints / peering) to avoid PHI traversing the public internet. Tag or label all resources containing PHI for governance.

## SOC 2 (Service Organization Control 2)

**Applies to**: Service providers that store or process customer data. Increasingly expected by enterprise customers.

**Type I vs Type II**:
- **Type I**: Point-in-time assessment. "Controls are properly designed as of a specific date." Faster to achieve.
- **Type II**: Assessment over a period (usually 6-12 months). "Controls operated effectively during the review period." More rigorous and more valued.

**Trust Service Criteria**:
1. **Security** (required): Protection against unauthorized access. Covers firewalls, access controls, encryption, monitoring.
2. **Availability**: System is operational and accessible per SLA commitments.
3. **Processing Integrity**: System processing is complete, valid, accurate, and timely.
4. **Confidentiality**: Information designated as confidential is protected.
5. **Privacy**: Personal information is collected, used, retained, and disposed of per the privacy notice.

**Practical implementation**: Use a configuration-compliance engine to continuously evaluate resources against control baselines. Automate evidence collection. Aggregate findings from scanners and posture-management tools into a central dashboard.

## GDPR (General Data Protection Regulation)

**Applies to**: Any organization processing personal data of EU/EEA residents, regardless of where the organization is located.

**Core Principles**:
- **Lawfulness**: Process data only with a legal basis (consent, contract, legitimate interest, legal obligation).
- **Purpose limitation**: Collect data only for specified, explicit purposes.
- **Data minimization**: Process only the data necessary for the stated purpose.
- **Accuracy**: Keep personal data accurate and up to date.
- **Storage limitation**: Retain data only as long as necessary. Define and enforce retention policies.
- **Integrity and confidentiality**: Protect data with appropriate security measures.

**Data Subject Rights**:
- Right of access (provide a copy of their data)
- Right to rectification (correct inaccurate data)
- Right to erasure ("right to be forgotten")
- Right to data portability (export in machine-readable format)
- Right to object to processing

**Technical implementation**: Build data subject access request (DSAR) automation. Implement soft-delete with configurable retention. Use datastore TTL or object-storage lifecycle policies for automatic data expiry. Tag or label PII data stores for governance.

## Data Residency and Sovereignty

- **Data residency**: Data must be stored within a specific geographic region. Choose provider regions / data-center locations accordingly (e.g. an EU region for EU data, an Australian region for Australian data).
- **Data sovereignty**: Data is subject to the laws of the country where it is stored.
- Use organization-level guardrails (policy-as-code, service control policies, or their equivalent) to restrict resource creation to approved regions.
- Configure storage and datastore location constraints to enforce residency.
- Cross-region replication must respect residency requirements; do not replicate to unapproved regions.
- Document data flows across regions for compliance audits.

## Privacy Impact Assessment (PIA)

Conduct a PIA when introducing a new system or significantly changing data processing:

1. **Describe the processing**: What data, from whom, for what purpose, how long retained.
2. **Assess necessity**: Is the processing proportionate to the goal? Could the same outcome be achieved with less data?
3. **Identify risks**: Unauthorized access, accidental disclosure, data loss, function creep.
4. **Define mitigations**: Encryption, access controls, anonymization, pseudonymization, retention limits.
5. **Document and review**: Record the assessment. Review when processing changes or annually.

## Compliance-as-Code Patterns

Automate compliance verification rather than relying on manual audits:

- **Policy-as-code rules**: Continuously evaluate resource configurations against compliance requirements (e.g. encrypted volumes, restricted remote access, MFA enforced). Use your platform's config-compliance engine or a portable tool (Open Policy Agent / Conftest, Checkov, tfsec).
- **Prebuilt control packs**: Many engines ship rule sets mapped to PCI-DSS, HIPAA, and SOC 2 — deploy them via IaC.
- **Posture aggregation**: Aggregate findings from scanners, threat detection, and third-party tools into a central view scored against compliance frameworks.
- **IaC synthesis-time checks**: Enforce compliance rules at synthesis/plan time (e.g. Checkov, tfsec, cdk-nag, or a Conftest policy in CI).
- **Custom rules**: Write organization-specific rules for requirements the prebuilt packs do not cover.

## Audit Trail Requirements

Across all frameworks, a robust audit trail is a common requirement:

- **Control-plane activity log**: Enable across all regions/accounts. Send to a centralized, immutable, append-only log store (write-once / object-lock or equivalent).
- **Application-level audit logs**: Log who did what, when, to which resource. Include the authentication context (user ID, role, IP).
- **Integrity protection**: Use log-file integrity validation and immutable (write-once) storage.
- **Retention**: PCI-DSS: 1 year. HIPAA: 6 years. SOC2: per policy (typically 1-3 years). GDPR: as long as necessary for the purpose.
- **Access to logs**: Restrict log access to security and compliance roles. Log access to logs (meta-auditing) for sensitive environments.
