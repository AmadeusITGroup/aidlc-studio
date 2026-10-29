#!/usr/bin/env bun
// eve-sdl-win-precheck.ts — Windows-only SDL prerequisite check (SessionStart).
//
// WHY bun (not sh): on Windows the SDL hooks and the git pre-commit hook are
// POSIX-sh scripts, and that sh/bash runtime ships with Git for Windows. So the
// sh-based preflight/gate cannot run when git is absent (no git => no sh). This
// check runs under `bun` (a native Windows executable, no shell needed), so it
// can still warn when git is missing on Windows.
//
// WHY SessionStart (not PreToolUse): git presence does not change mid-session,
// and a git-less Windows box cannot `git commit` at all (so there is no commit
// to scan). A per-tool-call block would therefore be pointless overhead — this
// runs ONCE per session (SessionStart on kiro-ide, agentSpawn on the CLI) and
// only WARNS. The sh eve-sdl-gate still HARD-BLOCKS the Windows-WITH-sh case at
// no extra cost. On modern Kiro the SessionStart trigger fires once; the pre-1.0
// .kiro.hook twin uses promptSubmit (same fallback as eve-sdl-preflight).
//
// Prints the install directive to STDOUT (Kiro injects SessionStart stdout into
// the agent's context) and ALWAYS exits 0. Silent no-op on macOS/Linux and when
// git is present.

import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32" || process.env.OS === "Windows_NT";
if (!isWindows) process.exit(0);

// Probe git via a real invocation so PATH resolution matches how the hooks will
// later spawn it (shell:true lets the OS shell resolve git.exe/PATHEXT on
// Windows). Args are fixed literals — no untrusted input — so shell:true is safe.
const probe = spawnSync("git", ["--version"], { stdio: "ignore", shell: true });
const gitOk = !probe.error && probe.status === 0;
if (gitOk) process.exit(0);

const directive = [
  "[AI-DLC SDL] SETUP REQUIRED — 'git' is not installed / not on PATH (Windows).",
  "",
  "AGENT DIRECTIVE: In your next reply, tell the user that AI-DLC SDL security scanning is INACTIVE until git is installed, and present the steps below as a numbered checklist. Git for Windows also provides the sh/bash runtime the SDL hooks need; without git you also cannot `git commit`.",
  "",
  "INSTALL STEPS:",
  "  Install Git for Windows:",
  "      https://git-scm.com/download/win     (or:  winget install --id Git.Git -e)",
  "  Then reopen the terminal / restart the Kiro window so git + sh are on PATH.",
].join("\n");

process.stdout.write(`${directive}\n`);
process.exit(0);
