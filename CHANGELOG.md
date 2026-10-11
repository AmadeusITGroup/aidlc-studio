# Changelog

All notable changes to AIDLC Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Open-source readiness: rewrote `README.md`, added `CODE_OF_CONDUCT.md`,
  `CHANGELOG.md`, issue/PR templates, and removed internal-only files.

## [0.3.0]

### Added

- AI-DLC variant selector during setup. The **AWS** variant is the default; the
  **Amadeus** variant is available as an option.
- AWS variant installs through the native installer (`install.sh` /
  `install.ps1`) followed by `aidlc config --harness kiro-ide`; the Amadeus
  variant installs by cloning the repo and copying the framework into place.
- Extension self-update: checks GitHub releases and can download and install the
  latest `.vsix`.

### Changed

- The variant is chosen only during Setup. There is no persistent post-install
  selector and changing it does not trigger an automatic reinstall.

## [0.2.0]

### Added

- Analytics dashboard webview with per-intent analytics.
- Dependency graph: a force-directed, draggable node-link view of workflow
  relationships.
- Timeline view, Welcome page, and agent dashboard.
- `bun` installer that configures PATH for non-interactive shells on macOS and
  Windows.

### Changed

- Artifacts view shows only real framework files that exist on disk.
- Phase completion logic now accounts for both completed and skipped stages and
  surfaces the active scope.
- System view reordered (Setup, bun, Health, AIDLC Version, Extension,
  Analytics, Documentation) and the framework version row renamed to
  **AIDLC Version**.

## [0.1.0]

### Added

- Initial release of AIDLC Studio for Kiro / VS Code.
- Guided setup that clones and installs the AI-DLC framework.
- System view with setup, health (`/aidlc --doctor`), and version status.
- Workflow Progress, Stages, Artifacts, and Intents tree views.
- Stage approval UI (approve, request changes, skip) and artifact review.
- Read-only companion over AI-DLC framework files the extension reads
  framework state and never writes to framework or user project files.

[Unreleased]: https://github.com/AmadeusITGroup/aidlc-studio/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AmadeusITGroup/aidlc-studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AmadeusITGroup/aidlc-studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AmadeusITGroup/aidlc-studio/releases/tag/v0.1.0
