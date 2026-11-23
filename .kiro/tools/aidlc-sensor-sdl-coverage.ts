// aidlc-sensor-sdl-coverage.ts — BLOCKING, gate-fired SDL secret gate (sdl plugin).
//
// Bound to code-generation + build-and-test with `default_severity: blocking` and
// `fire_on: gate`. It reads the machine-readable SDL findings the stage's scan step
// wrote (sdl-sdl-findings.json, produced by `sdl-scan.ts scan`) and FAILS the
// gate — by emitting `{ "pass": false }` on stdout and exiting 0, which is the
// dispatcher's FAILED contract (status 0 + pass:false → FAILED; a non-zero exit
// is instead read as a script error and treated as an advisory PASS) — when a
// secret was found, when the scan could not run (unknown coverage != clean), or
// when the findings file is absent (the scan step did not run). opengrep (SAST)
// findings are advisory and never block; only secrets do.
//
// The gate dispatcher invokes this per declared deliverable with `--stage <slug>` and
// `--output-path <deliverable>`. Deliverables and the findings side-input share the
// stage's record dir, so the findings file is resolved from the deliverable's dir.
//
// Self-contained: a plugin tool must not depend on a sibling core tool.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SIDE_INPUT = "sdl-sdl-findings.json";

function parseFlags(argv: string[]): { outputPath?: string; stage?: string } {
  const out: { outputPath?: string; stage?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output-path") out.outputPath = argv[++i];
    else if (argv[i] === "--stage") out.stage = argv[++i];
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => (typeof x === "string" ? x : isRecord(x) && typeof x.file === "string" ? x.file : null))
        .filter((x): x is string => x !== null)
    : [];
}

// Resolve sdl-sdl-findings.json: it sits in the stage record dir alongside the
// deliverable the gate dispatched. Check the deliverable's dir, then one level up.
function resolveFindings(outputPath: string): string | null {
  const d = dirname(outputPath);
  for (const cand of [join(d, SIDE_INPUT), join(dirname(d), SIDE_INPUT)]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function fail(msg: string, detail: Record<string, unknown>): never {
  // A gate FAILURE is signalled by `{ "pass": false }` on stdout with exit code
  // 0 — NOT by a non-zero exit. The dispatcher decides the verdict from the JSON
  // `pass` field (status 0 + pass:false → FAILED); ANY non-zero exit is
  // classified `script-error: exit-<n>` and treated as an advisory PASS, which
  // would let a secret finding through the blocking gate. Exit 0 so the block lands.
  process.stdout.write(`${JSON.stringify({ pass: false, ...detail })}\n`);
  process.stderr.write(`aidlc-sensor-sdl-coverage: ${msg}\n`);
  process.exit(0);
}

function pass(detail: Record<string, unknown>): never {
  process.stdout.write(`${JSON.stringify({ pass: true, ...detail })}\n`);
  process.exit(0);
}

// Exported `main(argv)` is the entry contract the compiled engine's sensor
// worker (`aidlc engine __sensor-script-file`) requires: it imports this module
// and calls the exported `main` with the dispatcher's args. Parse that injected
// `argv`, never `process.argv` (under the worker, `process.argv` is the engine
// binary's argv, not the sensor's flags). Direct `bun` runs pass
// `process.argv.slice(2)` at the entry point below.
export function main(argv: string[]): void {
  const { outputPath } = parseFlags(argv);
  if (!outputPath) {
    process.stderr.write("aidlc-sensor-sdl-coverage: --output-path is required\n");
    process.exit(1);
  }

  const findingsPath = resolveFindings(outputPath);
  if (!findingsPath) {
    // The SDL scan step did not run for this stage — coverage unknown, so block.
    fail("SDL scan side-input (sdl-sdl-findings.json) not found — run the SDL scan step", {
      findings_count: 1,
      sdl_available: false,
      secrets: [],
    });
  }

  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(readFileSync(findingsPath, "utf-8"));
    if (!isRecord(raw)) throw new Error("findings JSON is not an object");
    parsed = raw;
  } catch (err) {
    fail(`failed to parse ${findingsPath}: ${err instanceof Error ? err.message : String(err)}`, {
      findings_count: 1,
      sdl_available: false,
      secrets: [],
    });
  }

  const sdlAvailable = parsed.sdl_available === true;
  const secrets = stringList(parsed.secrets_findings).sort();

  if (!sdlAvailable) {
    fail("SDL secret scan could not run (eve absent/unauthenticated) — coverage unknown", {
      findings_count: 1,
      sdl_available: false,
      secrets,
    });
  }
  if (secrets.length > 0) {
    fail(`secret finding(s) in delivered source: ${secrets.join(", ")}`, {
      findings_count: secrets.length,
      sdl_available: true,
      secrets,
    });
  }
  pass({ findings_count: 0, sdl_available: true, secrets: [] });
}

if (import.meta.main) main(process.argv.slice(2));
