// aidlc-amadeus-telemetry-reconcile.ts — the PostToolUse hook of the
// amadeus-telemetry plugin, run through core's native hook route:
//
//     aidlc engine hook amadeus-telemetry-reconcile
//
// The installed `aidlc` command resolves that name to
// <leaf>/hooks/aidlc-amadeus-telemetry-reconcile.ts (this file), loads it in its
// own process and calls run(<hook stdin>). The registration therefore names the
// installed `aidlc` command, not `bun`, which is what `aidlc doctor` expects of a
// host hook ("Native command trust").
//
// This file only forwards to the collector in the sibling tools/ folder, which
// plugin sync installs: <leaf>/tools/aidlc-sensor-amadeus-telemetry.ts --reconcile.
// The project is the folder above <leaf>, so the hook works whatever directory
// the host runs it from.
//
// Delivery: plugin sync does not install <leaf>/hooks/, so the plugin's setup step
// (hooks/setup/amadeus-telemetry-setup.ts) copies this file in, records it, and
// removes it again on --revert.
//
// NON-BLOCKING by construction: any failure (collector missing because the plugin
// was disabled, a bad audit shard, ...) is swallowed and the exit code is always 0.
// Set AMADEUS_TELEMETRY_DEBUG=1 to see failures on stderr.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COLLECTOR = "aidlc-sensor-amadeus-telemetry.ts";

export async function run(_input: string): Promise<number> {
  try {
    const hooksDir = dirname(fileURLToPath(import.meta.url));
    const leafDir = dirname(hooksDir);
    const projectDir = dirname(leafDir);
    const collector = await import(pathToFileURL(join(leafDir, "tools", COLLECTOR)).href) as {
      main?: (argv: string[]) => number | Promise<number>;
    };
    if (typeof collector.main === "function") await collector.main(["--reconcile", "--project", projectDir]);
  } catch (e) {
    if (process.env.AMADEUS_TELEMETRY_DEBUG === "1") {
      process.stderr.write(`amadeus-telemetry hook: ${(e as Error).message}\n`);
    }
  }
  return 0;
}

// Direct run (`bun <leaf>/hooks/aidlc-amadeus-telemetry-reconcile.ts`), for testing.
if (import.meta.main) process.exit(await run(""));
