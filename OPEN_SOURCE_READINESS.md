# Open-Source Readiness Assessment

Assessment date: 2026-09-29  
Requested destination organization: [AmadeusITGroup](https://github.com/AmadeusITGroup)  
Repository assessed: [amadeus-travel-distribution/amadeus-aidlc-studio](https://github.com/amadeus-travel-distribution/amadeus-aidlc-studio)

## Decision

**Not ready for public release.** Repository-owned documentation, licensing files, metadata, and CI gaps can be addressed in this branch. Public release must wait for the organization to create or identify the destination repository and approve publication of the Amadeus-branded content and bundled engineering standards.

## Findings

| ID | Severity | Finding | Evidence and action | Branch status |
|---|---|---|---|
|---|---|---|---|---|
| OSR-01 | Blocker | No destination repository is available. | The configured upstream is internal under `amadeus-travel-distribution`; GitHub CLI returned 404 for `AmadeusITGroup/amadeus-aidlc-studio`, and no matching AIDLC repository appeared in the organization listing. The organization must create or identify the destination and approve its visibility and ownership. | Open: organization action required. |
| OSR-02 | Blocker | Publication rights and disclosure are unconfirmed. | The source includes Amadeus-branded steering files, including an engineering standards document described as Amadeus conventions. Obtain the content owner's approval for public distribution and confirm trademark/branding approval before release. | Open: content-owner and legal approval required. |
| OSR-03 | High | The declared MIT license has no license text. | `package.json` declares `MIT`, while GitHub reports no detected license. Add the standard MIT license text; confirm the copyright holder before publication. | MIT text added; copyright attribution still requires approval. |
| OSR-04 | High | CI requires an organization-only runner. | `.github/workflows/ci-cd.yml` used `gmsshr-playwright-maven-travel-distribution`, which is not available to public contributors. Use a hosted runner for the public CI path. | Fixed: both jobs use `ubuntu-latest`. |
| OSR-05 | High | CI does not enforce tests and there are no tests. | The workflow marked `npm run test` as `continue-on-error: true`. The initial `npm test` run reported “No test files found” and exited with status 1. Add baseline tests and make failures block CI; expand meaningful coverage before release. | Fixed for the baseline: two parser tests pass and test failures now block CI. Broader coverage remains needed. |
| OSR-06 | Medium | Repository links and package metadata do not identify the requested destination. | The README clone command pointed to `Amadeus-xDLC`, and `package.json` lacked repository, bugs, and homepage fields. Align repository-facing links and metadata with the intended destination once it exists. | Updated to `AmadeusITGroup/amadeus-aidlc-studio`; links will not resolve until OSR-01 is closed. |
| OSR-07 | Medium | Contributor and vulnerability-reporting guidance is incomplete. | The README had only a short contribution checklist; there was no `CONTRIBUTING.md` or `SECURITY.md`. Add contribution and private vulnerability-reporting guidance without inventing an organization contact. | `CONTRIBUTING.md` and `SECURITY.md` added; approved code of conduct and security contact remain open. |

## Remediation In This Branch

- Added the MIT license text, contribution and security guidance, package repository metadata, and destination-aligned README/update links.
- Moved CI to GitHub-hosted runners and made test failures blocking.
- Added two deterministic state-parser tests; these establish a baseline, not comprehensive coverage.
- Added `tsconfig.eslint.json` so typed linting includes tests without emitting tests in production builds.

## Required Before Public Release

- Create or identify `AmadeusITGroup/amadeus-aidlc-studio`; confirm repository visibility, settings, branch protections, and release permissions with its administrators.
- Obtain legal/content-owner approval for the MIT copyright attribution, Amadeus marks, and all bundled steering and standards material.
- Add an approved code of conduct and enforcement contact, plus organization-approved security contact details if GitHub private vulnerability reporting is unavailable.
- Review dependencies, generated/package contents, and the source history for licensing and sensitive-data concerns as part of the organization's publication process.
- Expand tests to cover the extension's supported workflows; the baseline test added here is not a coverage claim.
- Align TypeScript with the supported version range of the current typescript-eslint parser; lint passes but warns that TypeScript 5.9.3 is outside its declared range.

## Verification Performed

- Queried repository metadata and the requested organization with GitHub CLI while authenticated.
- Confirmed the current upstream is internal and the requested destination repository currently returns 404.
- Inspected tracked governance files, package metadata, README links, CI workflow, and bundled steering documents.
- Initial `npm test` failed because Vitest found no test files; after remediation, both tests pass.
- `npm run lint`, `npx tsc -p tsconfig.eslint.json --noEmit`, and `npm run compile` pass. Lint reports the TypeScript/typescript-eslint compatibility warning above.