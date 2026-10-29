# Observability Patterns

Building visibility into system behaviour through metrics, logs, and traces to enable fast diagnosis and proactive detection.

> **Amadeus tooling (roles).** Dashboards and reporting: **Power BI**, **Reef BI**.
> Log aggregation and search: **Splunk**. Feedback / usage signal: **QuickPulse**.
> Alert notification and ticketing: **Microsoft Teams**, **ServiceNow**. Metrics
> and distributed tracing backends are captured in team knowledge
> (`aidlc/knowledge/aidlc-operations-agent/`) where a team has standardised on
> one. This guide is the methodology; the tool names mark where each capability
> lands.

## The Three Pillars of Observability

### 1. Metrics
Numeric measurements aggregated over time. Low cardinality, low cost, ideal for alerting and dashboards.
- **Types**: Counters (always increase), Gauges (can go up/down), Histograms (distribution of values).
- Emit metrics to the team's metrics backend and surface them in dashboards (Power BI, Reef BI).
- Emit custom business metrics: orders placed per minute, payment failures per hour, sign-ups per day.

### 2. Logs
Timestamped records of discrete events. High cardinality, high volume.
- Use structured logging (JSON) with consistent fields: `timestamp`, `level`, `requestId`, `service`, `message`.
- Correlate logs across services using a shared `requestId` or `traceId` propagated through headers.
- Aggregate logs to the central log platform (**Splunk**), with a dedicated index/source per service and environment.

### 3. Traces
End-to-end path of a request through multiple services. Shows latency breakdown and dependency relationships.
- Use distributed tracing (e.g. OpenTelemetry) with context propagated via W3C Trace Context headers.
- Instrument custom spans for business logic, database queries, and external HTTP calls.
- Use trace maps to visualize service dependencies and identify latency bottlenecks.

## The Four Golden Signals (Google SRE)

Monitor these four signals for every service:

1. **Latency**: Time to serve a request. Measure as percentiles (p50, p95, p99). Track separately for successful and failed requests.
2. **Traffic**: Demand on the system. Requests per second for APIs, messages per second for queues, active connections for WebSocket.
3. **Errors**: Rate of failed requests. Include both explicit errors (5xx) and implicit errors (wrong responses, timeouts, retries).
4. **Saturation**: How full the system is. CPU utilization, memory usage, disk I/O, connection pool usage, worker/replica concurrency vs configured limits.

## Dashboards and Alarms

### Dashboard Design
- One dashboard per service with golden signals at the top (built in Power BI / Reef BI).
- Include dependency health: downstream service latency, database connections, queue depth.
- Compute derived metrics such as error rate = errors / (errors + successes) * 100.
- Standardize dashboard layouts across services for consistency.

### Alarm Configuration
- Alarm on symptoms, not causes. Alert on "error rate > 1%" not "CPU > 80%".
- Use composite conditions to reduce noise: only alert when multiple conditions are true simultaneously.
- Set appropriate evaluation periods: avoid single-datapoint alarms that fire on transient spikes. Use `3 out of 5 datapoints` for stability.
- Define alarm actions: notification (Microsoft Teams), incident ticket creation (ServiceNow), automated remediation.
- Severity tiers: P1 (page on-call), P2 (Teams alert, fix within hours), P3 (ticket, fix within sprint).

## Distributed Tracing

- Enable tracing at service ingress and on outbound calls (API gateways, services, queues).
- Use a tracing SDK (e.g. OpenTelemetry) to create custom spans for application logic.
- Add indexed, searchable attributes for key dimensions: `customerId`, `orderStatus`, `region`.
- Add non-indexed metadata for debugging detail: request/response bodies, query parameters.
- Use trace search and filter expressions to find traces matching specific criteria (e.g. `service = "payment-service" AND duration > 3s`).

## Log Query Patterns

Useful query patterns for operational troubleshooting (express these in the log
platform's query language, e.g. Splunk SPL):

- **Error rate over time** — filter to error-level messages, count per 5-minute bucket.
- **Slowest requests** — filter to requests over a duration threshold, sort descending, limit to the top 20.
- **Request count by status code** — parse the status code field and count grouped by status.
- **Latency distribution** — aggregate p50/p95/p99 of request duration over rolling windows.

## Anomaly Detection

- Use ML-based anomaly detection to establish a baseline and alert on deviations.
- Enable it on latency and error-rate metrics that have stable patterns.
- Set the detection band width based on acceptable variance (2 standard deviations is a common starting point).
- Combine anomaly detection with static thresholds: anomaly detection catches gradual drift, static thresholds catch acute failures.

## Log Aggregation and Retention

- Route all logs to the central log platform (Splunk) with consistent naming per service and environment.
- Set retention policies per source: 30 days for development, 90 days for staging, 1-3 years for production (or per compliance requirements).
- Archive to long-term / cold storage for logs beyond the hot-retention window to control cost.
- For multi-tenant or multi-team setups, segregate indexes and apply role-based access to log data.

## Synthetic Monitoring

- Run scripted checks on a schedule (every 1-5 minutes) against critical user journeys: login, place order, view dashboard.
- Run synthetic checks from infrastructure independent of the workload, so issues are detected before real users report them.
- Alert on synthetic-check failure with P1 severity; it means the user-facing path is broken.
- Use visual monitoring (screenshot comparison) for UI-heavy applications.
