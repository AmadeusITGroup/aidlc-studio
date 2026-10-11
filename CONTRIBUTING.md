# Contributing

Thanks for helping improve AIDLC Studio. By participating, you agree to follow the project's applicable community.

## Development Setup

Requirements: Node.js 20 and npm.

```bash
npm ci
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

## Before Opening a Pull Request

Run the checks that apply to your change:

```bash
npm run lint
npx tsc --noEmit
npm test
```

Add or update tests for behavior changes. Keep changes focused, describe user-visible effects in the pull request, and include the checks you ran. Do not commit credentials, personal data, or generated build/package output.

Open a pull request against `main` and explain the problem, the approach, and any follow-up work. Maintainers will review the change and required CI checks before merging.