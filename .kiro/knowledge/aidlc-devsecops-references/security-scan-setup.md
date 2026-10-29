# GitHub Workflow Setup for Security Scans (on-demand reference)

> **On-demand reference for the devsecops agent.** Consult this — end to end —
> whenever the user asks to create, update, or troubleshoot
> `.github/workflows/security-scans.yml`. This is the authoritative source for
> that workflow; do not improvise its structure from other documents.
>
> Complements `eve-github-action.md` and `cicd-pipelines.md` with a practical
> setup flow for reusable Amadeus security workflow templates across Maven,
> Yarn, NPM, and Python projects.

## Scope

- Generate a fresh `.github/workflows/security-scans.yml`
- Add or update specific scans in an existing workflow
- Troubleshoot scan failures for a workflow that already exists
- Support single-stack and frontend/backend multi-stack repositories

## Mandatory SDL Constraints

Always enforce the following while setting up workflows:

- This document is the authoritative source for `.github/workflows/security-scans.yml` setup/update/troubleshooting.
- Do not generate ad-hoc inline `steps` templates (for example direct `actions/checkout` + `amadeus-appsec/eve-action`) unless this document explicitly requires it.
- If examples from other references differ, follow this document for `security-scans.yml` decisions.

- Do not include secrets scanning in GitHub Action workflows (already enabled by Amadeus defaults).
- Never add artifact upload steps to Artifactory for scan reports.
- Never use Prisma; use RHACS (default) or Falcon as applicable.
- For Maven workflows, never enable `dependency-check-scan`.
- If `blackduck-scan` is enabled, require Black Duck group ID.
- If `blackduck-scan` is not selected, do not ask any Black Duck group ID question.
- Default workflow triggers must be `pull_request`, `schedule`, and `workflow_dispatch`.
- Do not ask whether to add a `push` trigger for security-scan setup.
- Keep workflow setup simple by default: generate a single `security-scans` job instead of light/heavy segmentation unless the user explicitly asks to split jobs.
- Do not use `${{ github.ref_name }}` for `ssc-version`; always use an explicit fixed SSC version name provided by the user (example: `finops-default`).
- Always validate reusable workflow contracts at the exact pinned ref before generating parameters: fetch the called workflow file and use only keys declared under `on.workflow_call.inputs` and `on.workflow_call.secrets`.
- Never assume cross-stack parameter parity (Yarn/NPM/Python/Maven). Input names can differ even when scan names are similar.

## Step 1 - Detect Topology

Detect stack by repository files:

| Indicator | Stack |
| --- | --- |
| `pom.xml` | Maven |
| `yarn.lock` or `package.json` with yarn packageManager | Yarn |
| `package.json` without yarn indicator | NPM |
| `pyproject.toml`, `requirements.txt`, `Pipfile`, `uv.lock` | Python |

If two components are present (typically frontend + backend), treat as multi-stack and generate separate jobs per component.

## Step 2 - Prerequisite Gate (Blocking, Conditional)

Before generating or updating workflow content, confirm readiness with structured questions.
Use a phased flow so conditional questions are shown only when needed.

- SSC application/version exists
- Nano/YAC UUID available
- `IZ_USER` and `IZ_PASSWORD` credentials available in GitHub secrets
- Black Duck group ID available (only if BlackDuck scan is selected)

If a required prerequisite is missing, stop and return a concise checklist with setup links.

### Step 2a - Mandatory Base Questions (Always First)

Ask these questions first, before UUID/app/version/image/secret-name inputs:

Important sequencing rule:

- Run Step 2a in two passes. First ask base prerequisites + `scans`. Then evaluate selected scans.
- Ask `bd-ready` in a second pass only if `blackduck-scan` is selected.
- Never include `bd-ready` in the same initial question batch as `scans`.

Ask through the stage's normal question flow, with fixed options (no freeform input) for these checks:

- `ssc-ready`: Do you already have SSC application + version ready? (`yes`/`no`)
- `uuid-ready`: Do you already have Nano/YAC UUID ready? (`yes`/`no`)
- `iz-ready`: Do you already have IZ credentials ready for GitHub secrets? (`yes`/`no`)
- `scans`: Which scans do you want to enable? (`fortify-scan`, `dependency-check-scan`, `blackduck-scan`, `rhacs-scan`)

Then ask `bd-ready` only when `blackduck-scan` is selected:

- `bd-ready`: Do you already have Black Duck group ID ready? (`yes`/`no`/`not applicable`)

If any required prerequisite answer is `no`, do not continue to Step 3.

Prerequisite-first rule (strict):

- Do not ask UUID value, SSC app name/version value, IZ existing variable names, BlackDuck Group ID value, or RHACS image inputs before Step 2 prerequisites are evaluated.
- If any prerequisite is `no`, stop and return the missing-prerequisites process response.

### Step 2b - Conditional Trigger Rules (Must Follow)

Show each question only when its condition is met:

- Ask `IZ exists in repo?` only when `iz-ready = yes`.
- Ask `IZ username secret variable name` and `IZ password secret variable name` only when `IZ exists in repo = yes`.
- Never ask IZ variable-name questions when `IZ exists in repo = no`.
- Never ask `bd-ready` when `blackduck-scan` is not selected.
- Ask BlackDuck Group ID value only when `blackduck-scan` is selected and `bd-ready = yes`.
- If `bd-ready = no`, stop and return the missing-prerequisites process response.
- If `bd-ready = not applicable`, remove `blackduck-scan` from selected scans and skip all BlackDuck follow-up questions.
- Never ask BlackDuck Group ID value when `bd-ready = no`, `bd-ready = not applicable`, or when `blackduck-scan` is not selected.

### Step 2c - Mandatory Missing-Prerequisites Response

When one or more prerequisites are missing, return this structure and stop:

- `🚫 Missing prerequisites`
- `❗ Action needed:` list only the missing items
- `🔗 Setup links:` include only links for missing items
- Final line: `Once these are ready, come back and rerun security-scan-setup.`

Setup links to use:

- SSC app/version: `https://amadeus.atlassian.net/wiki/x/HrEkXQ`
- Nano UUID: `https://nano.amadeus.net`
- IZ credentials: `https://ci.controltower-backstage.global.amadeus.net`
- BlackDuck Group ID: `https://amadeus.atlassian.net/wiki/spaces/PSC/pages/1330804414`

If `bd-ready = no` and `blackduck-scan` is selected, explicitly include this action text:

- `Create or obtain BlackDuck Group ID, then rerun setup with blackduck-scan.`

If `bd-ready = not applicable` and `blackduck-scan` was selected, explicitly include this action text:

- `BlackDuck scan has been skipped because BlackDuck Group ID is marked not applicable.`

## Step 3 - Collect Remaining Inputs (Conditional Batches)

Collect required inputs only after Step 2 passes. Ask in minimal conditional batches:

- UUID
- SSC application name
- SSC version
- Black Duck group ID value (only when `blackduck-scan` is selected and `bd-ready = yes`)
- RHACS image details (optional, only when `rhacs-scan` is selected and image information is available)

BlackDuck branching summary:

- `bd-ready = yes`: continue and ask BlackDuck Group ID value.
- `bd-ready = no`: stop with missing-prerequisites process response.
- `bd-ready = not applicable`: skip BlackDuck scan and continue with remaining selected scans.

Mandatory question wording guardrail for SSC version input:

- Always ask for a fixed SSC version name and use the example `finops-default`.
- Never use `${{ github.ref_name }}` as the `ssc-version` value or as an example.

Black Duck question guardrail:

- Only include Black Duck group ID questions when `blackduck-scan` is selected.
- If `blackduck-scan` is not selected, omit Black Duck group ID questions entirely (no `N/A`, no placeholder input).

IZ question guardrail:

- If `IZ exists in repo = no`, do not ask for existing variable names.
- In that case, continue with defaults `IZ_USER` and `IZ_PASSWORD` and mention defaults in output summary.

For multi-stack with RHACS, collect frontend and backend image details separately.

### Step 3a - Multi-Stack RHACS Inputs (Mandatory)

When multi-stack is detected and `rhacs-scan` is enabled, ask RHACS inputs per component (in the same question batch):

- frontend image base path
- frontend representative image tag
- backend image base path
- backend representative image tag

Do not reuse one component value for the other. Treat frontend and backend as independent image sources.

If image details are unavailable for one or both components, continue without forcing image inputs and omit `image-to-scan` for those components.

### Step 3b - Validate Reusable Workflow Contract (Mandatory)

Before writing or updating `.github/workflows/security-scans.yml`, validate each selected reusable workflow against its exact ref:

1. Fetch the reusable workflow YAML at the pinned ref.
2. Read `on.workflow_call.inputs` and `on.workflow_call.secrets`.
3. Build a local mapping table (`desired semantic field` -> `actual workflow input key`).
4. Generate caller `with:` keys strictly from this mapping table.
5. Wire credentials via caller `secrets:` when the reusable workflow declares required secrets.

Recommended command pattern:

```bash
GH_PAGER=cat gh api 'repos/<ORG>/<REPO>/contents/.github/workflows/<WORKFLOW_FILE>?ref=<REF>' --jq '.content' \
	| base64 --decode
```

Validation examples:

- If reusable workflow input is `yac-uuid`, do not emit `nano-uuid` in caller `with:`.
- If reusable workflow input is `security-center-application-name`, do not emit `ssc-application`.
- If reusable workflow requires secrets `IZ_USER`/`IZ_PASSWORD`, pass them under caller `secrets:`.

## Step 4 - Generate Workflow

Use stack-specific reusable workflows and preserve stack constraints.

Workflow structure guardrail:

- Default to one job named `security-scans` for all configured triggers.
- Only introduce light/heavy or multi-phase segmentation when explicitly requested by the user.
- Set a fixed `ssc-version` value from user input for all triggers.

### Maven

- Reusable workflow: `Amadeus-xDLC/github-workflows-maven/.github/workflows/maven-security-scans.yaml@v2`
- Runner: `gmsshr-maven-${{ github.repository_owner }}`
- Do not include `dependency-check-scan`

### Runner Label Rule

Never hardcode the organization suffix in `runs-on`. Parameterize the runner label from the repository owner, for example `gmsshr-maven-${{ github.repository_owner }}`, `gmsshr-core-${{ github.repository_owner }}`, or a workflow input when the workflow is shared across repositories.

### Yarn

- Reusable workflow: `Amadeus-xDLC/github-workflows-yarn/.github/workflows/yarn-security-scans.yaml@v1`
- Runner: `gmsshr-core-${{ github.repository_owner }}`

### NPM

- Reusable workflow: `Amadeus-xDLC/github-workflows-common/.github/workflows/npm-security-scans.yaml@main`
- Runner: `gmsshr-core-${{ github.repository_owner }}` (or auto)

### Python

- Reusable workflow: `Amadeus-xDLC/github-workflows-python/.github/workflows/python-security-scans.yaml@v1.1.0`
- Runner: `gmsshr-python-${{ github.repository_owner }}` (or auto)

## RHACS Image Rules

When RHACS is selected:

- Ask for `image-base-path` and a representative tag when the user can provide image details.
- If RHACS is enabled and image details are provided, generate a `get-image` pre-job that uses `Amadeus-xDLC/get-latest-docker-tag-action@v1` and wire `image-to-scan` from `${{ needs.<get-image-job>.outputs.image }}`.
- If RHACS is enabled but no image details are provided, do not require `image-to-scan` in the generated reusable workflow call.
- Derive `image-artifactory-path` from `image-base-path`.
- Derive `version-pattern` from representative tag.
- Derive `version-pattern` from the tag shape token by token, not from a fixed major/minor.
- Mapping rule: numeric token -> `\\d+`; alphabetic word token -> keep literal word; separators (`.` / `-` / `_`) -> keep as escaped separators in regex.
- Example mapping: `1.0.9` -> `^\\d+\\.\\d+\\.\\d+$`.
- Example mapping: `1.0-main.8` -> `^\\d+\\.\\d+-main\\.\\d+$`.
- If registry pull credentials differ from IZ credentials, use `DOCKER_USER` / `DOCKER_PASSWORD`.
- If the repository publishes Docker images to Artifactory and the reusable workflow expects a concrete `image`/`image-to-scan` value, prefer resolving the latest tag at runtime with `Amadeus-xDLC/get-latest-docker-tag-action@v1` and pass the resulting full image to the scan job.

### RHACS Dynamic Tag Resolution (Artifactory)

When RHACS is enabled and tags are produced dynamically in CI, add a lightweight pre-job to resolve the full image path. Then pass that output to the security scan job.

This is the default pattern whenever RHACS is enabled and docker image details are available.

```yaml
jobs:
	get-image:
		runs-on: gmsshr-core-${{ github.repository_owner }}
		outputs:
			image: ${{ steps.docker-tag.outputs.full-image-path }}
		steps:
			- name: Get latest Docker tag
				id: docker-tag
				uses: Amadeus-xDLC/get-latest-docker-tag-action@v1
				with:
					image-base-path: dockerhub.rnd.amadeus.net/<isolation-zone>/<repository>
					image-artifactory-path: <isolation-zone>/<repository>
					artifactory-username: ${{ secrets.CI_IZ_USER }}
					artifactory-password: ${{ secrets.CI_IZ_PASSWORD }}

	security-scans:
		needs: [get-image]
		uses: Amadeus-xDLC/github-workflows-python/.github/workflows/python-security-scans.yaml@v1.1.0
		with:
			rhacs-scan: true
			image-to-scan: ${{ needs.get-image.outputs.image }}
```

Example output usage from the pre-job:

```yaml
jobs:
	get-image:
		runs-on: gmsshr-core-amadeus-digital
		outputs:
			image: ${{ steps.docker-tag.outputs.full-image-path }}
			latest-tag: ${{ steps.docker-tag.outputs.latest-tag }}
		steps:
			- name: Get latest Docker tag
				id: docker-tag
				uses: Amadeus-xDLC/get-latest-docker-tag-action@v1
				with:
					image-base-path: dockerhub.rnd.amadeus.net/dga-docker-production-adt-nce/sherlock-mcp/backend
					image-artifactory-path: dga-docker-production-adt-nce/sherlock-mcp/backend
					artifactory-username: ${{ secrets.CI_IZ_USER }}
					artifactory-password: ${{ secrets.CI_IZ_PASSWORD }}

	show-image:
		needs: [get-image]
		runs-on: gmsshr-core-amadeus-digital
		steps:
			- name: Use the image
				run: |
					echo "Latest image: ${{ needs.get-image.outputs.image }}"
					echo "Latest tag: ${{ needs.get-image.outputs.latest-tag }}"
```

If no image information is available, keep `rhacs-scan: true` and omit `image-to-scan`.

Rules for this pattern:

- Use this dynamic pattern only when image tags are not fixed and are resolved from Artifactory at runtime.
- Keep the security scan implementation in reusable workflows; do not replace scans with ad-hoc inline EVE scan steps.
- If `CI_IZ_USER`/`CI_IZ_PASSWORD` are used for Artifactory reads, list them explicitly in the output summary as additional required secrets.

### Multi-Stack RHACS Derivation Rules

For multi-stack repositories, derive RHACS values independently for each component:

- frontend: derive `image-artifactory-path` and `version-pattern` from frontend base path/tag
- backend: derive `image-artifactory-path` and `version-pattern` from backend base path/tag
- frontend/backend workflow generation: create separate `get-image-frontend` and `get-image-backend` jobs and map each security job `image-to-scan` to the matching get-image output.

If frontend and backend tags use different formats, keep different `version-pattern` values. Never force a shared pattern across components.

## Step 5 - Existing Workflow Update Mode

If `.github/workflows/security-scans.yml` already exists and user asks to add/update a specific scan:

1. Read existing scan flags and show only not-yet-enabled scans.
2. Reuse values already present in file (`uuid`, app name/version, secret names, RHACS fields).
3. Ask only for genuinely missing values.
4. Update only requested scans and related fields; do not modify unrelated settings.

## Step 6 - Troubleshooting Mode

If the workflow exists and user reports failure:

1. Verify the failing scan is enabled in workflow.
2. Ask for exact job name, step name, and error output.
3. Apply stack/scan-specific fixes only after matching the failure to enabled configuration.
4. For session timeout symptoms, increase session `limit` and retry.

## Output Checklist

When setup or update completes, report:

- Generated/updated file path
- Enabled scans
- Required GitHub secrets
- Any defaults inferred automatically
- Optional next validation step (open a PR to validate trigger behavior)
