#!/usr/bin/env bun
// aidlc-sensor-amadeus-telemetry.ts — per-intent scope telemetry collector
// (amadeus-telemetry plugin). Updates incrementally: each run reads only what was
// appended to the audit since the previous run, for only the intents that can
// have changed, and rewrites only the entries whose values changed.
//
// One script, two modes. It runs as a script (`bun <file> ...`), or is loaded by
// another process that calls its exported main(argv), which returns an exit code
// instead of exiting:
//
//   sensor       The core sensor dispatcher runs it at gate-start for the stages
//                the plugin's overlays bind (requirements-analysis,
//                build-and-test), once per declared deliverable:
//                  bun <leaf>/tools/aidlc-sensor-amadeus-telemetry.ts --stage <slug> --output-path <abs>
//                Under the installed `aidlc` command the dispatcher loads it with
//                `aidlc engine __sensor-script-file` and calls main(argv) instead.
//                It updates the intent that owns --output-path (plus the active
//                intent), prints {"pass":true,"findings_count":0} and ALWAYS
//                returns 0, so it can never fail or block a gate.
//
//   --reconcile  The PostToolUse hook (<leaf>/hooks/aidlc-amadeus-telemetry-reconcile.ts,
//                run by `aidlc engine hook amadeus-telemetry-reconcile`, calls
//                main(["--reconcile", "--project", <dir>])), and the plugin's
//                launcher at install (as a script). Updates the active intent,
//                the previously active one, and any intent whose entry in a
//                space's intents.json changed. Silent, always returns 0.
//                  --full     also stat-check every intent (done automatically
//                             when a space's last full check is over 24 h old)
//                  --rebuild  ignore the cursors and recompute every intent
//                  --verbose  print a one-line summary of the run
//
// Output, inside each intent record aidlc/spaces/<space>/intents/<dir>/amadeus-telemetry/:
//   telemetry.json  { schema_version, plugin, updated_at, last_update,
//                     "intent": { "intent_identified", "harness", "scope_used", ..., errors, signals, usage,
//                       "phases": { "<phase>": { status, duration, human_wait, started_at, completed_at, errors, signals, usage,
//                         "stages": { "<stage>": { status, duration, human_wait, started_at, completed_at, units,
//                           errors, signals, usage } } } } } }
//   telemetry.md    the readable report, rendered from telemetry.json by
//                   amadeus-telemetry-report.ts (the code form of
//                   report-instructions.md). Rewritten whenever telemetry.json is,
//                   and restored if it goes missing or is edited.
//   .cursor.json    this intent's delta cursor (machine-local; the folder's own
//                   .gitignore keeps it out of commits)
// Per space, aidlc/spaces/<space>/intents/.aidlc-amadeus-telemetry.json holds the
// registry snapshot, the last active intent and the last full check, and
// .aidlc-amadeus-telemetry.lock serialises runs. Both match core's own
// `aidlc/spaces/*/intents/.aidlc-*` ignore rule.
//
// Phases and stages
//   * The plan (every phase, and every stage the scope runs, in workflow order)
//     comes from the record's aidlc-state.md "Stage Progress" list, re-parsed only
//     when that file changes. Stages that have run but are no longer in the plan
//     are kept.
//   * Status, times and human wait come from the audit:
//       stage   pending | in-flight | awaiting-approval | revising | completed | skipped
//               (last STAGE_* event; a BACKWARD jump returns later stages to pending)
//       phase   pending | in-flight | completed | skipped (from its stages)
//   * duration    first start to final completion, as text ("6m 38s"); null until
//                 completed.
//   * human_wait  time from a question, decision or open gate until every one of
//                 them was answered, as text; null until completed. A phase's
//                 value is the sum of its stages'.
//   * units       distinct units of work named on the stage's audit events (0 when
//                 the stage does not run per unit).
//   * Isolated single-stage attempts (Workflow: single-stage:<slug>) are ignored,
//     as core ignores them for stage boundaries.
//
// Errors and signals
//   * errors   { total, by_kind, by_source }, one count per audit event, live while
//              the stage runs. Kinds (source in brackets):
//                tool_error           ERROR_LOGGED (Tool)
//                sensor_failed        SENSOR_FAILED (Sensor ID)
//                sensor_script_error  SENSOR_PASSED with a `script-error…` Note (Sensor ID)
//                sensor_timeout       SENSOR_BUDGET_OVERRIDE (Sensor ID)
//                run_failure          BOLT_FAILED (Failed Bolt), SWARM_UNIT_FAILED (Unit name)
//                guard_block          PLAN_APPROVAL_BLOCKED, REVIEWER_SCOPE_BLOCKED,
//                                     REVIEW_FREEZE_BLOCKED (plan-approval, reviewer-scope,
//                                     review-freeze)
//   * signals  { <kind>: count }, reported but not counted as errors:
//                sensor_unavailable   SENSOR_PASSED with a `tool-unavailable` Note
//                blocking_override    STAGE_AWAITING_APPROVAL with Blocking Sensor Override: true
//                rejection            GATE_REJECTED
//   * Each event counts for its own Stage / Stage slug, else the stage running at
//     that moment, else the intent's `unassigned` count. A phase's counts are the
//     sum of its stages'; the intent's cover every event.
//   * This plugin's own sensor (Sensor ID amadeus-telemetry) is never counted.
//
// Credits (Kiro IDE, Kiro CLI, and VS Code on the copilot harness)
//   * Kiro records Kiro credits per turn (one user prompt and everything the agent
//     did for it), not tokens, in its own session files under
//     <kiro home>/sessions, where <kiro home> is $KIRO_HOME or ~/.kiro
//     (%USERPROFILE%\.kiro on Windows). Only the numbers are copied:
//       sess_<id>  <hash>/sess_<id>/messages.jsonl (Kiro IDE, and Kiro CLI --v3):
//                  only its `usage_summary` lines are read.
//                    credits  sum of promptTurnSummaries[].usage with unit "credit"
//                    ended    the line's timestamp; started = ended - elapsedTime
//       <uuid>     cli/<uuid>.json (Kiro CLI's default engine), re-read when it
//                  changes: session_state.conversation_metadata.user_turn_metadatas[]
//                    credits  sum of metering_usage[].value with unit "credit"
//                    ended    end_timestamp; started = ended - turn_duration
//   * VS Code records GitHub Copilot credits per request (the same unit as a
//     turn) in each chat session's op log, under <user dir>/workspaceStorage/<hash>/
//     chatSessions/<uuid>.jsonl (or globalStorage/emptyWindowChatSessions/), where
//     <user dir> is %APPDATA%\Code\User, ~/Library/Application Support/Code/User or
//     ~/.config/Code/User (also Code - Insiders, VSCODE_PORTABLE, or
//     AMADEUS_TELEMETRY_VSCODE_USER_DIR alone). Re-read when it changes; only the
//     lines that touch a request's fields are parsed (see parseVscodeSession):
//                    credits  the request's copilotCredits (final once it ended)
//                    started  timestamp; ended = modelState.completedAt
//     A request that has not ended (still running, waiting for input, or left open)
//     counts with its credits so far, ending at the log's last write, and is
//     updated on every read until it ends.
//   * Sessions: every `Session` id on the intent's audit events (HUMAN_TURN,
//     DECISION_RECORDED, PLAN_APPROVAL_RECORDED, ...); else the harness's session
//     bindings aidlc/.aidlc-sessions/<id>.binding.json that name the intent. On
//     every harness the id is the host's own session id (Kiro's, or VS Code's chat
//     session id). Ids with no session file on this machine are skipped.
//   * source is kiro-ide, kiro-cli or vscode, from the install's
//     tools/data/harness.json (copilot means vscode). unit is kiro-credit for Kiro,
//     copilot-credit for VS Code; turns in another unit are never added together.
//   * A turn counts for the intent when it overlaps the workflow (WORKFLOW_STARTED
//     to WORKFLOW_COMPLETED). It counts, whole, for the stage it spent the most
//     time in, using the same "stage open at that moment" timeline as errors.
//     When most of it fell outside any stage (before the workflow started, after
//     it completed, or between stages) it counts only at intent level, in
//     `unassigned`. A phase's credits are the sum of its stages'.
//   * usage   stage/phase { credits, credit_type }; intent { source, unit, credit_type,
//             credits, unassigned, split_turns,
//             turns: [{ session, started_at, ended_at, credits, stage }] }.
//             credit_type is "kiro" (unit kiro-credit) or "copilot" (copilot-credit).
//   * harness  intent.harness { name, product } of the install that writes the file
//             (tools/data/harness.json), null outside an install.
//             null when no session of the intent is readable here and no turns
//             were recorded before.
//   * The turns list is the ledger. Turns of a session this machine cannot read
//     (another clone's, or a deleted session) are carried over from the existing
//     telemetry.json, so clones converge instead of overwriting each other.
//   * Kiro writes a turn's credits when the turn ends (Kiro IDE: after its last
//     hook), so a Kiro turn is counted by the first run after it ends. A VS Code
//     request is counted as it runs, and settled by the first run after it ends.
//   * AIDLC_DISABLE_USAGE_TRACKING=1 (core's switch) turns this off: no session
//     file is read and usage is null.
//
// Delta model
//   * Intent cursor (<record>/amadeus-telemetry/.cursor.json): a byte offset into
//     every audit shard, a compact timeline of the audit events the output needs
//     (workflow, phase, stage, jump, human-wait, error and signal events, and
//     the Session ids on them), units seen per stage, the parsed plan with the
//     state file's size/mtime, how far each linked session file (Kiro's or VS
//     Code's) was read with the turns read from it, the hash of the telemetry.json
//     it last wrote and the stat of the telemetry.md it last wrote.
//   * Session files: an unchanged file (same size and mtime) is not opened. A grown
//     messages.jsonl is read from its offset, complete lines only; one that shrank
//     or whose bytes before the offset changed is read again from 0. A changed
//     Kiro CLI <uuid>.json is read whole (Kiro rewrites it), and so is a changed VS
//     Code chatSessions/<uuid>.jsonl (only its request-level lines are parsed).
//   * Candidates: a run looks only at the intents above, space by space. A space's
//     intents.json is re-read only when its size or mtime changed, and then only
//     entries whose snapshot differs become candidates. A space with nothing to do
//     is skipped without taking its lock.
//   * Shards: an unchanged shard (same size and mtime) is not opened. A grown shard
//     is read from its offset, and only complete blocks (each ends with a `---`
//     line) are consumed; a block still being written is left for the next run.
//   * Output: an intent's telemetry.json and telemetry.md are written only when its
//     values changed. Nothing is written when nothing changed.
//   * Self-healing, per intent: a shard that shrank, disappeared, or whose bytes
//     just before the offset changed (rewrite, line-ending conversion), a missing
//     or unreadable cursor, or a telemetry.json whose hash no longer matches the
//     cursor rebuilds that intent from offset 0. A missing space index triggers a
//     full check of that space. A rebuild is the same delta code started from 0.
//   * Lock, per space. A run that finds another in progress skips that space; its
//     cursors have not advanced, so the next run reads those bytes.
//   * Upgrade: the workspace-level aidlc/amadeus-telemetry/ folder of earlier
//     versions is removed (only the files this plugin wrote there).
//
// Sources, per intent record aidlc/spaces/<space>/intents/<dir>/:
//   intent_identified  intents.json `slug` (fallback: record dir minus its date prefix)
//   scope_used         last SCOPE_CHANGED `New Scope`, else WORKFLOW_STARTED.Scope
//                      (the audit is the source of truth); fallback aidlc-state.md
//                      `Scope`, then intents.json `scope`
//   request            project-description.json (fallback WORKFLOW_STARTED.Request)
//
// Rules: no import of core tools (only the sibling plugin module that renders the
// report); writes only to each record's amadeus-telemetry/ folder and the per-space
// .aidlc-amadeus-telemetry.* files; reads Kiro's and VS Code's session logs but
// never writes them; AMADEUS_TELEMETRY_DISABLE=1 makes every mode a no-op; silent
// unless AMADEUS_TELEMETRY_DEBUG=1.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { REPORT_VERSION, renderReport } from "./amadeus-telemetry-report.ts";

const PLUGIN = "amadeus-telemetry";
// 3: one telemetry.json per intent, inside the intent record. 4: error and signal
// counts. 5: credits (usage). 6: the harness, and credit_type on every usage. An
// older file rebuilds that intent once.
const OUTPUT_SCHEMA = 6;
// 3: per-intent cursor. 4: the timeline keeps error and signal events. 5: the
// timeline keeps Session ids, and the cursor holds Kiro session file offsets.
// A cursor from an older schema rebuilds that intent once.
const CURSOR_SCHEMA = 5;
const INDEX_SCHEMA = 1;
const OUTPUT_DIR = "amadeus-telemetry"; // inside <record>/
const OUTPUT_FILE = "telemetry.json";
const REPORT_FILE = "telemetry.md";
const CURSOR_FILE = ".cursor.json";
// Per space, in aidlc/spaces/<space>/intents/ (covered by core's `.aidlc-*` ignore rule).
const INDEX_FILE = ".aidlc-amadeus-telemetry.json";
const LOCK_FILE = ".aidlc-amadeus-telemetry.lock";
const GITIGNORE =
  "# amadeus-telemetry machine-local delta cursor. telemetry.json and telemetry.md may be committed.\n" +
  ".cursor.json\n*.tmp\n";
// The workspace-level folder used before schema 3, and the .gitignore written there.
const LEGACY_DIR = ["aidlc", "amadeus-telemetry"];
const LEGACY_FILES = ["telemetry.json", ".cursor.json", ".lock"];
const LEGACY_GITIGNORE =
  "# amadeus-telemetry machine-local state (delta cursor, lock). telemetry.json itself may be committed.\n" +
  ".cursor.json\n.lock\n*.tmp\n";
// Bytes hashed just before a shard offset, to detect a shard rewritten underneath it.
const ANCHOR_BYTES = 64;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 60_000;
const PHASE_ORDER = ["initialization", "ideation", "inception", "construction", "operation"];
// Stage status after each stage lifecycle event.
const STAGE_STATUS: Record<string, StageStatus> = {
  STAGE_STARTED: "in-flight",
  STAGE_AWAITING_APPROVAL: "awaiting-approval",
  STAGE_REVISING: "revising",
  STAGE_COMPLETED: "completed",
  STAGE_SKIPPED: "skipped",
};
// Status fallback from the state file's checkbox, for a stage with no audit events.
const MARK_STATUS: Record<string, StageStatus> = {
  x: "completed",
  "-": "in-flight",
  "?": "awaiting-approval",
  R: "revising",
  S: "skipped",
};
// A human is being waited on from the first opener until every opener is answered.
const WAIT_OPENERS = new Set(["STAGE_AWAITING_APPROVAL", "DECISION_RECORDED"]);
const WAIT_CLOSERS = new Set([
  "GATE_APPROVED",
  "GATE_REJECTED",
  "QUESTION_ANSWERED",
  "PLAN_APPROVAL_RECORDED",
  "SUMMARY_CONFIRMATION_RECORDED",
  "VERIFICATION_COMMAND_RECORDED",
]);
// Any open wait ends when the workflow moves on.
const WAIT_BOUNDARIES = new Set(["STAGE_STARTED", "STAGE_COMPLETED", "STAGE_SKIPPED", "STAGE_JUMPED", "WORKFLOW_COMPLETED"]);
// Guard-block events, and the guard each one names as its error source.
const GUARD_BLOCKS: Record<string, string> = {
  PLAN_APPROVAL_BLOCKED: "plan-approval",
  REVIEWER_SCOPE_BLOCKED: "reviewer-scope",
  REVIEW_FREEZE_BLOCKED: "review-freeze",
};
const SENSOR_FIELDS = ["Sensor ID", "Stage slug"];
// Audit events kept in the cursor timeline, with the fields each one needs
// (every other kept event keeps only Stage). Every kept event also keeps
// SESSION_FIELD when it has one.
const KEPT_FIELDS: Record<string, string[]> = {
  WORKFLOW_STARTED: ["Scope", "Request"],
  SCOPE_CHANGED: ["Old Scope", "New Scope"],
  WORKFLOW_COMPLETED: [],
  PHASE_STARTED: ["Phase"],
  PHASE_SKIPPED: ["Phase"],
  PHASE_COMPLETED: ["From phase"],
  STAGE_JUMPED: ["Direction", "Target"],
  STAGE_AWAITING_APPROVAL: ["Stage", "Blocking Sensor Override"],
  // Errors and signals (see classify).
  ERROR_LOGGED: ["Tool", "Stage"],
  SENSOR_PASSED: [...SENSOR_FIELDS, "Note"], // kept only when it has a Note
  SENSOR_FAILED: SENSOR_FIELDS,
  SENSOR_BUDGET_OVERRIDE: SENSOR_FIELDS,
  BOLT_FAILED: ["Failed Bolt", "Stage"],
  SWARM_UNIT_FAILED: ["Unit name", "Stage"],
  ...Object.fromEntries(Object.keys(GUARD_BLOCKS).map((e) => [e, ["Stage"]])),
  // Kept only when it names a Session: links the intent to the harness session.
  HUMAN_TURN: [],
};
const TIMELINE_EVENTS = new Set([...Object.keys(KEPT_FIELDS), ...Object.keys(STAGE_STATUS), ...WAIT_OPENERS, ...WAIT_CLOSERS]);
// Every kept event also keeps the harness session it names, if any (credits).
const SESSION_FIELD = "Session";

// --- credits (Kiro IDE, Kiro CLI, VS Code) --------------------------------------------
// Kiro keeps two session stores under <kiro home>/sessions, told apart by the id:
//   sess_<id>  <hash>/sess_<id>/messages.jsonl  Kiro IDE, and Kiro CLI's V3 engine (--v3)
//   <uuid>     cli/<uuid>.json                  Kiro CLI's default engine
// VS Code (copilot harness) keeps one op log per chat session, also named by a uuid:
//   <uuid>     <user dir>/workspaceStorage/<hash>/chatSessions/<uuid>.jsonl
// A uuid is therefore routed by the install's harness (see sessionReader).
const SESS_ID_RE = /^sess_[A-Za-z0-9-]{1,100}$/;
const CLI_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A session id credits can be read for: a Kiro sess_ id, or a uuid (Kiro CLI or VS Code).
const isUsageSessionId = (sid: string): boolean => SESS_ID_RE.test(sid) || CLI_ID_RE.test(sid);
const KIRO_SESSION_LOG = "messages.jsonl";
const KIRO_CLI_DIR = "cli";
// Only these lines of a session log are parsed; the marker is checked before JSON.parse.
const USAGE_MARKER = '"usage_summary"';
// The unit each source's credits are in. Only credits in the same unit are added up.
const USAGE_UNITS: Record<string, string> = {
  "kiro-ide": "kiro-credit",
  "kiro-cli": "kiro-credit",
  vscode: "copilot-credit",
};
const USAGE_SOURCES = new Set(Object.keys(USAGE_UNITS));
// Which credits a unit is, written as `credit_type` on every usage object.
const CREDIT_TYPES: Record<string, string> = { "kiro-credit": "kiro", "copilot-credit": "copilot" };
// Product names of the harnesses, when an install's harness.json has no productName.
const HARNESS_PRODUCTS: Record<string, string> = { "kiro-ide": "Kiro IDE", kiro: "Kiro CLI", copilot: "GitHub Copilot" };
// VS Code: the products whose user dirs are searched, the folders a chat session log
// can be in (per workspace, or a window with no folder open), and the log extension.
const VSCODE_PRODUCTS = ["Code", "Code - Insiders"];
const VSCODE_SESSION_DIRS = new Set(["chatSessions", "emptyWindowChatSessions"]);
const VSCODE_SESSION_EXT = ".jsonl";
// A VS Code session log line is JSON-parsed only when its first VSCODE_HEAD
// characters show it can carry request credits or times: the snapshot (kind 0), a
// change to the requests array or one request, or a set of one of these fields.
// Everything else (prompts, responses, tool output) is skipped unparsed.
const VSCODE_HEAD = 200;
const VSCODE_SNAPSHOT_RE = /^\{"kind":0[,}]/;
const VSCODE_REQUESTS_RE = /"k":\["requests"(?:,\d+)?\]/;
const VSCODE_FIELD_RE = /"k":\["requests",\d+,"(?:copilotCredits|modelState|timestamp)"/;
// Credits are kept to 4 decimals and summed as integers of 1/10000 credit, so every
// clone computes the same totals from the same turns.
const CREDIT_SCALE = 10_000;
// A session log is read in chunks of this size; only complete lines are consumed.
const LOG_CHUNK = 4 * 1024 * 1024;
// Fields that name units of work (unit-major UNIT_* events, swarm events, and any
// stage event tagged with a Unit).
const UNIT_FIELDS = ["Unit", "Unit name", "Unit names"];
// End of an audit block: core terminates every block with a `---` line.
const BLOCK_END = /\r?\n---[ \t]*\r?\n/g;
// Project-relative record path. Rejects dot dirs and anything that could escape.
const KEY_RE = /^aidlc\/spaces\/[^/\\.][^/\\]*\/intents\/[^/\\.][^/\\]*$/;

// The arguments of the current run, set by main().
let argv: string[] = [];
const DEBUG = process.env.AMADEUS_TELEMETRY_DEBUG === "1";

// --- small helpers ------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function debug(msg: string): void {
  if (DEBUG) process.stderr.write(`${PLUGIN}: ${msg}\n`);
}
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function readBuf(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
function readText(path: string): string | null {
  const b = readBuf(path);
  return b === null ? null : b.toString("utf8").replace(/^\uFEFF/, "");
}
function readJson<T>(path: string): T | null {
  const raw = readText(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
function statOf(path: string): { size: number; mtimeMs: number } | null {
  try {
    const st = statSync(path);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
// `**Field**:` value from an audit block or the state file, case-insensitive on the name.
function blockField(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const v = block.match(new RegExp(`^\\s*(?:- )?\\*\\*${escaped}\\*\\*:\\s*(.*?)\\s*$`, "im"))?.[1];
  return v === undefined || v === "" ? null : v;
}
// Write-then-rename so a reader never sees a torn file.
function writeAtomic(path: string, body: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  } catch {
    rmSync(tmp, { force: true });
    writeFileSync(path, body);
  }
}

// --- project / record resolution ----------------------------------------------------
// --project, then the env the dispatcher/hook sets, then the nearest ancestor of cwd
// that carries a workflow (aidlc/spaces).
function resolveProject(): string | null {
  const explicit = arg("--project") ?? process.env.AIDLC_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR;
  if (explicit) {
    const p = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
    return existsSync(join(p, "aidlc", "spaces")) ? p : null;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "aidlc", "spaces"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const recordKey = (space: string, dir: string): string => `aidlc/spaces/${space}/intents/${dir}`;
const spaceOf = (key: string): string => key.split("/")[2] ?? "";
const isValidKey = (key: string): boolean => KEY_RE.test(key);
const isRecordDir = (dir: string): boolean => existsSync(join(dir, "aidlc-state.md")) || existsSync(join(dir, "audit"));

// The record that owns a path, from its segments (not path.relative, so an 8.3 short
// name or a different drive-letter spelling of the same project still matches).
function keyFromPath(p: string): string | null {
  const parts = p.replace(/\\/g, "/").split("/");
  for (let i = parts.length - 5; i >= 0; i--) {
    if (parts[i] === "aidlc" && parts[i + 1] === "spaces" && parts[i + 3] === "intents") {
      const key = recordKey(parts[i + 2], parts[i + 4]);
      return isValidKey(key) ? key : null;
    }
  }
  return null;
}

// --- cursor ---------------------------------------------------------------------------
type Pos = { at: string; shard: string; pos: number };
// One kept audit event. `f` holds only the fields KEPT_FIELDS (or Stage) names.
type TimelineEvent = Pos & { e: string; f?: Record<string, string> };
type ShardCursor = { offset: number; size: number; mtimeMs: number; anchor: string };
type RegSnapshot = { slug: string | null; uuid: string | null; status: string | null; scope: string | null };
type StageStatus = "pending" | "in-flight" | "awaiting-approval" | "revising" | "completed" | "skipped";
// One stage line of aidlc-state.md "Stage Progress": checkbox mark and plan action.
type PlanStage = { slug: string; mark: string; execute: boolean };
type PlanPhase = { phase: string; stages: PlanStage[] };
type StateCache = {
  size: number;
  mtimeMs: number;
  plan: PlanPhase[] | null;
  scope: string | null;
  start: string | null;
  project: string | null;
  status: string | null;
};
type FileStat = { size: number; mtimeMs: number };
// One completed Kiro turn: an id unique in its session, its time window and credits.
type SessionTurn = { id: string; started_at: string; ended_at: string; credits: number };
// One Kiro session read so far: where it is, how far it was read and its turns that
// ended after the workflow started. A messages.jsonl log keeps a byte offset (with
// size, mtime and a hash of the 64 bytes before it); a Kiro CLI <uuid>.json is
// rewritten by Kiro after each turn, so it is re-read whole when its size or mtime
// changes (offset = its size, no anchor).
type SessionCursor = ShardCursor & { path: string; turns: SessionTurn[] };
// One intent's cursor, in <record>/amadeus-telemetry/.cursor.json.
type RecordCursor = {
  schema_version: number;
  output_sha256: string | null; // telemetry.json as last written
  report: (FileStat & { version: number }) | null; // telemetry.md as last written
  reg: RegSnapshot | null;
  request?: string;
  state: StateCache | null;
  shards: Record<string, ShardCursor>;
  events: TimelineEvent[];
  units: Record<string, string[]>;
  sessions: Record<string, SessionCursor>; // Kiro session id -> what was read from it
};
// One space's index, in aidlc/spaces/<space>/intents/.aidlc-amadeus-telemetry.json.
type SpaceIndex = {
  schema_version: number;
  registry: FileStat | null; // intents.json as last read
  reg: Record<string, RegSnapshot>; // its entries, by record dir
  active: string | null; // last active record dir
  last_sweep_at: string | null;
};

const emptyRecord = (): RecordCursor => ({
  schema_version: CURSOR_SCHEMA,
  output_sha256: null,
  report: null,
  reg: null,
  state: null,
  shards: {},
  events: [],
  units: {},
  sessions: {},
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Any shape problem means "start over" rather than a crash on every run.
function readCursor(path: string): RecordCursor | null {
  const rc = readJson<RecordCursor>(path);
  if (!isPlainObject(rc) || rc.schema_version !== CURSOR_SCHEMA) return null;
  if (!isPlainObject(rc.shards) || !isPlainObject(rc.units) || !Array.isArray(rc.events)) return null;
  if (rc.state !== null && !isPlainObject(rc.state)) return null;
  if (!isPlainObject(rc.sessions) || Object.values(rc.sessions).some((s) => !isPlainObject(s) || !Array.isArray(s.turns))) return null;
  return rc;
}

function readIndex(path: string): SpaceIndex | null {
  const ix = readJson<SpaceIndex>(path);
  if (!isPlainObject(ix) || ix.schema_version !== INDEX_SCHEMA || !isPlainObject(ix.reg)) return null;
  return ix;
}

// Same order a full parse gives: timestamp, then shard filename, then position.
function cmpPos(a: Pos, b: Pos): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.shard !== b.shard) return a.shard < b.shard ? -1 : 1;
  return a.pos - b.pos;
}

// --- audit delta ----------------------------------------------------------------------
type SyncStats = { shardsRead: number; bytesRead: number; recordsRebuilt: number; logsRead: number; logBytesRead: number };

function readRange(path: string, from: number, to: number): Buffer {
  const len = Math.max(0, to - from);
  const buf = Buffer.alloc(len);
  if (len === 0) return buf;
  const fd = openSync(path, "r");
  try {
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, from + got);
      if (n === 0) break;
      got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

function anchorAt(path: string, offset: number): string {
  return offset <= 0 ? "" : sha256(readRange(path, Math.max(0, offset - ANCHOR_BYTES), offset));
}

// Fold one audit block into the record: keep it in the timeline if the output
// needs it, and note any unit of work it names for its stage.
function applyBlock(block: string, where: { shard: string; pos: number }, rc: RecordCursor): void {
  const event = block.match(/^\*\*Event\*\*:\s*(\S+)\s*$/m)?.[1];
  if (!event) return;
  const at = block.match(/^\*\*Timestamp\*\*:\s*(\S+)/m)?.[1];
  if (!at) return;
  // Isolated attempts run outside the workflow's plan; core ignores them for
  // stage boundaries, and so does this.
  if (blockField(block, "Workflow")?.startsWith("single-stage:")) return;

  const stage = blockField(block, "Stage");
  if (stage) {
    for (const name of UNIT_FIELDS) {
      const raw = blockField(block, name);
      if (!raw) continue;
      const units = new Set(rc.units[stage] ?? []);
      for (const u of raw.split(",").map((s) => s.trim()).filter(Boolean)) units.add(u);
      rc.units[stage] = [...units].sort();
    }
  }

  if (!TIMELINE_EVENTS.has(event)) return;
  const f: Record<string, string> = {};
  for (const name of [...(KEPT_FIELDS[event] ?? ["Stage"]), SESSION_FIELD]) {
    const v = blockField(block, name);
    if (v !== null) f[name] = v;
  }
  // This plugin's own sensor is never an error source. A plain pass is not
  // needed; only a pass with a Note (script error, tool unavailable) is.
  if (f["Sensor ID"] === PLUGIN) return;
  if (event === "SENSOR_PASSED" && !f.Note) return;
  if (event === "HUMAN_TURN" && !f[SESSION_FIELD]) return;
  rc.events.push({ e: event, at, ...where, ...(Object.keys(f).length ? { f } : {}) });
}

// Consume the complete blocks in `bytes` (which start at byte `from` of the shard).
// Returns how many bytes were consumed; a trailing partial block is not.
function consumeBlocks(bytes: Buffer, from: number, shard: string, rc: RecordCursor): number {
  // latin1 is one char per byte, so match indexes are byte offsets. Each block is
  // then decoded as UTF-8 on its own; the separators are ASCII.
  const raw = bytes.toString("latin1");
  let start = 0;
  BLOCK_END.lastIndex = 0;
  for (let m = BLOCK_END.exec(raw); m !== null; m = BLOCK_END.exec(raw)) {
    applyBlock(bytes.subarray(start, m.index).toString("utf8"), { shard, pos: from + start }, rc);
    start = m.index + m[0].length;
  }
  return start;
}

// Bring one record's facts up to date from the bytes appended to its shards.
function syncRecord(project: string, key: string, rc: RecordCursor, stats: SyncStats): RecordCursor {
  const auditDir = join(project, key, "audit");
  let names: string[] = [];
  try {
    names = readdirSync(auditDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    names = [];
  }

  // false = a shard no longer extends what was consumed; rebuild this record.
  const advance = (cur: RecordCursor): boolean => {
    if (Object.keys(cur.shards).some((n) => !names.includes(n))) return false;
    for (const name of names) {
      const path = join(auditDir, name);
      const st = statOf(path);
      if (!st) continue;
      const prev = cur.shards[name];
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue; // not opened
      if (prev && (st.size < prev.offset || anchorAt(path, prev.offset) !== prev.anchor)) return false;
      const from = prev?.offset ?? 0;
      const bytes = readRange(path, from, st.size);
      stats.shardsRead++;
      stats.bytesRead += bytes.length;
      const offset = from + consumeBlocks(bytes, from, name, cur);
      cur.shards[name] = {
        offset,
        size: st.size,
        mtimeMs: st.mtimeMs,
        anchor: prev && offset === from ? prev.anchor : anchorAt(path, offset),
      };
    }
    return true;
  };

  if (advance(rc)) return rc;
  stats.recordsRebuilt++;
  const fresh: RecordCursor = {
    ...emptyRecord(),
    output_sha256: rc.output_sha256,
    report: rc.report,
    reg: rc.reg,
    state: rc.state,
    ...(rc.request ? { request: rc.request } : {}),
  };
  advance(fresh); // starts from offset 0, so it cannot ask for another rebuild
  return fresh;
}

// --- state file (the plan) ---------------------------------------------------------
// "Stage Progress" in aidlc-state.md: one `### <NAME> PHASE` header per phase, then
// `- [<mark>] <slug> — EXECUTE|SKIP` per stage, in workflow order.
function parsePlan(state: string): PlanPhase[] | null {
  const section = state.replace(/\r\n/g, "\n").match(/^## Stage Progress\n([\s\S]*?)(?=^## (?!#)|(?![\s\S]))/m)?.[1];
  if (!section) return null;
  const plan: PlanPhase[] = [];
  for (const line of section.split("\n")) {
    const header = line.match(/^###\s+([A-Za-z]+)\s+PHASE\b/i);
    if (header) {
      plan.push({ phase: header[1].toLowerCase(), stages: [] });
      continue;
    }
    const row = line.match(/^\s*-\s*\[(.)\]\s+([a-z0-9][a-z0-9-]*)\s+[\u2014\u2013-]+\s+(EXECUTE|SKIP)\b/);
    if (row && plan.length > 0) {
      plan[plan.length - 1].stages.push({ slug: row[2], mark: row[1], execute: row[3] === "EXECUTE" });
    }
  }
  return plan.length > 0 ? plan : null;
}

// Re-read aidlc-state.md only when its size or mtime changed.
function syncState(project: string, key: string, rc: RecordCursor): void {
  const path = join(project, key, "aidlc-state.md");
  const st = statOf(path);
  if (st === null) {
    rc.state = null;
    return;
  }
  if (rc.state && rc.state.size === st.size && rc.state.mtimeMs === st.mtimeMs) return;
  const text = readText(path) ?? "";
  rc.state = {
    ...st,
    plan: parsePlan(text),
    scope: blockField(text, "Scope"),
    start: blockField(text, "Start Date"),
    project: blockField(text, "Project"),
    status: blockField(text, "Status"),
  };
}

// --- session files (credits): shared helpers, then Kiro's -----------------------------
const usageDisabled = (): boolean => process.env.AIDLC_DISABLE_USAGE_TRACKING === "1";
const toUnits = (credits: number): number => Math.round(credits * CREDIT_SCALE);
const fromUnits = (units: number): number => units / CREDIT_SCALE;
const USAGE_MARKER_BYTES = Buffer.from(USAGE_MARKER);

// The earliest WORKFLOW_STARTED of the record, if any.
function workflowStart(rc: RecordCursor): string | null {
  let at: string | null = null;
  for (const ev of rc.events) if (ev.e === "WORKFLOW_STARTED" && (at === null || ev.at < at)) at = ev.at;
  return at;
}

// <kiro home>/sessions: $KIRO_HOME, else ~/.kiro (%USERPROFILE%\.kiro on Windows).
function kiroSessionsRoot(): string {
  return join(str(process.env.KIRO_HOME) ?? join(homedir(), ".kiro"), "sessions");
}

// The workspace-hash folders under <kiro home>/sessions, listed once per run. The
// hash can't be derived from the workspace path, so a session is found by its id.
let kiroWorkspaceDirs: string[] | null = null;
function locateKiroSession(sid: string): string | null {
  const root = kiroSessionsRoot();
  kiroWorkspaceDirs ??= listDirs(root);
  for (const ws of kiroWorkspaceDirs) {
    const path = join(root, ws, sid, KIRO_SESSION_LOG);
    if (existsSync(path)) return path;
  }
  return null;
}

// The harness's session bindings (aidlc/.aidlc-sessions/<session>.binding.json,
// { space, intent }), read at most once per run: record key -> session ids.
let bindingMemo: Map<string, string[]> | null = null;
function boundSessions(project: string, key: string): string[] {
  if (!bindingMemo) {
    bindingMemo = new Map();
    const dir = join(project, "aidlc", ".aidlc-sessions");
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".binding.json"));
    } catch {
      names = [];
    }
    for (const name of names.sort()) {
      const sid = name.slice(0, -".binding.json".length);
      if (!isUsageSessionId(sid)) continue;
      const b = readJson<{ space?: unknown; intent?: unknown }>(join(dir, name));
      const space = str(b?.space);
      const intent = str(b?.intent);
      if (!space || !intent) continue;
      const k = recordKey(space, intent);
      bindingMemo.set(k, [...(bindingMemo.get(k) ?? []), sid]);
    }
  }
  return bindingMemo.get(key) ?? [];
}

// A turn's credits: the sum of the `field` values of its entries with unit "credit",
// rounded once to 4 decimals. null when no entry is in credits.
function sumCredits(entries: unknown[], field: string): number | null {
  let sum = 0;
  let found = false;
  for (const e of entries) {
    const v = isPlainObject(e) && e.unit === "credit" ? e[field] : undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    sum += v;
    found = true;
  }
  return found ? fromUnits(toUnits(sum)) : null;
}

// One usage_summary line -> a completed turn, or null if it isn't one or names no credits.
function parseUsageLine(text: string): SessionTurn | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(o) || !isPlainObject(o.payload)) return null;
  const p = o.payload;
  if (p.type !== "usage_summary" || typeof p.executionId !== "string" || typeof o.timestamp !== "string") return null;
  const ended = Date.parse(o.timestamp);
  const elapsed = typeof p.elapsedTime === "number" && Number.isFinite(p.elapsedTime) && p.elapsedTime >= 0 ? p.elapsedTime : null;
  if (!Number.isFinite(ended) || elapsed === null || !Array.isArray(p.promptTurnSummaries)) return null;
  const credits = sumCredits(p.promptTurnSummaries, "usage");
  if (credits === null) return null; // no credit entry: nothing was metered for this turn
  return {
    id: p.executionId,
    started_at: new Date(ended - elapsed).toISOString(),
    ended_at: new Date(ended).toISOString(),
    credits,
  };
}

// Read the complete lines of a session log from cur.offset to `size`, keeping each
// turn that ended after `floorMs`. Returns the offset after the last complete line;
// a line still being written is left for the next run.
function readSessionLog(path: string, cur: SessionCursor, size: number, floorMs: number, stats: SyncStats): number {
  stats.logsRead++;
  const byId = new Map(cur.turns.map((t) => [t.id, t]));
  let pos = cur.offset;
  let consumed = cur.offset;
  let carry = Buffer.alloc(0);
  while (pos < size) {
    const chunk = readRange(path, pos, Math.min(size, pos + LOG_CHUNK));
    if (chunk.length === 0) break;
    stats.logBytesRead += chunk.length;
    const bufStart = pos - carry.length;
    pos += chunk.length;
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const last = buf.lastIndexOf(0x0a);
    if (last < 0) {
      carry = buf;
      continue;
    }
    let start = 0;
    while (start <= last) {
      const nl = buf.indexOf(0x0a, start);
      const line = buf.subarray(start, nl);
      start = nl + 1;
      if (line.indexOf(USAGE_MARKER_BYTES) < 0) continue; // checked before parsing
      const turn = parseUsageLine(line.toString("utf8"));
      if (turn && Date.parse(turn.ended_at) > floorMs) byId.set(turn.id, turn);
    }
    consumed = bufStart + last + 1;
    carry = buf.subarray(last + 1);
  }
  cur.turns = [...byId.values()].sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.id < b.id ? -1 : 1));
  return consumed;
}

// Kiro CLI's default engine: one <kiro home>/sessions/cli/<uuid>.json per session.
// session_state.conversation_metadata.user_turn_metadatas[] has one entry per user
// turn: end_timestamp, turn_duration { secs, nanos } (start = end - duration) and
// metering_usage[] { value, unit }, one per request. Its token counts are not used:
// they are 0 in every turn seen. null when the text is not (yet) a whole session file.
function parseCliSession(text: string, floorMs: number): SessionTurn[] | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null; // mid-write: read again next run
  }
  const meta = isPlainObject(o) && isPlainObject(o.session_state) ? o.session_state.conversation_metadata : null;
  const list = isPlainObject(meta) ? meta.user_turn_metadatas : null;
  if (!Array.isArray(list)) return null;
  const turns: SessionTurn[] = [];
  list.forEach((t: unknown, i: number) => {
    if (!isPlainObject(t) || typeof t.end_timestamp !== "string" || !isPlainObject(t.turn_duration) || !Array.isArray(t.metering_usage)) return;
    const end = Date.parse(t.end_timestamp.replace(/(\.\d{3})\d+/, "$1")); // Kiro writes 100 ns precision
    const { secs, nanos } = t.turn_duration;
    if (!Number.isFinite(end) || typeof secs !== "number" || !Number.isFinite(secs) || secs < 0) return;
    const ns = typeof nanos === "number" && Number.isFinite(nanos) && nanos >= 0 ? nanos : 0;
    const credits = sumCredits(t.metering_usage, "value");
    if (credits === null || end <= floorMs) return; // nothing metered, or before the workflow
    turns.push({
      id: String(i),
      started_at: new Date(end - Math.round(secs * 1000 + ns / 1e6)).toISOString(),
      ended_at: new Date(end).toISOString(),
      credits,
    });
  });
  return turns;
}

// Re-read a Kiro CLI session file when its size or mtime changed. A file that is
// missing (not on this machine) or mid-write leaves the turns already read.
const kiroCliSessionPath = (sid: string): string => join(kiroSessionsRoot(), KIRO_CLI_DIR, `${sid}.json`);
function syncCliSession(sid: string, rc: RecordCursor, floorMs: number, stats: SyncStats): void {
  const path = kiroCliSessionPath(sid);
  const st = statOf(path);
  if (!st) return;
  const prev = rc.sessions[sid];
  if (prev && prev.path === path && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return; // not opened
  const text = readText(path);
  if (text === null) return;
  stats.logsRead++;
  stats.logBytesRead += st.size;
  const turns = parseCliSession(text, floorMs);
  if (turns === null) return;
  rc.sessions[sid] = { path, offset: st.size, size: st.size, mtimeMs: st.mtimeMs, anchor: "", turns };
}

// --- VS Code session files (credits) -------------------------------------------------
// VS Code's user dirs to search, existing ones only: AMADEUS_TELEMETRY_VSCODE_USER_DIR
// alone when it is set (a custom --user-data-dir, or a test fixture), else a
// portable install's (VSCODE_PORTABLE), then VS Code's and VS Code Insiders' default
// for the platform.
function vscodeUserDirs(): string[] {
  const override = str(process.env.AMADEUS_TELEMETRY_VSCODE_USER_DIR);
  if (override) return existsSync(override) ? [override] : [];
  const dirs: string[] = [];
  const portable = str(process.env.VSCODE_PORTABLE);
  if (portable) dirs.push(join(portable, "user-data", "User"));
  for (const product of VSCODE_PRODUCTS) {
    if (process.platform === "win32") {
      dirs.push(join(str(process.env.APPDATA) ?? join(homedir(), "AppData", "Roaming"), product, "User"));
    } else if (process.platform === "darwin") {
      dirs.push(join(homedir(), "Library", "Application Support", product, "User"));
    } else {
      dirs.push(join(str(process.env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), product, "User"));
    }
  }
  return dirs.filter((d) => existsSync(d));
}

// The folders a VS Code chat session log can be in, listed once per run: every
// <user dir>/workspaceStorage/<hash>/chatSessions (the hash can't be derived from the
// project path, so a session is found by its id), then
// <user dir>/globalStorage/emptyWindowChatSessions.
let vscodeSessionDirs: string[] | null = null;
function locateVscodeSession(sid: string): string | null {
  if (!vscodeSessionDirs) {
    vscodeSessionDirs = [];
    for (const user of vscodeUserDirs()) {
      const storage = join(user, "workspaceStorage");
      for (const ws of listDirs(storage)) vscodeSessionDirs.push(join(storage, ws, "chatSessions"));
      vscodeSessionDirs.push(join(user, "globalStorage", "emptyWindowChatSessions"));
    }
  }
  for (const dir of vscodeSessionDirs) {
    const path = join(dir, `${sid}${VSCODE_SESSION_EXT}`);
    if (existsSync(path)) return path;
  }
  return null;
}

const isVscodeSessionPath = (path: string): boolean =>
  path.endsWith(VSCODE_SESSION_EXT) && VSCODE_SESSION_DIRS.has(basename(dirname(path)));

// One request of a VS Code chat session, as far as its log has been replayed.
type VscodeRequest = { id: string; startMs: number | null; credits: number | null; endMs: number | null };

// A VS Code chat session log (chatSessions/<uuid>.jsonl) -> its completed requests,
// as turns. The log is an append-only list of ops on the session object: kind 0 a
// snapshot (v), 1 set the value at path k, 2 push v onto the array at k (cut to
// length i first, when given), 3 delete k. Each request (one user prompt and
// everything the agent did for it) carries:
//   requestId               the turn id
//   timestamp               start, epoch ms
//   copilotCredits          credits so far; final once the request has ended (the
//                           value VS Code shows on the response)
//   modelState.completedAt  end, epoch ms; set when it completes, is cancelled or fails
// VS Code updates copilotCredits while a request runs, and in AIDLC one request can
// run for a long time (the Stop hook keeps the agent going, and questions and gates
// are answered inside it). So a request with no completedAt yet (still running,
// waiting for input, or left open when VS Code closed) counts with its credits so
// far, ending at the log's last write (`lastWriteMs`); it is updated on every read
// until it ends. A request later cut from the session (checkpoint restore, an
// earlier prompt edited) was still billed, so it is kept. A request with no credits
// (an older VS Code, a bring-your-own-key model) is skipped. Only lines whose head
// can carry these fields are parsed. null when the text holds no snapshot (not a
// session log).
function parseVscodeSession(text: string, floorMs: number, lastWriteMs: number): SessionTurn[] | null {
  const byId = new Map<string, VscodeRequest>();
  let order: string[] = []; // request ids by their current position in the array
  let snapshot = false;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  // A whole request (from a snapshot, a push or a replace) -> its id, merged into byId.
  const take = (r: unknown): string | null => {
    if (!isPlainObject(r) || typeof r.requestId !== "string" || r.requestId === "") return null;
    const prev = byId.get(r.requestId);
    const state = isPlainObject(r.modelState) ? r.modelState : null;
    byId.set(r.requestId, {
      id: r.requestId,
      startMs: num(r.timestamp) ?? prev?.startMs ?? null,
      credits: num(r.copilotCredits) ?? prev?.credits ?? null,
      endMs: num(state?.completedAt) ?? prev?.endMs ?? null, // an end, once seen, stays
    });
    return r.requestId;
  };
  const takeAll = (list: unknown): string[] =>
    Array.isArray(list) ? list.map(take).filter((id): id is string => id !== null) : [];
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    const from = pos;
    pos = end + 1;
    const head = text.slice(from, Math.min(end, from + VSCODE_HEAD));
    if (!VSCODE_SNAPSHOT_RE.test(head) && !VSCODE_REQUESTS_RE.test(head) && !VSCODE_FIELD_RE.test(head)) continue;
    let op: unknown;
    try {
      op = JSON.parse(text.slice(from, end));
    } catch {
      continue; // a line still being written: read again next run
    }
    if (!isPlainObject(op)) continue;
    if (op.kind === 0) {
      snapshot = true;
      order = takeAll(isPlainObject(op.v) ? op.v.requests : null);
      continue;
    }
    const k = op.k;
    if (!Array.isArray(k) || k[0] !== "requests") continue;
    if (k.length === 1) {
      // The requests array itself: replaced, pushed onto (after an optional cut), or deleted.
      if (op.kind === 1) order = takeAll(op.v);
      else if (op.kind === 2) {
        if (typeof op.i === "number" && op.i >= 0) order.length = Math.min(order.length, op.i);
        order.push(...takeAll(op.v));
      } else if (op.kind === 3) order = [];
      continue;
    }
    if (typeof k[1] !== "number" || k[1] < 0) continue;
    if (k.length === 2) {
      // One request replaced whole.
      const id = op.kind === 1 ? take(op.v) : null;
      if (id) order[k[1]] = id;
      continue;
    }
    const req = byId.get(order[k[1]] ?? "");
    if (!req || op.kind !== 1) continue;
    if (k[2] === "copilotCredits") req.credits = num(op.v) ?? req.credits;
    else if (k[2] === "timestamp") req.startMs = num(op.v) ?? req.startMs;
    else if (k[2] === "modelState") {
      const at = k.length === 3 ? (isPlainObject(op.v) ? op.v.completedAt : undefined) : k[3] === "completedAt" ? op.v : undefined;
      req.endMs = num(at) ?? req.endMs; // an end, once seen, stays
    }
  }
  if (!snapshot) return null;
  const turns: SessionTurn[] = [];
  for (const r of byId.values()) {
    if (r.credits === null || r.startMs === null) continue; // not metered
    const endMs = r.endMs ?? lastWriteMs; // not ended yet: credits so far, up to the last write
    if (endMs <= floorMs || endMs < r.startMs) continue; // ended before the workflow, or unreadable times
    turns.push({
      id: r.id,
      started_at: new Date(r.startMs).toISOString(),
      ended_at: new Date(endMs).toISOString(),
      credits: fromUnits(toUnits(r.credits)),
    });
  }
  return turns.sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.id < b.id ? -1 : 1));
}

// Re-read a VS Code chat session log when its size or mtime changed. It is read
// whole: only its few request-level lines are parsed, VS Code may rewrite it with a
// fresh snapshot when the session is reopened, and a running request's credits are
// replaced by its latest figure. A log that is missing (not on this machine) or
// holds no snapshot yet leaves the turns already read.
function syncVscodeSession(sid: string, rc: RecordCursor, floorMs: number, stats: SyncStats): void {
  const prev = rc.sessions[sid];
  const path = prev && existsSync(prev.path) ? prev.path : locateVscodeSession(sid);
  if (!path) return;
  const st = statOf(path);
  if (!st) return;
  if (prev && prev.path === path && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return; // not opened
  const text = readText(path);
  if (text === null) return;
  stats.logsRead++;
  stats.logBytesRead += st.size;
  const turns = parseVscodeSession(text, floorMs, Math.floor(st.mtimeMs));
  if (turns === null) return;
  rc.sessions[sid] = { path, offset: st.size, size: st.size, mtimeMs: st.mtimeMs, anchor: "", turns };
}

// Which reader a session id goes to. A sess_ id is a Kiro IDE (or Kiro CLI --v3)
// log. A uuid is a VS Code chat session on the copilot harness, and a Kiro CLI
// session on any other. Run from outside an install (no harness file), a session
// read before keeps its reader, else a Kiro CLI file is looked for first.
type SessionReader = "kiro-log" | "kiro-cli" | "vscode";
function sessionReader(sid: string, prev: SessionCursor | undefined): SessionReader {
  if (!CLI_ID_RE.test(sid)) return "kiro-log";
  const harness = harnessName();
  if (harness === "copilot") return "vscode";
  if (harness !== null) return "kiro-cli";
  if (prev) return isVscodeSessionPath(prev.path) ? "vscode" : "kiro-cli";
  return existsSync(kiroCliSessionPath(sid)) ? "kiro-cli" : "vscode";
}

// Bring the intent's sessions up to date. The sessions are the ones its audit events
// name (else the harness's bindings to it) and any read before; only those with a
// session file on this machine are read (Kiro's, or VS Code's on the copilot
// harness). Turns already read stay when a session file goes away.
function syncSessions(project: string, key: string, rc: RecordCursor, stats: SyncStats): void {
  if (usageDisabled()) return;
  const started = workflowStart(rc);
  if (started === null) return; // nothing counts before the workflow starts
  const floorMs = Date.parse(started);
  const ids = new Set<string>();
  for (const ev of rc.events) {
    const sid = ev.f?.[SESSION_FIELD];
    if (sid && isUsageSessionId(sid)) ids.add(sid);
  }
  if (ids.size === 0) for (const sid of boundSessions(project, key)) ids.add(sid);
  for (const sid of Object.keys(rc.sessions)) ids.add(sid); // once linked, a session stays linked
  for (const sid of [...ids].sort()) {
    const reader = sessionReader(sid, rc.sessions[sid]);
    if (reader === "vscode") {
      syncVscodeSession(sid, rc, floorMs, stats);
      continue;
    }
    if (reader === "kiro-cli") {
      syncCliSession(sid, rc, floorMs, stats);
      continue;
    }
    const prev = rc.sessions[sid];
    const path = prev && existsSync(prev.path) ? prev.path : locateKiroSession(sid);
    if (!path) continue;
    const st = statOf(path);
    if (!st) continue;
    if (prev && prev.path === path && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue; // not opened
    // A log that no longer extends what was read (shrank, rewritten) is read again from 0.
    const keep = !!prev && prev.path === path && st.size >= prev.offset && anchorAt(path, prev.offset) === prev.anchor;
    const cur: SessionCursor = keep ? prev : { path, offset: 0, size: 0, mtimeMs: 0, anchor: "", turns: [] };
    const from = cur.offset;
    const offset = readSessionLog(path, cur, st.size, floorMs, stats);
    rc.sessions[sid] = {
      ...cur,
      offset,
      size: st.size,
      mtimeMs: st.mtimeMs,
      anchor: keep && offset === from ? cur.anchor : anchorAt(path, offset),
    };
  }
}

// --- phases and stages -------------------------------------------------------------
type ErrorCounts = { total: number; by_kind: Record<string, number>; by_source: Record<string, number> };
type IntentErrors = ErrorCounts & { unassigned: number };
type Signals = Record<string, number>;
// Credits of a stage or phase, and which credits they are (kiro or copilot); null
// when the intent's usage is not tracked here.
type Usage = { credits: number; credit_type: string } | null;
// One turn credits are computed from, and (in the ledger) the stage it counted for.
type UsageTurn = { session: string; started_at: string; ended_at: string; credits: number };
type LedgerTurn = UsageTurn & { stage: string | null };
type IntentUsage = {
  source: string;
  unit: string;
  credit_type: string; // "kiro" or "copilot" (CREDIT_TYPES)
  credits: number;
  unassigned: number;
  split_turns: number; // turns whose time fell in more than one stage (or outside any)
  turns: LedgerTurn[];
} | null;
type StageOut = {
  status: StageStatus;
  duration: string | null;
  human_wait: string | null;
  started_at: string | null;
  completed_at: string | null;
  units: number;
  errors: ErrorCounts;
  signals: Signals;
  usage: Usage;
};
type PhaseStatus = "pending" | "in-flight" | "completed" | "skipped";
type PhaseOut = {
  status: PhaseStatus;
  duration: string | null;
  human_wait: string | null;
  started_at: string | null;
  completed_at: string | null;
  errors: ErrorCounts;
  signals: Signals;
  usage: Usage;
  stages: Record<string, StageOut>;
};

// --- errors and signals ----------------------------------------------------------
// One error (counted) or signal (reported only) found on a kept audit event.
type Finding = { kind: string; source: string; stage: string | null; signal: boolean };

function classify(ev: TimelineEvent): Finding | null {
  const f = ev.f ?? {};
  const stage = f.Stage ?? f["Stage slug"] ?? null;
  const error = (kind: string, source: string | undefined): Finding => ({ kind, source: source ?? "unknown", stage, signal: false });
  const signal = (kind: string): Finding => ({ kind, source: "", stage, signal: true });
  switch (ev.e) {
    case "ERROR_LOGGED":
      return error("tool_error", f.Tool);
    case "SENSOR_FAILED":
      return error("sensor_failed", f["Sensor ID"]);
    case "SENSOR_BUDGET_OVERRIDE":
      return error("sensor_timeout", f["Sensor ID"]);
    case "SENSOR_PASSED":
      // core's fall-through notes: `script-error: <reason>` and `tool-unavailable`
      if (f.Note?.startsWith("script-error")) return error("sensor_script_error", f["Sensor ID"]);
      if (f.Note?.startsWith("tool-unavailable")) return signal("sensor_unavailable");
      return null;
    case "BOLT_FAILED":
      return error("run_failure", f["Failed Bolt"]);
    case "SWARM_UNIT_FAILED":
      return error("run_failure", f["Unit name"]);
    case "STAGE_AWAITING_APPROVAL":
      return f["Blocking Sensor Override"]?.toLowerCase() === "true" ? signal("blocking_override") : null;
    case "GATE_REJECTED":
      return signal("rejection");
  }
  return GUARD_BLOCKS[ev.e] ? error("guard_block", GUARD_BLOCKS[ev.e]) : null;
}

type Tally = { total: number; kinds: Map<string, number>; sources: Map<string, number>; signals: Map<string, number> };
const newTally = (): Tally => ({ total: 0, kinds: new Map(), sources: new Map(), signals: new Map() });
const bump = (m: Map<string, number>, key: string, by = 1): void => {
  m.set(key, (m.get(key) ?? 0) + by);
};
function addFinding(t: Tally, f: Finding): void {
  if (f.signal) {
    bump(t.signals, f.kind);
    return;
  }
  t.total++;
  bump(t.kinds, f.kind);
  bump(t.sources, f.source);
}
function addTally(into: Tally, from: Tally): void {
  into.total += from.total;
  for (const [k, n] of from.kinds) bump(into.kinds, k, n);
  for (const [k, n] of from.sources) bump(into.sources, k, n);
  for (const [k, n] of from.signals) bump(into.signals, k, n);
}
// Keys sorted, so the same counts always serialise the same way.
const sortedCounts = (m: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const errorsOf = (t: Tally): ErrorCounts => ({ total: t.total, by_kind: sortedCounts(t.kinds), by_source: sortedCounts(t.sources) });

// Readable duration: "0s", "45s", "6m 38s", "1h 0m 18s", "2d 3h 0m 5s".
function formatDuration(seconds: number): string {
  let s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

const secondsBetween = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / 1000;
const overlapMs = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// One change of the stage open at the time (null: none open), in timeline order.
type Segment = { at: string; stage: string | null };

// Milliseconds of [t0, t1) spent in each stage (null: no stage open), in time order.
function timeByStage(t0: number, t1: number, segments: Segment[]): Map<string | null, number> {
  const time = new Map<string | null, number>();
  let from = -Infinity;
  let stage: string | null = null;
  const add = (to: number): void => {
    const ms = overlapMs(t0, t1, from, to);
    if (ms > 0) time.set(stage, (time.get(stage) ?? 0) + ms);
  };
  for (const seg of segments) {
    const at = Date.parse(seg.at);
    add(at);
    from = at;
    stage = seg.stage;
  }
  add(Infinity);
  return time;
}

// The harness of this install, from <leaf>/tools/data/harness.json next to this
// script: its name ("kiro-ide", "kiro" for Kiro CLI, "copilot", ...) and product
// name (`productName`, else HARNESS_PRODUCTS). null when run from outside an install.
type HarnessInfo = { name: string; product: string | null };
let harnessMemo: HarnessInfo | null | undefined;
function harnessInfo(): HarnessInfo | null {
  if (harnessMemo === undefined) {
    const h = readJson<{ name?: unknown; productName?: unknown }>(join(import.meta.dir, "data", "harness.json"));
    const name = str(h?.name);
    harnessMemo = name ? { name, product: str(h?.productName) ?? HARNESS_PRODUCTS[name] ?? null } : null;
  }
  return harnessMemo;
}
const harnessName = (): string | null => harnessInfo()?.name ?? null;

// Which product the credits come from: the install's harness, else the session
// files read (a VS Code chatSessions log means vscode, a Kiro CLI <uuid>.json
// kiro-cli), else what telemetry.json already said. Kiro CLI's V3 engine writes the
// same sess_ logs as Kiro IDE, so only the harness tells those apart.
function usageSource(rc: RecordCursor, existing: TelemetryDoc | null): string {
  const harness = harnessName();
  if (harness === "kiro") return "kiro-cli";
  if (harness === "kiro-ide") return "kiro-ide";
  if (harness === "copilot") return "vscode";
  const read = Object.entries(rc.sessions);
  if (read.some(([, sc]) => isVscodeSessionPath(sc.path))) return "vscode";
  if (read.some(([sid]) => CLI_ID_RE.test(sid))) return "kiro-cli";
  return recordedSource(existing) ?? "kiro-ide";
}

// The source an earlier telemetry.json recorded its credits from, if it is a known one.
function recordedSource(doc: TelemetryDoc | null): string | null {
  const recorded = (doc?.intent as { usage?: { source?: unknown } } | undefined)?.usage?.source;
  return typeof recorded === "string" && USAGE_SOURCES.has(recorded) ? recorded : null;
}

// The turns credits are computed from: this machine's session files, plus the turns
// the existing telemetry.json recorded for sessions this machine has no file of
// (another clone's, or a deleted session). Recorded turns in another unit (the
// intent also run on another product, in another clone) are not added to this
// machine's: when nothing was read here they stand as recorded, else this machine's
// replace them. null when there is neither.
function usageTurns(rc: RecordCursor, existing: TelemetryDoc | null): { source: string; turns: UsageTurn[] } | null {
  if (usageDisabled()) return null;
  const turns: UsageTurn[] = [];
  for (const [session, sc] of Object.entries(rc.sessions)) {
    for (const t of sc.turns) turns.push({ session, started_at: t.started_at, ended_at: t.ended_at, credits: t.credits });
  }
  let source = usageSource(rc, existing);
  let carried = recordedTurns(existing).filter((t) => !rc.sessions[t.session]);
  const recorded = recordedSource(existing);
  if (carried.length > 0 && recorded !== null && USAGE_UNITS[recorded] !== USAGE_UNITS[source]) {
    if (Object.keys(rc.sessions).length === 0) {
      source = recorded;
    } else {
      debug(`usage: ${carried.length} ${recorded} turn(s) in ${USAGE_UNITS[recorded]} not added to ${source} credits`);
      carried = [];
    }
  }
  if (Object.keys(rc.sessions).length === 0 && carried.length === 0) return null;
  turns.push(...carried);
  turns.sort((a, b) =>
    a.started_at !== b.started_at ? (a.started_at < b.started_at ? -1 : 1) : a.session < b.session ? -1 : a.session > b.session ? 1 : 0,
  );
  return { source, turns };
}

// The turns an earlier telemetry.json recorded, validated (it may come from another clone).
function recordedTurns(doc: TelemetryDoc | null): UsageTurn[] {
  const usage = (doc?.intent as { usage?: unknown } | undefined)?.usage;
  if (!isPlainObject(usage) || typeof usage.source !== "string" || !USAGE_SOURCES.has(usage.source) || !Array.isArray(usage.turns)) {
    return [];
  }
  const out: UsageTurn[] = [];
  for (const t of usage.turns) {
    if (!isPlainObject(t)) continue;
    const { session, started_at, ended_at, credits } = t;
    if (typeof session !== "string" || !isUsageSessionId(session)) continue;
    if (typeof started_at !== "string" || typeof ended_at !== "string" || !(Date.parse(started_at) <= Date.parse(ended_at))) continue;
    if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) continue;
    out.push({ session, started_at, ended_at, credits: fromUnits(toUnits(credits)) });
  }
  return out;
}

type StageAcc = {
  phase: string | null; // phase open when the stage first appeared
  firstStart: string | null;
  firstSeen: string;
  last: { status: StageStatus; index: number } | null;
  lastCompleted: string | null;
  waitSeconds: number;
};

type PhasesOut = { phases: Record<string, PhaseOut>; errors: IntentErrors; signals: Signals; usage: IntentUsage };

function renderPhases(rc: RecordCursor, credited: { source: string; turns: UsageTurn[] } | null): PhasesOut {
  const turns = credited?.turns ?? null;
  const events = rc.events.sort(cmpPos); // shards can interleave; kept sorted in the cursor
  const segments: Segment[] = []; // the stage open over time (errors and credits)
  const stages = new Map<string, StageAcc>();
  const phaseStarts = new Map<string, string>(); // first PHASE_STARTED
  const phaseEnds = new Map<string, string>(); // last PHASE_COMPLETED
  const phasesSkipped = new Set<string>();
  const backwardJumps: { index: number; target: string }[] = [];
  const findings: Finding[] = [];
  let currentPhase: string | null = null;
  let currentStage: string | null = null; // last stage started (human-wait fallback)
  let runningStage: string | null = null; // stage open right now (error fallback)
  let waiting = 0;
  let waitFrom: { at: string; stage: string | null } | null = null;

  const acc = (slug: string, at: string): StageAcc => {
    let a = stages.get(slug);
    if (!a) {
      a = { phase: currentPhase, firstStart: null, firstSeen: at, last: null, lastCompleted: null, waitSeconds: 0 };
      stages.set(slug, a);
    }
    return a;
  };
  const endWait = (at: string): void => {
    if (waitFrom?.stage) acc(waitFrom.stage, waitFrom.at).waitSeconds += Math.max(0, secondsBetween(waitFrom.at, at));
    waitFrom = null;
    waiting = 0;
  };

  events.forEach((ev, index) => {
    const stage = ev.f?.Stage ?? null;
    switch (ev.e) {
      case "PHASE_STARTED":
        if (ev.f?.Phase) {
          currentPhase = ev.f.Phase;
          if (!phaseStarts.has(currentPhase)) phaseStarts.set(currentPhase, ev.at);
        }
        break;
      case "PHASE_COMPLETED":
        if (ev.f?.["From phase"]) phaseEnds.set(ev.f["From phase"], ev.at);
        break;
      case "PHASE_SKIPPED":
        if (ev.f?.Phase) phasesSkipped.add(ev.f.Phase);
        break;
      case "STAGE_JUMPED":
        if (ev.f?.Direction?.toUpperCase() === "BACKWARD" && ev.f.Target) backwardJumps.push({ index, target: ev.f.Target });
        break;
    }
    if (WAIT_BOUNDARIES.has(ev.e) && waiting > 0) endWait(ev.at);
    const status = STAGE_STATUS[ev.e];
    if (status && stage) {
      const a = acc(stage, ev.at);
      if (ev.e === "STAGE_STARTED") {
        a.firstStart ??= ev.at;
        currentStage = stage;
      }
      if (ev.e === "STAGE_COMPLETED") a.lastCompleted = ev.at;
      a.last = { status, index };
    }
    if (WAIT_OPENERS.has(ev.e)) {
      if (waiting === 0) waitFrom = { at: ev.at, stage: stage ?? currentStage };
      waiting++;
    } else if (WAIT_CLOSERS.has(ev.e) && waiting > 0) {
      waiting--;
      if (waiting === 0) endWait(ev.at);
    }
    // An error without a stage of its own belongs to the stage open at the time.
    const wasRunning = runningStage;
    if (stage && (ev.e === "STAGE_STARTED" || ev.e === "STAGE_AWAITING_APPROVAL" || ev.e === "STAGE_REVISING")) runningStage = stage;
    else if ((ev.e === "STAGE_COMPLETED" || ev.e === "STAGE_SKIPPED") && stage === runningStage) runningStage = null;
    else if (ev.e === "WORKFLOW_COMPLETED") runningStage = null;
    if (runningStage !== wasRunning) segments.push({ at: ev.at, stage: runningStage });
    const finding = classify(ev);
    if (finding) findings.push({ ...finding, stage: finding.stage ?? runningStage });
  });

  // Plan: the state file's phases and stages; without one, the phases in core's
  // order and the stages the audit shows.
  const plan = rc.state?.plan ?? null;
  const order = new Map<string, number>();
  const phaseStages = new Map<string, { slug: string; mark: string | null }[]>();
  if (plan) {
    let n = 0;
    for (const p of plan) {
      phaseStages.set(p.phase, []);
      for (const s of p.stages) {
        order.set(s.slug, n++);
        if (s.execute || stages.has(s.slug)) phaseStages.get(p.phase)!.push({ slug: s.slug, mark: s.mark });
      }
    }
  } else {
    for (const p of PHASE_ORDER) phaseStages.set(p, []);
  }
  // Stages the audit shows that the plan does not list (or no plan at all).
  let extra = order.size;
  for (const [slug, a] of stages) {
    if (!order.has(slug)) order.set(slug, extra++);
    const listed = [...phaseStages.values()].some((list) => list.some((s) => s.slug === slug));
    if (listed) continue;
    const phase = a.phase ?? "initialization";
    if (!phaseStages.has(phase)) phaseStages.set(phase, []);
    phaseStages.get(phase)!.push({ slug, mark: null });
  }

  // Errors and signals: per listed stage; anything else counts only for the intent.
  const listed = new Set([...phaseStages.values()].flatMap((list) => list.map((s) => s.slug)));
  const stageTallies = new Map<string, Tally>();
  const intentTally = newTally();
  let unassigned = 0;
  for (const f of findings) {
    addFinding(intentTally, f);
    if (f.stage && listed.has(f.stage)) {
      if (!stageTallies.has(f.stage)) stageTallies.set(f.stage, newTally());
      addFinding(stageTallies.get(f.stage)!, f);
    } else if (!f.signal) {
      unassigned++;
    }
  }

  // Credits: every turn that overlaps the workflow counts, whole, for the listed
  // stage it spent the most time in (ties: the earlier one). When most of it fell
  // outside any stage, it counts only for the intent, in `unassigned`.
  const stageUnits = new Map<string, number>(); // in 1/CREDIT_SCALE credits
  let usage: IntentUsage = null;
  if (turns) {
    const ledger: LedgerTurn[] = [];
    let total = 0;
    let unassignedUnits = 0;
    let split = 0;
    const wfStart = events.find((e) => e.e === "WORKFLOW_STARTED")?.at ?? null;
    const wfEnd = events.findLast((e) => e.e === "WORKFLOW_COMPLETED")?.at ?? null;
    if (wfStart) {
      const from = Date.parse(wfStart);
      const to = wfEnd ? Date.parse(wfEnd) : Infinity;
      for (const t of turns) {
        const t0 = Date.parse(t.started_at);
        const t1 = Date.parse(t.ended_at);
        if (overlapMs(t0, t1, from, to) <= 0) continue;
        const time = timeByStage(t0, t1, segments);
        let stage: string | null = null;
        let best = -1;
        for (const [s, ms] of time) {
          if (ms > best) {
            best = ms;
            stage = s;
          }
        }
        if (stage !== null && !listed.has(stage)) stage = null;
        if (time.size > 1) split++;
        const units = toUnits(t.credits);
        total += units;
        if (stage) stageUnits.set(stage, (stageUnits.get(stage) ?? 0) + units);
        else unassignedUnits += units;
        ledger.push({ ...t, stage });
      }
    }
    const unit = USAGE_UNITS[credited!.source] ?? "credit";
    usage = {
      source: credited!.source,
      unit,
      credit_type: CREDIT_TYPES[unit] ?? "unknown",
      credits: fromUnits(total),
      unassigned: fromUnits(unassignedUnits),
      split_turns: split,
      turns: ledger,
    };
  }

  const out: Record<string, PhaseOut> = {};
  for (const [phase, list] of phaseStages) {
    const stageOut: Record<string, StageOut> = {};
    const phaseTally = newTally();
    let phaseUnits = 0;
    for (const { slug, mark } of list) {
      const a = stages.get(slug);
      let status: StageStatus = a?.last?.status ?? (mark ? MARK_STATUS[mark] : undefined) ?? "pending";
      // A backward jump to an earlier stage sends this one back to pending until it runs again.
      if (a?.last) {
        const myOrder = order.get(slug) ?? 0;
        const reset = backwardJumps.some((j) => j.index > a.last!.index && myOrder > (order.get(j.target) ?? Infinity));
        if (reset) status = "pending";
      }
      const startedAt = a ? (a.firstStart ?? a.firstSeen) : null;
      const completedAt = status === "completed" ? (a?.lastCompleted ?? null) : null;
      const tally = stageTallies.get(slug) ?? newTally();
      addTally(phaseTally, tally);
      const creditUnits = stageUnits.get(slug) ?? 0;
      phaseUnits += creditUnits;
      stageOut[slug] = {
        status,
        duration: startedAt && completedAt ? formatDuration(secondsBetween(startedAt, completedAt)) : null,
        human_wait: completedAt && a ? formatDuration(a.waitSeconds) : null,
        started_at: startedAt,
        completed_at: completedAt,
        units: (rc.units[slug] ?? []).length,
        errors: errorsOf(tally),
        signals: sortedCounts(tally.signals),
        usage: usage ? { credits: fromUnits(creditUnits), credit_type: usage.credit_type } : null,
      };
    }

    const values = Object.values(stageOut);
    let status: PhaseStatus;
    if (values.length === 0) {
      // No stage of this phase is in the plan: the scope leaves it out.
      if (phaseStarts.has(phase)) status = phaseEnds.has(phase) ? "completed" : "in-flight";
      else if (plan !== null || phasesSkipped.has(phase)) status = "skipped";
      else status = "pending";
    } else if (values.some((s) => s.status === "in-flight" || s.status === "awaiting-approval" || s.status === "revising")) {
      status = "in-flight";
    } else if (values.every((s) => s.status === "skipped")) {
      status = "skipped";
    } else if (values.every((s) => s.status === "completed" || s.status === "skipped")) {
      status = "completed";
    } else if (values.every((s) => s.status === "pending")) {
      status = "pending";
    } else {
      status = "in-flight"; // between stages
    }

    const starts = values.map((s) => s.started_at).filter((v): v is string => v !== null);
    const startedAt = phaseStarts.get(phase) ?? (starts.length ? starts.sort()[0] : null);
    let completedAt: string | null = null;
    if (status === "completed") {
      const ends = [...values.map((s) => s.completed_at), phaseEnds.get(phase) ?? null].filter((v): v is string => v !== null);
      completedAt = ends.length ? ends.sort()[ends.length - 1] : null;
    }
    const wait = list.reduce(
      (sum, { slug }) => sum + (stageOut[slug].status === "completed" ? (stages.get(slug)?.waitSeconds ?? 0) : 0),
      0,
    );
    out[phase] = {
      status,
      duration: startedAt && completedAt ? formatDuration(secondsBetween(startedAt, completedAt)) : null,
      human_wait: completedAt ? formatDuration(wait) : null,
      started_at: startedAt,
      completed_at: completedAt,
      errors: errorsOf(phaseTally),
      signals: sortedCounts(phaseTally.signals),
      usage: usage ? { credits: fromUnits(phaseUnits), credit_type: usage.credit_type } : null,
      stages: stageOut,
    };
  }
  return {
    phases: out,
    errors: { ...errorsOf(intentTally), unassigned },
    signals: sortedCounts(intentTally.signals),
    usage,
  };
}

// --- registry -------------------------------------------------------------------------
type RegistryEntry = { uuid?: unknown; slug?: unknown; dirName?: unknown; scope?: unknown; status?: unknown };

function readRegistry(path: string): Map<string, RegSnapshot> {
  const out = new Map<string, RegSnapshot>();
  const raw = readJson<unknown>(path);
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as RegistryEntry;
    const dir = str(r.dirName);
    if (!dir || out.has(dir)) continue;
    out.set(dir, { slug: str(r.slug), uuid: str(r.uuid), status: str(r.status), scope: str(r.scope) });
  }
  return out;
}

// --- output ---------------------------------------------------------------------------
type IntentEntry = {
  intent_identified: string;
  harness: HarnessInfo | null; // the install that writes this file; null outside an install
  scope_used: string | null;
  scope_changes: { from: string | null; to: string; at: string }[];
  intent_id: string | null;
  space: string;
  record: string;
  request: string | null;
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  errors: IntentErrors;
  signals: Signals;
  usage: IntentUsage;
  phases: Record<string, PhaseOut>;
};
type RunKind = "delta" | "sweep" | "rebuild";
type TelemetryDoc = {
  schema_version: number;
  plugin: string;
  updated_at: string; // when this intent's values last changed
  last_update: {
    mode: "sensor" | "reconcile";
    stage?: string;
    kind: "delta" | "rebuild";
    reason?: string;
  };
  intent: IntentEntry;
};

// Render an entry from the record's timeline. The state file (cached, see
// syncState) and project-description.json fill in only what the audit cannot.
// `existing` (the current telemetry.json) supplies the turns of sessions this
// machine cannot read.
function renderEntry(project: string, key: string, rc: RecordCursor, existing: TelemetryDoc | null): IntentEntry {
  if (!rc.request) {
    const description = str(readJson<unknown>(join(project, key, "project-description.json")));
    if (description) rc.request = description; // written once at intent creation
  }
  const { phases, errors, signals, usage } = renderPhases(rc, usageTurns(rc, existing)); // also sorts rc.events
  const started = rc.events.find((e) => e.e === "WORKFLOW_STARTED") ?? null;
  const completed = rc.events.findLast((e) => e.e === "WORKFLOW_COMPLETED") ?? null;
  const scopeChanges = rc.events
    .filter((e) => e.e === "SCOPE_CHANGED" && e.f?.["New Scope"])
    .map((e) => ({ from: e.f?.["Old Scope"] ?? null, to: e.f!["New Scope"], at: e.at }));
  const startedRequest = started?.f?.Request?.replace(/^\/aidlc\b\s*/i, "").trim() || null;
  const dir = key.slice(key.lastIndexOf("/") + 1);
  const harness = harnessInfo();
  return {
    intent_identified: rc.reg?.slug ?? (dir.replace(/^\d{6}-/, "") || dir),
    harness: harness ? { ...harness } : null,
    scope_used: scopeChanges.at(-1)?.to ?? started?.f?.Scope ?? rc.state?.scope ?? rc.reg?.scope ?? null,
    scope_changes: scopeChanges,
    intent_id: rc.reg?.uuid ?? null,
    space: spaceOf(key),
    record: key,
    request: rc.request ?? startedRequest ?? rc.state?.project ?? null,
    status: rc.reg?.status ?? rc.state?.status ?? null,
    started_at: started?.at ?? rc.state?.start ?? null,
    completed_at: completed?.at ?? null,
    errors,
    signals,
    usage,
    phases,
  };
}

const sameEntry = (a: IntentEntry, b: IntentEntry): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameStat = (a: FileStat | null | undefined, b: FileStat | null): boolean =>
  !a ? b === null : b !== null && a.size === b.size && a.mtimeMs === b.mtimeMs;

// --- run --------------------------------------------------------------------------------
type RunOptions = { mode: "sensor" | "reconcile"; stage?: string; target: string | null; full: boolean; rebuild: boolean };
type RunTotals = {
  kind: RunKind; // the widest kind any space ran
  reason?: string;
  checked: number;
  updated: string[]; // telemetry.json (and telemetry.md) rewritten
  restored: string[]; // only telemetry.md rewritten
  rebuilt: number; // existing intents recomputed from offset 0
  busy: string[]; // spaces skipped because another run held their lock
  legacyRemoved: boolean;
  stats: SyncStats;
};
type RunResult = { status: "disabled" | "no-workspace" } | ({ status: "done" } & RunTotals);
const KIND_RANK: Record<RunKind, number> = { delta: 0, sweep: 1, rebuild: 2 };

type IntentOutcome = "updated" | "restored" | "unchanged" | "absent";

// Delta-update one intent: its cursor, telemetry.json and telemetry.md.
function processIntent(
  project: string,
  key: string,
  reg: RegSnapshot | null,
  opts: RunOptions,
  rebuild: boolean,
  totals: RunTotals,
  now: string,
): IntentOutcome {
  const recordDir = join(project, key);
  if (!existsSync(recordDir) || (reg === null && !isRecordDir(recordDir))) return "absent";
  const outDir = join(recordDir, OUTPUT_DIR);
  const outPath = join(outDir, OUTPUT_FILE);
  const reportPath = join(outDir, REPORT_FILE);
  const cursorPath = join(outDir, CURSOR_FILE);

  const outBytes = readBuf(outPath);
  let existing: TelemetryDoc | null = null;
  if (outBytes !== null) {
    try {
      existing = JSON.parse(outBytes.toString("utf8")) as TelemetryDoc;
    } catch {
      existing = null;
    }
  }
  const outputValid = existing !== null && existing.schema_version === OUTPUT_SCHEMA && isPlainObject(existing.intent);
  const stored = rebuild ? null : readCursor(cursorPath);
  let reason: string | undefined;
  if (rebuild) reason = "requested";
  else if (!stored) reason = outBytes === null ? "new" : "no cursor";
  else if (stored.output_sha256 !== (outBytes ? sha256(outBytes) : null)) reason = "telemetry.json does not match the cursor";
  else if (outBytes !== null && !outputValid) reason = "telemetry.json schema changed";
  const kind = reason ? "rebuild" : "delta";
  if (reason && reason !== "new") totals.rebuilt++;

  const base = kind === "delta" && stored ? stored : emptyRecord();
  base.reg = reg;
  const rc = syncRecord(project, key, base, totals.stats);
  syncState(project, key, rc);
  syncSessions(project, key, rc, totals.stats);
  const entry = renderEntry(project, key, rc, existing);
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(outDir, ".gitignore"))) writeFileSync(join(outDir, ".gitignore"), GITIGNORE);

  // telemetry.json: rewritten only when the intent's values changed.
  let outcome: IntentOutcome = "unchanged";
  let doc: TelemetryDoc;
  if (outputValid && sameEntry(existing!.intent, entry)) {
    doc = existing!;
    rc.output_sha256 = sha256(outBytes!);
  } else {
    doc = {
      schema_version: OUTPUT_SCHEMA,
      plugin: PLUGIN,
      updated_at: now,
      last_update: { mode: opts.mode, ...(opts.stage ? { stage: opts.stage } : {}), kind, ...(reason ? { reason } : {}) },
      intent: entry,
    };
    const body = `${JSON.stringify(doc, null, 2)}\n`;
    writeAtomic(outPath, body);
    rc.output_sha256 = sha256(body);
    outcome = "updated";
  }

  // telemetry.md follows telemetry.json. It is also re-rendered when it is
  // missing, was changed by someone else, or the renderer changed.
  const reportStat = statOf(reportPath);
  const reportCurrent =
    outcome === "unchanged" && rc.report !== null && rc.report.version === REPORT_VERSION && sameStat(rc.report, reportStat);
  if (!reportCurrent) {
    const body = renderReport(doc);
    if (readText(reportPath) !== body) {
      writeAtomic(reportPath, body);
      if (outcome === "unchanged") outcome = "restored";
    }
    const st = statOf(reportPath);
    rc.report = st ? { ...st, version: REPORT_VERSION } : null;
  }

  const cursorBody = `${JSON.stringify(rc)}\n`;
  if (cursorBody !== readText(cursorPath)) writeAtomic(cursorPath, cursorBody);
  return outcome;
}

// The active intent's record dir in a space, if it exists.
function activeDirOf(project: string, space: string): string | null {
  const dir = readText(join(project, "aidlc", "spaces", space, "intents", "active-intent"))?.trim();
  if (!dir) return null;
  const key = recordKey(space, dir);
  return isValidKey(key) && existsSync(join(project, key)) ? dir : null;
}

// Delta-update one space: decide its candidates, then process each intent.
function processSpace(project: string, space: string, activeSpace: string, opts: RunOptions, totals: RunTotals, now: string): void {
  const intentsDir = join(project, "aidlc", "spaces", space, "intents");
  if (!existsSync(intentsDir)) return;
  const indexPath = join(intentsDir, INDEX_FILE);
  const regPath = join(intentsDir, "intents.json");
  const activeDir = space === activeSpace ? activeDirOf(project, space) : null;
  const targetDir = opts.target && spaceOf(opts.target) === space ? opts.target.slice(opts.target.lastIndexOf("/") + 1) : null;
  const sweepDue = (ix: SpaceIndex | null): boolean =>
    opts.mode === "reconcile" && (!ix?.last_sweep_at || Date.now() - Date.parse(ix.last_sweep_at) > SWEEP_INTERVAL_MS);

  // Cheap look first, without the lock: a space with nothing to do is left alone.
  const peek = readIndex(indexPath);
  if (!peek && !existsSync(regPath) && !listDirs(intentsDir).some((d) => isRecordDir(join(intentsDir, d)))) return;
  const needed =
    opts.rebuild ||
    opts.full ||
    !peek ||
    sweepDue(peek) ||
    activeDir !== null ||
    targetDir !== null ||
    peek.active !== activeDir ||
    !sameStat(peek.registry, statOf(regPath));
  if (!needed) return;

  const result = withLock(join(intentsDir, LOCK_FILE), () => {
    const index = readIndex(indexPath);
    let kind: RunKind = "delta";
    let reason: string | undefined;
    if (opts.rebuild) [kind, reason] = ["rebuild", "requested"];
    else if (!index) [kind, reason] = ["sweep", "no index"];
    else if (opts.full) [kind, reason] = ["sweep", "requested"];
    else if (sweepDue(index)) [kind, reason] = ["sweep", "daily check"];
    const ix: SpaceIndex = index ?? { schema_version: INDEX_SCHEMA, registry: null, reg: {}, active: null, last_sweep_at: null };
    const indexBefore = JSON.stringify(ix);

    const candidates = new Set<string>();
    const regStat = statOf(regPath);
    if (kind !== "delta" || !sameStat(ix.registry, regStat)) {
      const reg = regStat ? readRegistry(regPath) : new Map<string, RegSnapshot>();
      for (const [dir, snap] of reg) {
        if (JSON.stringify(ix.reg[dir] ?? null) !== JSON.stringify(snap)) candidates.add(dir);
      }
      for (const dir of Object.keys(ix.reg)) if (!reg.has(dir)) candidates.add(dir); // dropped from the registry
      ix.reg = Object.fromEntries(reg);
      ix.registry = regStat;
    }
    if (activeDir) candidates.add(activeDir);
    if (targetDir) candidates.add(targetDir);
    if (ix.active && ix.active !== activeDir) candidates.add(ix.active); // its last events land before the switch
    ix.active = activeDir;
    if (kind !== "delta") {
      for (const dir of Object.keys(ix.reg)) candidates.add(dir);
      for (const dir of listDirs(intentsDir)) if (isRecordDir(join(intentsDir, dir))) candidates.add(dir);
      ix.last_sweep_at = now;
    }

    for (const dir of [...candidates].sort()) {
      const key = recordKey(space, dir);
      if (!isValidKey(key)) continue;
      const outcome = processIntent(project, key, ix.reg[dir] ?? null, opts, kind === "rebuild", totals, now);
      if (outcome === "absent") continue;
      totals.checked++;
      if (outcome === "updated") totals.updated.push(key);
      if (outcome === "restored") totals.restored.push(key);
    }
    if (KIND_RANK[kind] > KIND_RANK[totals.kind]) {
      totals.kind = kind;
      totals.reason = reason;
    }
    const indexAfter = JSON.stringify(ix);
    if (!index || indexAfter !== indexBefore) writeAtomic(indexPath, `${indexAfter}\n`);
  });
  if (result === "busy") totals.busy.push(space);
}

// Earlier versions wrote one workspace-level aidlc/amadeus-telemetry/ folder.
// Remove only the files this plugin wrote there; anything else (and so the
// folder) is left alone.
function removeLegacyFolder(project: string): boolean {
  const dir = join(project, ...LEGACY_DIR);
  if (!existsSync(dir)) return false;
  const doc = readJson<{ plugin?: unknown }>(join(dir, "telemetry.json"));
  const cursor = readJson<{ records?: unknown }>(join(dir, ".cursor.json"));
  if (doc?.plugin !== PLUGIN && !isPlainObject(cursor?.records)) return false;
  for (const f of LEGACY_FILES) rmSync(join(dir, f), { force: true });
  if (readText(join(dir, ".gitignore")) === LEGACY_GITIGNORE) rmSync(join(dir, ".gitignore"), { force: true });
  try {
    rmdirSync(dir);
  } catch {
    /* other files remain */
  }
  return true;
}

// Exclusive lock file. Busy -> skip; a lock older than LOCK_STALE_MS is taken over.
function withLock<T>(path: string, fn: () => T): T | "busy" {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch {
      const st = statOf(path);
      if (st && Date.now() - st.mtimeMs <= LOCK_STALE_MS) return "busy";
      rmSync(path, { force: true }); // stale, or released in between
      continue;
    }
    try {
      writeFileSync(fd, `${process.pid} ${nowIso()}\n`);
    } finally {
      closeSync(fd);
    }
    try {
      return fn();
    } finally {
      rmSync(path, { force: true });
    }
  }
  return "busy";
}

function run(opts: RunOptions): RunResult {
  if (process.env.AMADEUS_TELEMETRY_DISABLE === "1") return { status: "disabled" };
  const project = resolveProject();
  if (project === null) return { status: "no-workspace" };
  const totals: RunTotals = {
    kind: "delta",
    checked: 0,
    updated: [],
    restored: [],
    rebuilt: 0,
    busy: [],
    legacyRemoved: removeLegacyFolder(project),
    stats: { shardsRead: 0, bytesRead: 0, recordsRebuilt: 0, logsRead: 0, logBytesRead: 0 },
  };
  const now = nowIso();
  const activeSpace = readText(join(project, "aidlc", "active-space"))?.trim() || "default";
  for (const space of listDirs(join(project, "aidlc", "spaces"))) {
    try {
      processSpace(project, space, activeSpace, opts, totals, now);
    } catch (e) {
      debug(`space ${space}: ${(e as Error).message}`);
    }
  }
  return { status: "done", ...totals };
}

function describe(r: RunResult): string {
  if (r.status !== "done") return "";
  const legacy = r.legacyRemoved ? ["removed the old workspace-level aidlc/amadeus-telemetry/ files"] : [];
  if (r.checked === 0 && r.busy.length === 0) return `${PLUGIN}: ${["nothing to record yet", ...legacy].join("; ")}`;
  const names = (keys: string[]): string => keys.map((k) => k.slice(k.lastIndexOf("/") + 1)).join(", ");
  const rebuilt = r.rebuilt + r.stats.recordsRebuilt;
  const parts = [
    `${r.kind}${r.reason ? ` (${r.reason})` : ""}`,
    `checked ${r.checked} intent(s)`,
    `updated ${r.updated.length}${r.updated.length ? ` (${names(r.updated)})` : ""}`,
    ...(r.restored.length ? [`report restored ${r.restored.length} (${names(r.restored)})`] : []),
    `read ${r.stats.bytesRead} byte(s) from ${r.stats.shardsRead} shard(s)`,
    ...(r.stats.logsRead ? [`read ${r.stats.logBytesRead} byte(s) from ${r.stats.logsRead} session file(s)`] : []),
    ...(rebuilt ? [`rebuilt ${rebuilt} intent(s) from offset 0`] : []),
    ...(r.busy.length ? [`skipped ${r.busy.join(", ")} (another run holds the lock)`] : []),
    ...legacy,
    r.updated.length
      ? `wrote ${OUTPUT_DIR}/${OUTPUT_FILE} and ${REPORT_FILE}`
      : r.restored.length
        ? `wrote ${OUTPUT_DIR}/${REPORT_FILE}`
        : "no files changed",
  ];
  return `${PLUGIN}: ${parts.join("; ")}`;
}

// Entry point. Returns the exit code (always 0) rather than exiting, so a process
// that loads this module (the hook, core's sensor worker) keeps running.
export function main(args: string[] = process.argv.slice(2)): number {
  argv = args;
  // Per-run lookups, cleared so a second call in the same process starts fresh.
  kiroWorkspaceDirs = null;
  vscodeSessionDirs = null;
  bindingMemo = null;
  const reconcile = argv.includes("--reconcile");
  const opts: RunOptions = reconcile
    ? { mode: "reconcile", target: null, full: argv.includes("--full"), rebuild: argv.includes("--rebuild") }
    : {
        mode: "sensor",
        ...(arg("--stage") ? { stage: arg("--stage") } : {}),
        target: keyFromPath(arg("--output-path") ?? ""),
        full: false,
        rebuild: false,
      };
  let result: RunResult | null = null;
  try {
    result = run(opts);
  } catch (e) {
    debug(`${opts.mode} run failed: ${(e as Error).message}`);
  }
  if (reconcile) {
    const line = result && argv.includes("--verbose") ? describe(result) : "";
    if (line) process.stdout.write(`${line}\n`);
    return 0;
  }
  // Sensor mode: whatever happened, report a pass. Telemetry must never block a
  // gate or show up as a sensor script error.
  process.stdout.write(`${JSON.stringify({ pass: true, findings_count: 0 })}\n`);
  return 0;
}

// Run only when executed as a script; a loading process calls main() itself.
if (import.meta.main) process.exit(main());
