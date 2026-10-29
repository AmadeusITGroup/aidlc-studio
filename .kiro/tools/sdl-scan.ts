// sdl-scan.ts — Amadeus SDL scanner tool (sdl plugin).
//
// Security scanning is packaged as a plugin tool + a BLOCKING sensor rather
// than baked into the DevSecOps agent persona or a host git hook. This tool runs the EVE scanners LOCALLY ONLY — over a unit's
// (or the aggregate) source — and writes the machine-readable side-input the
// BLOCKING gate-fired `sdl-coverage` sensor reads. The tool itself never
// blocks; the sensor is what fails the stage approval gate on a secret finding.
//
// Scanners run (local only — no CI wiring in this plugin):
//   * secrets  — offline, no auth needed. A hit BLOCKS the gate.
//   * opengrep — SAST, needs AMAIISDOM auth. Advisory only, never blocks.
//
// Subcommand:
//   scan --source-manifest <path> [--out <json>]
//       Run `eve scan secrets` (offline) and `eve scan opengrep` (SAST, advisory) over
//       the code files listed in a source-manifest.json, and write
//       sdl-sdl-findings.json for the sensor. When eve is absent/unauthenticated it
//       records sdl_available:false (unknown, not clean) so the gate sensor fails.
//
// Self-contained by design — no dependency on a sibling core tool.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

const FINDINGS_FILENAME = "sdl-sdl-findings.json";
const OPENGREP_TIMEOUT_MS = Number(process.env.SDL_OPENGREP_TIMEOUT_MS ?? 60000);

// ---- eve output classification -----------------------------------------------

export type Verdict = "clean" | "finding" | "unavailable" | "inconclusive";

const CLEAN_RE =
  /no issue found|no issues found|no secrets found|no findings|0 findings|no results|nothing to scan|no problems found|no vulnerabilities found|no vulnerabilities/i;
const ERROR_RE =
  /amaiisdom (username|password)|user prompt disabled|unknown answer|authentication failed|authentication: *failure|unauthori[sz]ed|not authenticated|unable to connect|could not connect|connection refused|network (error|unreachable)|timed out|login failed/i;
const FINDING_RE = /secret|detected|finding|vulnerab/i;

export function classify(output: string, code: number): Verdict {
  if (output.trim().length === 0) return "inconclusive";
  if (CLEAN_RE.test(output)) return "clean";
  if (ERROR_RE.test(output)) return "unavailable";
  if (code !== 0) return "finding";
  if (FINDING_RE.test(output)) return "finding";
  return "clean";
}

const CODE_EXT =
  /\.(py|ts|tsx|js|jsx|mjs|cjs|java|go|rb|cs|kt|kts|scala|php|c|cc|cpp|h|hpp|html|htm)$/;
export function isCode(path: string): boolean {
  return CODE_EXT.test(path);
}

// Flatten a source-manifest into a code-file list. The canonical shape is the
// engine's strict v1 companion — { stage, unit, version, writes: [{ path, repo? }] }
// (core/tools/aidlc-lib.ts UnitSourceManifest) — so `writes[].path` is the primary
// source. Also tolerated: a plain array of path strings (the aggregate the
// build-and-test step writes) and objects carrying files/paths/sources/created/
// modified arrays of strings-or-{path|file} objects. Deletions are not distinguished
// in the v1 schema; files absent on disk are skipped at scan time, and a `deleted`
// key (a legacy shape) is never harvested here.
export function resolveFiles(manifest: unknown): string[] {
  const out = new Set<string>();
  const push = (v: unknown): void => {
    if (typeof v === "string") {
      out.add(v);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.path === "string") out.add(o.path);
      else if (typeof o.file === "string") out.add(o.file);
    }
  };
  if (Array.isArray(manifest)) {
    manifest.forEach(push);
  } else if (manifest && typeof manifest === "object") {
    const m = manifest as Record<string, unknown>;
    for (const key of ["writes", "files", "paths", "sources", "created", "modified"]) {
      const v = m[key];
      if (Array.isArray(v)) v.forEach(push);
    }
  }
  return [...out].filter(isCode).sort();
}

function evePresent(): boolean {
  const r = spawnSync("eve", ["--version"], { encoding: "utf8" });
  // ENOENT => not on PATH. Any other outcome (even a non-zero exit) means the
  // binary exists.
  return !(r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT");
}

function runEve(args: string[], timeoutMs?: number): { out: string; code: number; timedOut: boolean } {
  const r = spawnSync("eve", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const timedOut = r.error != null && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const code = typeof r.status === "number" ? r.status : timedOut ? 124 : 1;
  return { out, code, timedOut };
}

interface Findings {
  sdl_available: boolean;
  opengrep_available: boolean;
  scanned: number;
  secrets_findings: string[];
  opengrep_findings: string[];
}

// LOCAL ONLY: both scanners run on the developer's machine against the files in
// the manifest. Neither is wired into CI by this plugin — that is explicitly out
// of scope per the "opengrep and secret scanner run in local" requirement.
function scanFiles(files: string[]): Findings {
  if (!evePresent()) {
    return {
      sdl_available: false,
      opengrep_available: false,
      scanned: 0,
      secrets_findings: [],
      opengrep_findings: [],
    };
  }

  let anySecretsUnavailable = false;
  let anyOpengrepUnavailable = false;
  const secrets_findings: string[] = [];
  const opengrep_findings: string[] = [];
  let scanned = 0;

  for (const f of files) {
    if (!existsSync(f)) continue;
    scanned++;

    const s = runEve(["scan", "secrets", "run", f, "--mode", "raw_file"]);
    switch (classify(s.out, s.code)) {
      case "finding":
        secrets_findings.push(f);
        break;
      case "unavailable":
      case "inconclusive":
        anySecretsUnavailable = true;
        break;
    }

    const o = runEve(["scan", "opengrep", f], OPENGREP_TIMEOUT_MS);
    const ov = o.timedOut ? "unavailable" : classify(o.out, o.code);
    switch (ov) {
      case "finding":
        opengrep_findings.push(f);
        break;
      case "unavailable":
      case "inconclusive":
        anyOpengrepUnavailable = true;
        break;
    }
  }

  return {
    sdl_available: !anySecretsUnavailable,
    opengrep_available: !anyOpengrepUnavailable,
    scanned,
    secrets_findings: secrets_findings.sort(),
    opengrep_findings: opengrep_findings.sort(),
  };
}

// ---- subcommands -------------------------------------------------------------

function cmdScan(argv: string[]): void {
  let manifestPath = "";
  let outPath = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source-manifest") manifestPath = argv[++i];
    else if (argv[i] === "--out") outPath = argv[++i];
  }
  if (!manifestPath) {
    process.stderr.write("sdl-scan scan: --source-manifest <path> is required\n");
    process.exit(2);
  }
  const out = outPath || join(dirname(manifestPath), FINDINGS_FILENAME);

  let files: string[] = [];
  if (existsSync(manifestPath)) {
    try {
      files = resolveFiles(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch {
      files = [];
    }
  }

  const findings = scanFiles(files);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(findings, null, 2)}\n`);
  process.stdout.write(
    `sdl-scan: wrote ${out} — scanned ${findings.scanned}, ` +
      `secrets ${findings.secrets_findings.length}, opengrep ${findings.opengrep_findings.length}, ` +
      `sdl_available=${findings.sdl_available}, opengrep_available=${findings.opengrep_available}\n`,
  );
  // Non-blocking tool: always exit 0. It only writes the findings side-input; the
  // blocking control is the gate-fired `sdl-coverage` sensor that reads it.
  process.exit(0);
}

function main(): void {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "scan") return cmdScan(rest);
  process.stderr.write("usage: sdl-scan scan --source-manifest <path> [--out <json>]\n");
  process.exit(2);
}

if (import.meta.main) main();
