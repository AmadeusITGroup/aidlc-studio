---
inclusion: auto
---

# Amadeus AIDLC — Engineering Standards

## Purpose

These standards are enforced during Construction phases of the AIDLC workflow. They represent Amadeus engineering conventions and are applied automatically. Teams can override specific sections via project-level `.aidlc-config.md`.

---

## Coding Standards

### General Principles
- Write self-documenting code; comments explain "why", not "what"
- Prefer composition over inheritance
- Follow the Single Responsibility Principle at all levels (function, class, module)
- Keep functions short (target: under 30 lines, max 50)
- Limit cyclomatic complexity (target: under 10 per function)
- No dead code — remove unused imports, functions, and variables

### Naming Conventions
- **Variables/Functions**: camelCase (JS/TS), snake_case (Python), per-language convention
- **Classes/Types**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Files**: kebab-case for source files, PascalCase for component files (React/Vue)
- **Directories**: kebab-case
- Names must be descriptive — no single-letter variables outside loop indices

### Error Handling
- Never swallow exceptions silently
- Use typed/custom errors for domain-specific failures
- Always include context in error messages (what failed, why, what to do)
- Prefer early returns / guard clauses over deep nesting
- Handle all promise rejections explicitly

---

## API Design Standards

### REST Conventions
- Use plural nouns for resource endpoints (`/users`, not `/user`)
- Use HTTP methods correctly (GET=read, POST=create, PUT=replace, PATCH=update, DELETE=remove)
- Version APIs in the URL path (`/v1/users`)
- Return appropriate HTTP status codes (don't use 200 for everything)
- Use consistent error response format:
  ```json
  {
    "error": {
      "code": "RESOURCE_NOT_FOUND",
      "message": "User with ID 123 not found",
      "details": {}
    }
  }
  ```

### Pagination
- Use cursor-based pagination for large datasets
- Always include `total`, `limit`, `offset` or `nextCursor` in responses
- Default page size: 20, max: 100

### Authentication & Authorization
- Use OAuth 2.0 / OpenID Connect for authentication
- Use JWT tokens with short expiry (15 min access, 7 day refresh)
- Include authorization checks at the handler level, not middleware-only
- Never expose internal IDs in public APIs without necessity

---

## Security Standards

> These are BLOCKING — Construction stages cannot be approved if violated.

### Input Validation
- Validate ALL external input (request bodies, query params, headers, file uploads)
- Use allowlists over denylists
- Sanitize before storage AND before rendering
- Limit string lengths, array sizes, and numeric ranges

### Secrets Management
- Never hardcode secrets, tokens, or credentials in source
- Use environment variables or a secrets manager
- Never log secrets (mask in error messages)
- Rotate credentials on suspected compromise

### Data Protection
- Encrypt sensitive data at rest (AES-256 minimum)
- Use TLS 1.2+ for all data in transit
- Implement proper access controls (principle of least privilege)
- PII must be identified and handled per data classification policy
- Implement data retention and deletion policies

### Dependency Security
- Pin dependency versions (exact or lock file)
- Audit dependencies for known vulnerabilities before adding
- Prefer well-maintained packages with active security response
- No dependencies with known critical CVEs

---

## Testing Standards

### Coverage Requirements
- Minimum line coverage: 80%
- Critical paths (auth, payment, data mutation): 95%
- New code must include tests (no untested PRs)

### Test Patterns
- Unit tests: isolated, fast, deterministic
- Integration tests: real dependencies where practical, containers for databases
- E2E tests: critical user journeys only (expensive, flaky)
- Use test factories/builders over raw fixtures
- Name tests: `should [expected behavior] when [condition]`

### Test Quality
- No test interdependence (each test runs independently)
- No sleeping/fixed delays — use polling or event-driven waits
- Mock external services at the boundary, not deep inside
- Test error paths, not just happy paths

---

## Deployment Standards

### Containerization
- All services must be containerizable (Dockerfile required)
- Use multi-stage builds to minimize image size
- Run as non-root user in containers
- Health check endpoint required (`/health` or `/healthz`)
- Graceful shutdown handling (SIGTERM)

### CI/CD
- All changes go through CI before merge
- Pipeline must include: lint, type-check, unit tests, build
- Branch protection on main/master (no direct pushes)
- Automated deployment to staging on merge
- Production deployment requires manual approval

### Observability
- Structured logging (JSON format, correlation IDs)
- Metrics: request rate, error rate, latency (RED method)
- Distributed tracing for inter-service communication
- Alerting on SLO violations

---

## Documentation Standards

### Required Documentation
- `README.md` — Project overview, setup, and run instructions
- API documentation (OpenAPI/Swagger for REST)
- Architecture Decision Records (ADRs) for significant decisions
- Runbook for production operations

### Code Documentation
- Public APIs must have doc comments (JSDoc, docstrings, etc.)
- Complex algorithms require explanatory comments
- Configuration must be documented (what each setting does)
- No TODOs without a linked issue/ticket

---

## Enforcement Rules

During AIDLC Construction stages:

1. **Before Code Generation (3.5)**: Remind developer of relevant standards for the current unit of work
2. **After Code Generation (3.5)**: Verify compliance with standards above
3. **At Build and Test (3.6)**: Verify test coverage meets thresholds
4. **At CI Pipeline (3.7)**: Verify pipeline includes required stages

### Violation Severity

| Level | Meaning | Blocks Approval? |
|-------|---------|-----------------|
| CRITICAL | Security violation, data exposure risk | Yes |
| HIGH | Standards violation with production impact | Yes |
| MEDIUM | Convention deviation, maintainability concern | No (advisory) |
| LOW | Style preference, minor inconsistency | No (advisory) |

Advisory violations are surfaced but don't block stage approval. The developer can choose to address or acknowledge them.
