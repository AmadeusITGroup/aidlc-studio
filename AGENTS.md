# AGENTS.md

Guidance for AI coding agents working in this repository. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md); this file captures the project-specific context an agent needs to make correct changes.

## What this project is

AIDLC Studio is a VS Code / Kiro extension (TypeScript) that visualizes the **AI-Driven Development Life Cycle (AI-DLC)** framework. It is a thin, **read-only companion** over the framework.

The single most important rule: **the extension never writes to or mutates AI-DLC framework state.** It reads the files the framework produces (`aidlc-state.md`, `runtime-graph.json`, `stage-graph.json`, `intents.json`, the audit trail, and artifacts) and renders them. Any action that changes state — approving a stage, switching intent, running setup — is delegated to the framework's own CLI (`/aidlc`, `bun .kiro/tools/*.ts`) or routed back into Kiro chat. Do not add code that edits framework files directly.

## Dual-host compatibility (VS Code and Kiro)

The extension must run identically in stock **VS Code** and in **Kiro** (a VS Code fork). Both expose the same `vscode` extension API, so almost everything is portable.

- Do **not** add branching that detects or names the host IDE, and do not surface host-specific UI text or logging.
- Do **not** look the extension up by a hardcoded publisher/name ID (e.g. `vscode.extensions.getExtension('amadeus.aidlc-studio')`). Use the `vscode.ExtensionContext` passed into `activate()` instead — `context.extensionUri`, `context.extension.packageJSON.version`, `context.extension.id`. Thread the context through to whatever needs it (see `src/views/welcomePanel.ts` for the established pattern).
- `vscode.env.openExternal(...)` to external URLs is fine and cross-compatible.
- Platform handling (Windows / macOS / Linux) branches on `process.platform` — that is orthogonal to the IDE and should stay.

## Build, lint, and test

Requirements: Node.js 20 and npm.

```bash
npm ci            # install (use npm ci, lockfile is committed)
npm run compile   # tsc -p ./  -> out/
npm run lint      # eslint src --ext ts
npm run test      # vitest --run  (one-shot; do NOT use watch mode)
```

Always run `npm run compile`, `npm run lint`, and `npm run test` before considering a change done, and fix anything you break. `npx tsc --noEmit` is a quick type-check without emitting. There is no bundler step; `tsc` emits to `out/` and `main` points at `out/extension.js`.

Tests use **vitest** and live next to the code they cover (`*.test.ts`, e.g. `src/services/stateParser.test.ts`, `src/services/variants.test.ts`). Add or update tests for behavior changes. Run tests with `--run` (one-shot) — never a watch mode, which blocks.

## Project layout

```
src/
  extension.ts            Activation entry point; wires services, views, and command registrations
  commands/               Command handlers (all command IDs are prefixed "amadeus-aidlc.")
  services/               Non-UI logic: CLI wrapper, shell, state parsing, update checker, installers
  views/                  Webview panels (welcome, docs, analytics) and tree data providers
  providers/              Editor providers (e.g. approval CodeLens)
  types/                  Shared TypeScript types
resources/                Icons and the brand logo (do not regenerate casually)
.kiro/                    Steering + hooks for AIDLC Studio's own AI-assisted development
```

- Command IDs and the activity-bar container id use the **`amadeus-aidlc`** prefix. Keep new commands consistent, and register them in both `package.json` (`contributes.commands`) and `src/extension.ts`. A command contributed in one place but not the other is a bug.
- Configuration keys live under the `amadeus-aidlc.*` namespace in `package.json` `contributes.configuration`.
- Tree views and webview panels get their data from services; keep rendering (views) separate from logic (services).

## Conventions

- TypeScript, ES modules via `tsc`. Match the existing style; `eslint` is the source of truth (note the repo's `no-console` warning — avoid stray `console.*`).
- Webviews must resolve local resources through `webview.asWebviewUri(...)` using the extension's own `context.extensionUri`, never absolute or host-specific paths. Keep a sensible fallback when a resource can't be resolved (see the welcome panel's text-brand fallback).
- Keep changes focused and minimal. This is a read-only visualizer — prefer the smallest change that fixes the issue over refactors.
- Do not commit generated output (`out/`, `*.vsix`) or secrets.

## Workflow expectations

- Open or reference a GitHub issue before non-trivial changes, and work on a fork + feature branch (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- Target the `main` branch in pull requests, and include the checks you ran.
