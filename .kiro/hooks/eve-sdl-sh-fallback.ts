#!/usr/bin/env bun
// eve-sdl-sh-fallback.ts — Windows-only sh->PowerShell fallback launcher for the
// SessionStart SDL hooks (SessionStart on kiro-ide, agentSpawn on the CLI).
//
// ---------------------------------------------------------------------------
// OS-LEVEL DIVISION (read this before touching the SDL hooks)
// ---------------------------------------------------------------------------
// The SDL session-start hooks (install-precommit, preflight) ship as BOTH:
//   * POSIX-sh  .sh  — the PRIMARY path. Runs on macOS/Linux, and on Windows
//                      when the `sh`/`bash` that ships with Git for Windows is on
//                      PATH. Wired directly as `sh .kiro/hooks/<name>.sh`. Plain
//                      sh, no bun, so it still fires when bun itself is missing
//                      (its whole reason for being — reporting a missing bun).
//   * PowerShell .ps1 — the WINDOWS FALLBACK. Runs natively (no sh needed) when
//                      the .sh path cannot: Windows with `sh` NOT on PATH.
//
// This launcher is the bridge. `bun` is native on Windows (a real .exe, no shell)
// and is already a hard prerequisite of the whole harness, so it is the one
// runtime guaranteed present on every OS — the same reason eve-sdl-win-precheck.ts
// uses it. This launcher therefore decides, at session start, whether the .ps1
// fallback needs to run and NEVER spawns PowerShell on a platform that lacks it
// (no stray "command not found" noise on macOS/Linux).
//
// DECISION MATRIX:
//   not Windows                     -> exit 0 (the .sh twin already ran)
//   Windows + `sh` on PATH          -> exit 0 (the .sh twin already ran) unless
//                                      AIDLC_SDL_FORCE_PS1=1 forces the .ps1 path
//                                      (escape hatch for a present-but-broken sh)
//   Windows + `sh` NOT on PATH      -> run the .ps1 twins natively
//
// The gate (PreToolUse) and the pre-commit scan intentionally stay .sh only:
//   * eve-sdl-gate.sh runs on every tool call (hot path) — no per-call PowerShell
//     spawn; the SessionStart preflight below already surfaces missing prereqs.
//   * eve-sdl-precommit.sh is executed by GIT, which runs pre-commit hooks with
//     its OWN bundled sh even when `sh` is not on the user's PATH, so the scan
//     works on Windows regardless of this launcher.
//
// SessionStart cannot block; this ALWAYS exits 0.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32" || process.env.OS === "Windows_NT";
if (!isWindows) process.exit(0); // POSIX: the .sh hooks own this path.

// Is a POSIX `sh` on PATH (Git for Windows / MSYS / Cygwin)? If so the .sh hooks
// already ran — stay a no-op unless the operator forces the native path.
const force = !!process.env.AIDLC_SDL_FORCE_PS1;
if (!force) {
  const sh = spawnSync("sh", ["-c", "exit 0"], { stdio: "ignore", shell: true });
  const shOk = !sh.error && sh.status === 0;
  if (shOk) process.exit(0); // Windows WITH sh: the .sh twins already ran.
}

// Windows WITHOUT sh (or forced): run the PowerShell twins natively, in order.
// Prefer PowerShell 7+ (pwsh) then Windows PowerShell 5.1 (powershell).
const hooksDir = join(process.cwd(), ".kiro", "hooks");
const scripts = ["eve-sdl-install-precommit.ps1", "eve-sdl-preflight.ps1"];

function pwshExe(): string | null {
  for (const exe of ["pwsh", "powershell"]) {
    const p = spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore", shell: true });
    if (!p.error && p.status === 0) return exe;
  }
  return null;
}

const exe = pwshExe();
if (!exe) {
  // No PowerShell AND no sh — nothing can run the SDL session hooks. Say so once
  // (stdout is injected into the agent context on SessionStart) and exit 0.
  process.stdout.write(
    "[AI-DLC SDL] Neither a POSIX 'sh' nor PowerShell is available to run the SDL session hooks on this Windows host. Install Git for Windows (provides sh) or ensure PowerShell is on PATH.\n",
  );
  process.exit(0);
}

// Announce the fallback so it is obvious in the agent context that the native
// PowerShell path (.ps1) is running instead of the .sh hooks — the two print
// otherwise-identical messages, so this banner + the "(ps1 fallback)" tags on
// each .ps1 line are how you tell which path executed on Windows.
process.stdout.write(
  `[AI-DLC SDL] Windows sh->PowerShell fallback active (${force ? "forced via AIDLC_SDL_FORCE_PS1" : "no POSIX sh on PATH"}) — running the .ps1 hooks natively via ${exe}.\n`,
);

for (const s of scripts) {
  const full = join(hooksDir, s);
  if (!existsSync(full)) continue;
  // The workspace path may contain spaces (e.g. "small reg"). With shell:true,
  // node joins args into a single cmd.exe string WITHOUT auto-quoting, so an
  // unquoted -File path splits at the first space and PowerShell rejects it
  // ("does not have a '.ps1' extension"). Quote the path so it survives intact.
  spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `"${full}"`], {
    stdio: "inherit",
    shell: true,
  });
}

process.exit(0);
