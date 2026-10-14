# Contributing

Thanks for helping improve AIDLC Studio. By participating, you agree to abide by the project's [Code of Conduct](CODE_OF_CONDUCT.md).

## Start With an Issue

Before writing code, please open an issue so we can agree on the problem and approach first. This avoids duplicated effort and wasted work on changes that may not be accepted.

- **Bugs** — open a [bug report](https://github.com/AmadeusITGroup/aidlc-studio/issues/new?template=bug_report.md) with steps to reproduce, what you expected, and what happened.
- **Features or changes** — open a [feature request](https://github.com/AmadeusITGroup/aidlc-studio/issues/new?template=feature_request.md) describing the use case before you start building.
- **Questions or ideas** — use [Discussions](https://github.com/AmadeusITGroup/aidlc-studio/discussions) rather than an issue.
- **Security vulnerabilities** — do **not** open a public issue. Report privately via a [security advisory](https://github.com/AmadeusITGroup/aidlc-studio/security/advisories/new) and see [SECURITY.md](SECURITY.md).

For anything beyond a trivial fix (typos, small docs), wait for a maintainer to confirm the issue before opening a pull request.

## Fork and Branch

This project uses the standard GitHub fork-and-pull-request workflow. You do not have write access to the main repository, so work from your own fork.

1. **Fork** the repository to your own account using the **Fork** button on GitHub.
2. **Clone your fork** and add the upstream remote:

   ```bash
   git clone https://github.com/<your-username>/aidlc-studio.git
   cd aidlc-studio
   git remote add upstream https://github.com/AmadeusITGroup/aidlc-studio.git
   ```

3. **Create a branch** off an up-to-date `main`. Use a short, descriptive name:

   ```bash
   git fetch upstream
   git checkout -b fix/welcome-logo-uri upstream/main
   ```

   Do not work directly on `main` — keep it clean so you can sync it with upstream.

4. **Keep your branch current** by rebasing on upstream `main` as it moves:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

## Development Setup

Requirements: Node.js 20 and npm.

```bash
npm ci
npm run compile
```

Press `F5` in VS Code or Kiro to launch the Extension Development Host.

## Commits

- Reference the issue you're addressing (for example, `Fixes #123`) in the commit body or the pull request description.
- Write focused commits with clear messages explaining the *why*, not just the *what*.
- Do not commit credentials, personal data, or generated build/package output (`out/`, `*.vsix`).

## Before Opening a Pull Request

Run the checks that apply to your change and make sure they pass:

```bash
npm run lint
npx tsc --noEmit
npm test
```

- Add or update tests for any behavior change.
- Keep the change focused — unrelated refactors belong in a separate issue and PR.

## Opening the Pull Request

1. Push your branch to your fork:

   ```bash
   git push -u origin fix/welcome-logo-uri
   ```

2. Open a pull request from your fork's branch against `AmadeusITGroup/aidlc-studio`'s `main` branch.
3. In the description, link the issue (`Closes #123`), explain the problem, the approach, any user-visible effects, and the checks you ran. Fill out the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
4. Keep the PR up to date with `main` and respond to review feedback. A maintainer will review the change and required CI checks before merging.

Thanks again for contributing.
