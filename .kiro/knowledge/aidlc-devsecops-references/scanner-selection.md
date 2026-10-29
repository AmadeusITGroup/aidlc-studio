# Scanner Selection Guide (on-demand reference)

> **On-demand reference for the devsecops agent.** Consult this when you need
> the full technology→scanner mapping, supported-format lists, decision
> flowcharts, or the container image auto-discovery procedure. The compact
> selection summary lives in `../aidlc-devsecops-agent/devsecops-pipeline-patterns.md`.
>
> **All scanners listed below are provided at no extra cost and require no
> additional license.** They are part of the Amadeus SDL ecosystem.

---

## TP8: Application Dependencies Scan

TP8 is composed of **two sub-touchpoints** that must be addressed independently based on the nature of the artifact being scanned:

### 1. Container SCA (Container Image Scanning)

Scans container images for vulnerable dependencies, OS packages, and misconfigurations.

| Scanner | Use Case | Supported Formats | EVE Command |
|---------|----------|-------------------|-------------|
| **RHACS** (recommended) | Default for all container workloads, especially OpenShift (ACS) | Docker, Podman | `eve scan rhacs <image>` |
| **Falcon** | Alternative for non-OpenShift environments (ECS, standalone Docker, etc.) | Docker, Podman | `eve scan falcon image <image>` |

**Decision logic:**
- Deployed on **OpenShift / ACS** → use **RHACS**
- Deployed on **any other container runtime** (ECS, standalone Docker, Kubernetes without OpenShift) → use **Falcon**
- **When in doubt** → use **RHACS** (recommended default)

> **Do NOT scan container images with Black Duck.** Black Duck's container scanning quality is poor. Always use RHACS or Falcon for containers.

> **Prisma is deprecated** and will be decommissioned on 02 May 2026. Migrate to RHACS or Falcon. See [Prisma Cloud → RHACS / Falcon – Migration Strategy](https://amadeus.atlassian.net/wiki/spaces/SSC3/pages/3438347216).

---

### Container Image Auto-Discovery

When Container SCA is applicable but **the user has not provided a container image name**, follow this procedure to guess the image from the repository CI configuration before asking the user.

#### Step 1 — Search CI files

```bash
# Locate Jenkinsfile anywhere in the repo (up to 3 levels deep)
find . -name "Jenkinsfile" -maxdepth 3

# Locate GitHub Actions workflow files
find .github/workflows -name "*.yml" -o -name "*.yaml" 2>/dev/null
```

#### Step 2 — Extract image patterns

Scan the discovered files for common image reference patterns:

| Pattern | Example |
|---------|---------|
| `docker build -t` | `docker build -t registry.example.com/myapp:1.0.0 .` |
| `podman build -t` | `podman build -t registry.example.com/myapp:1.0.0 .` |
| `docker push` / `podman push` | `docker push registry.example.com/myapp:$TAG` |
| `image:` (YAML key) | `image: registry.example.com/myapp:latest` |
| Environment variables | `IMAGE_NAME`, `DOCKER_IMAGE`, `PODMAN_IMAGE`, `CONTAINER_IMAGE`, `APP_IMAGE` |
| GitHub expressions | `${{ vars.IMAGE_NAME }}`, `${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}` |

Typical grep patterns to extract candidates:

```bash
# From Jenkinsfile (covers both docker and podman)
grep -Eo "((docker|podman) (build|push|tag)[^'\n\"]*|IMAGE[_A-Z]+=\S+)" Jenkinsfile

# From GitHub workflows (covers both docker and podman)
grep -Eo "(image:|(DOCKER|PODMAN)_IMAGE|IMAGE_NAME|REGISTRY)[[:space:]]*[=:][[:space:]]*\S+" .github/workflows/*.yml
```

#### Step 3 — Resolve GitHub variables

If the extracted image reference contains GitHub expressions (`${{ vars.X }}`, `${{ env.X }}`, `${{ inputs.X }}`, `${{ secrets.X }}`), resolve them using the `gh` CLI:

```bash
# List all repository variables
gh variable list

# Get a specific variable value
gh variable get IMAGE_NAME

# List variables scoped to a deployment environment
gh variable list --env production

# Resolve the current registry + image name pattern
gh variable get REGISTRY
gh variable get IMAGE_NAME
```

> **Note:** `${{ secrets.X }}` values cannot be retrieved via the API. If the image name depends on a secret, ask the user to provide the resolved value directly.

#### Step 3b — Resolve `workflow_dispatch` input choices

GitHub workflows may use `workflow_dispatch` inputs of type `choice` to select a deployment target, environment, or isolation zone that determines which image is used. **Always inspect `on.workflow_dispatch.inputs` before concluding a variable is unresolvable.**

Look for patterns like:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options:
          - Integration
          - Staging
          - Production
```

When such inputs exist:
1. **Map the choice value to downstream variables.** Trace how `${{ inputs.<name> }}` flows through `env:` blocks, `if:` conditions, and `matrix:` to determine which registry, isolation zone, or image name it produces for each option.
2. **Use the most representative choice** (typically the first option, often a non-production environment such as `Integration`) as the candidate value to resolve the image reference.
3. If different choices produce **different images**, list each candidate and ask the user (through the stage's normal question flow) which environment they want to scan — present the options (e.g. `Integration` (recommended), `Staging`, `Production`) and wait for their selection before proceeding.

> **Example:** a choice input `environment: Integration` may map to `artifactory_isolation_zone=nce-int`, while `Staging` maps to `nce-stg`. Trace the full `env:` / `if:` chain to resolve the correct isolation zone before constructing the registry URL.

#### Step 4 — Find available tags with skopeo

**Amadeus registry URL format:**

```
docker://dockerhub.rnd.amadeus.net/<artifactory_isolation_zone>/<container_name>
```

- `<artifactory_isolation_zone>` — the Artifactory isolation zone (e.g., `nce`, `1a`, `1b`). Look for a variable named `artifactory_isolation_zone`, `ISOLATION_ZONE`, or `IZ` in the CI files.
- `<container_name>` — the image/application name, typically matching the repository or project name.

Once the full image reference is known, list available tags.

skopeo uses the `docker://` transport for both Docker and Podman registries — the transport name refers to the registry protocol, not the local container runtime:

```bash
# Amadeus internal registry (credentials required)
skopeo list-tags --creds <username>:<token> \
  docker://dockerhub.rnd.amadeus.net/<artifactory_isolation_zone>/<container_name>

# With TLS skip if needed (internal registries with self-signed cert)
skopeo list-tags --tls-verify=false --creds <username>:<token> \
  docker://dockerhub.rnd.amadeus.net/<artifactory_isolation_zone>/<container_name>
```

> **Podman note:** If the image was built and pushed with `podman`, the registry transport is still `docker://` (OCI/Docker registry protocol). No change to the skopeo command is needed.

Select the most relevant tag using this priority:
1. A tag that matches the current git branch name or `HEAD` commit SHA
2. The tag produced by the CI pipeline (e.g., `$GITHUB_SHA`, `$BUILD_NUMBER`, a semantic version)
3. The most recently pushed tag (last in the list)

> **`latest` is never used** in the Amadeus registry. Do not fall back to `latest` — if no match is found in priority 1 or 2, present the full tag list to the user and ask them to pick one.

#### Step 5 — Confirm with the user

Present the discovered image reference and ask for confirmation before scanning, through the stage's normal question flow. Pre-fill the discovered image (e.g., `registry.example.com/myapp:abc1234`) so the user can confirm or correct it before the scan proceeds.

> If no image reference can be found in CI files, fall back to asking the user directly.

---

### 2. Non-Container SCA (Dependency & License Scanning)

Scans source code, build artifacts, and package manifests for vulnerable libraries and license compliance issues.

| Scanner | Use Case | EVE Command |
|---------|----------|-------------|
| **Black Duck** (recommended) | Most technologies — binary analysis, SCA + OSS license compliance | `eve scan blackduck <artifact>` |
| **Dependency-Check** | .NET, JavaScript, TypeScript, Python — manifest & source-level SCA | `eve scan dependency-check <path>` |

**Decision logic — choose by technology:**

| Technology / Language | Recommended Scanner | Notes |
|-----------------------|--------------------|-------|
| **Java** (JAR, WAR, Gradle, Maven) | Black Duck | Binary analysis on build artifacts |
| **Kotlin** | Black Duck | |
| **Scala** | Black Duck | |
| **C / C++** | Black Duck | Binary analysis |
| **C# / .NET Framework** | Dependency-Check | Scans .NET assemblies (*.exe, *.dll), NuGet |
| **Golang** | Black Duck | |
| **.NET** (assemblies, NuGet) | Dependency-Check | Scans *.exe, *.dll, packages.config, *.nuspec |
| **JavaScript / TypeScript** | Dependency-Check | Scans package.json, NPM packages |
| **Python** | Dependency-Check | Scans *.py, requirements.txt, PKG-INFO, *.whl, *.egg |
| **Ruby** | Black Duck | |
| **Clojure** | Black Duck | |
| **Groovy** | Black Duck | |
| **Objective-C** | Black Duck | |
| **PHP** | Dependency-Check | Scans composer.lock |
| **Swift** | Dependency-Check | Scans Package.swift |
| **Perl** | Dependency-Check | Scans cpanfile |
| **Go** (go.mod) | Dependency-Check | Also supported by Black Duck |

> **Both scanners can coexist.** For projects mixing technologies (e.g., Java backend + JavaScript frontend), use Black Duck for the Java artifact and Dependency-Check for the JavaScript source.

---

### Black Duck — Supported Formats

Black Duck performs **binary analysis** and supports a wide range of artifact formats:

- **Languages**: C, C++, C#, Clojure, Golang, Groovy, Java, Kotlin, Objective-C, Ruby, Scala, .NET
- **Archives**: ZIP, JAR, APK, 7-Zip, TAR, RAR, LZH, and derivatives
- **Compression**: Gzip, bzip2, LZMA, LZ4, XZ, zStandard
- **Installers**: RPM, DEB, DMG, PKG, MSI, EXE, CAB
- **Firmware**: Intel HEX, SREC, U-Boot, Android sparse, Cisco, Juniper
- **File systems / disk images**: ISO, ext2/3/4, VMDK, QCOW2, VDI, HFS

> **Containers**: Black Duck technically supports Docker format, but result quality is not ideal. Use RHACS or Falcon instead.

A Black Duck group is required before running scans. See the [BAS Group Creation Procedure](https://amadeus.atlassian.net/wiki/spaces/PSC/pages/1330803886/BAS+Group+Creation+Procedure).

---

### Dependency-Check — Supported Formats

Dependency-Check performs **manifest and source-level analysis**:

| Format | File Pattern |
|--------|-------------|
| .NET Assemblies | `*.exe`, `*.dll` |
| CMake | `CMakeLists.txt`, `*.cmake` |
| Java Archives | `*.jar`, `*.war` |
| JavaScript / NPM | `package.json` |
| NuGet | `packages.config`, `*.nuspec` |
| PHP Composer | `composer.lock` |
| Perl | `cpanfile` |
| Python | `*.py`, `PKG-INFO`, `METADATA`, `*.whl`, `*.egg`, `*.zip`, `requirements.txt` |
| Ruby | `Rakefile`, `*.gemspec`, `Gemfile.lock` |
| Go | `go.mod`, `Gopkg.lock` |
| PE Binaries | DLL, EXE |
| Swift | `Package.swift` |

---

## Quick Decision Flowchart

### SAST (TP7)

```
Is TP7 (SAST) applicable?
├─ YES → Is the application prioritized (SDL Wizard priority)?
│        ├─ YES → Use Fortify (deep dataflow SAST, session mode only)
│        └─ NO  → Use Opengrep (fast, rule-based SAST alternative)
│
│        Fortify unavailable or failing?
│        └─ Use Opengrep as fallback
└─ NO  → Skip SAST scanners
```

### SCA (TP8)

```
Does the project produce a binary / library artifact?
├─ YES → Is the technology .NET, JavaScript, TypeScript, or Python?
│        ├─ YES → Dependency-Check
│        └─ NO  → Black Duck
│
│        Is the artifact then packaged into a container image?
│        ├─ YES → ALSO run a Container SCA scan (see below)
│        └─ NO  → Done
│
└─ NO  → Is it a container image only (base image, distroless, etc.)?
         ├─ YES → Container SCA scan only (see below)
         └─ NO  → Determine technology and pick Black Duck or Dependency-Check above

Container SCA scanner selection:
  Is it deployed on OpenShift / ACS?
  ├─ YES → RHACS
  └─ NO  → Falcon
```

> **Key point:** Container scanning and dependency scanning are independent sub-touchpoints. If you build a binary and then containerize it, you need **both** a Non-Container SCA scan (Black Duck or Dependency-Check) for the binary/source **and** a Container SCA scan (RHACS or Falcon) for the image.

---

## Summary Table

| Touchpoint | Sub-touchpoint | Scanner | Primary Technologies |
|------------|---------------|---------|---------------------|
| TP7 | SAST | **Fortify** | All languages — deep dataflow SAST (prioritized apps, session mode only) |
| TP7 | SAST | **Opengrep** | All languages — fast, rule-based SAST (non-prioritized apps or Fortify fallback) |
| TP8 | Container SCA | **RHACS** | Container images (OpenShift / default) |
| TP8 | Container SCA | **Falcon** | Container images (non-OpenShift) |
| TP8 | Non-Container SCA | **Black Duck** | Java, Kotlin, Scala, C/C++, Go, Ruby, Clojure, Groovy, Obj-C |
| TP8 | Non-Container SCA | **Dependency-Check** | .NET, JavaScript, TypeScript, Python, PHP, Swift, Perl |
