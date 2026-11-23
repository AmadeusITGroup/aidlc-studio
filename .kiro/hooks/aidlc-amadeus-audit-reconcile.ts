// aidlc-amadeus-audit-reconcile.ts — the PostToolUse hook of the amadeus plugin,
// run through core's native hook route:
//
//     aidlc engine hook amadeus-audit-reconcile
//
// The installed `aidlc` command resolves that name to
// <leaf>/hooks/aidlc-amadeus-audit-reconcile.ts (this file), loads it in its own
// process and calls run(<hook stdin>). The registration therefore names the
// installed `aidlc` command, not `bun <script>`, which is what `aidlc doctor`
// expects of a host hook ("Native command trust").
//
// This file only forwards to the gate-actor reconciliation in the sibling tools/
// folder, which plugin sync installs: <leaf>/tools/amadeus-audit-view.ts. It
// stamps WHO approved each gate into audit/amadeus/gate-actor.jsonl and
// regenerates the human digest audit/amadeus/audit-trail.md. The project is the
// folder above <leaf>, so the hook works whatever directory the host runs it from.
//
// Delivery: plugin sync does not install <leaf>/hooks/, so the plugin's setup step
// (hooks/setup/amadeus-audit-hooks.ts) copies this file in, records it, and
// removes it again on --revert.
//
// NON-BLOCKING by construction: any failure (audit tool missing because the plugin
// was disabled, a bad audit shard, ...) is swallowed and the exit code is always 0.
// Set AIDLC_SDL_DEBUG=1 to see failures on stderr.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AUDIT_TOOL = "amadeus-audit-view.ts";

function debug(msg: string): void {
  if (process.env.AIDLC_SDL_DEBUG) process.stderr.write(`amadeus-audit hook: ${msg}\n`);
}

export async function run(_input: string): Promise<number> {
  try {
    const hooksDir = dirname(fileURLToPath(import.meta.url));
    const leafDir = dirname(hooksDir);
    const projectDir = dirname(leafDir);
    const tool = join(leafDir, "tools", AUDIT_TOOL);
    if (!existsSync(tool)) return 0; // plugin disabled or not composed here
    const mod = (await import(pathToFileURL(tool).href)) as { runReconcile?: (projectDir?: string) => void };
    if (typeof mod.runReconcile === "function") {
      mod.runReconcile(projectDir);
      return 0;
    }
    // An install whose audit-view predates the export (plugin sync copies tools/
    // no-clobber): run it as a script instead. `aidlc` may be a compiled
    // executable, so process.execPath is not necessarily bun.
    const bun = Bun.which("bun");
    if (!bun) {
      debug("bun not on PATH and the installed audit-view has no runReconcile export");
      return 0;
    }
    spawnSync(bun, [tool, "--reconcile", "--project", projectDir], {
      cwd: projectDir,
      stdio: ["ignore", "ignore", process.env.AIDLC_SDL_DEBUG ? "inherit" : "ignore"],
      windowsHide: true,
      timeout: 15000,
    });
  } catch (e) {
    debug((e as Error).message);
  }
  return 0;
}

// Direct run (`bun <leaf>/hooks/aidlc-amadeus-audit-reconcile.ts`), for testing.
if (import.meta.main) process.exit(await run(""));
