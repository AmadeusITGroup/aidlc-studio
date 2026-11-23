// aidlc-audit-view.ts — Read-only human digest of the audit log.
//
// The machine audit log (per-clone shards under <record>/audit/*.md) stays the
// single source of truth: every event, every field, byte-for-byte, exactly as
// the engine/doctor/swarm parsers require. This tool NEVER writes to it and
// NEVER appends an audit event. It only READS the shards and renders a compact,
// milestone-first view — the "clear and simple" digest, inspired by the axiom
// collection's audit-trail.md.
//
// Two tiers drive the view (see MILESTONE_EVENTS below):
//   - milestone: workflow/phase/stage boundaries, gates, bolts, reviews,
//     learnings — shown by default.
//   - trace: scaffold/scan/session/artifact/sensor/dispatch noise — shown only
//     with --trace.
//
// Usage:
//   bun tools/aidlc-audit-view.ts                 milestone digest, stdout
//   bun tools/aidlc-audit-view.ts --trace         full timeline (all events)
//   bun tools/aidlc-audit-view.ts --out <path>    also write the digest to a file
//   bun tools/aidlc-audit-view.ts --intent <slug> --space <name>   explicit target
//
// Read-only classification: never advances the workflow, never emits audit
// events, never mutates state. It resolves paths and reads; that is all.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import {
  activeIntent,
  activeSpace,
  auditBlockField,
  errorMessage,
  readAllAuditShards,
  recordDir,
  resolveProjectDir,
} from "./aidlc-lib.ts";

// The human-readable digest lives at the RECORD ROOT (a sibling of the machine
// `audit/` shard dir), so it is obviously the derived human view and is
// version-controlled alongside the record.
export const HUMAN_AUDIT_FILENAME = "audit-trail.md";

// --- Parsed event shape --------------------------------------------------------

interface AuditEvent {
  event: string;
  timestamp: string;
  block: string;
  pos: number;
}

// --- Tier classification -------------------------------------------------------
//
// Milestone = the boundaries and human-facing decisions a reader wants. Every
// event NOT in this set is treated as `trace` and hidden unless --trace is set.
// This is a presentation-only classification; it does not touch the canonical
// VALID_EVENT_TYPES in aidlc-audit.ts, so the machine log is unaffected.
const MILESTONE_EVENTS = new Set<string>([
  "WORKFLOW_STARTED",
  "WORKFLOW_COMPLETED",
  "WORKFLOW_PARKED",
  "WORKFLOW_UNPARKED",
  "PHASE_STARTED",
  "PHASE_SKIPPED",
  "STAGE_COMPLETED",
  "STAGE_SKIPPED",
  "STAGE_JUMPED",
  "GATE_APPROVED",
  "GATE_REJECTED",
  "BOLT_FAILED",
  "REVIEW_COMPLETED",
  "RULE_LEARNED",
  "RECOMPOSED",
  "SCOPE_CHANGED",
]);

// --- Argument parsing ----------------------------------------------------------

interface Args {
  trace: boolean;
  out: string | null;
  intent: string | undefined;
  space: string | undefined;
  projectDir: string | undefined;
}

function fail(message: string): never {
  process.stderr.write(`aidlc-audit-view: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    trace: false,
    out: null,
    intent: undefined,
    space: undefined,
    projectDir: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--trace":
        args.trace = true;
        break;
      case "--out":
      case "--intent":
      case "--space":
      case "--project-dir": {
        const val = argv[++i];
        if (val === undefined || val.startsWith("--")) {
          fail(`${a} expects a value.`);
        }
        if (a === "--out") args.out = val;
        else if (a === "--intent") args.intent = val;
        else if (a === "--space") args.space = val;
        else args.projectDir = val;
        break;
      }
      case "--help":
      case "-h":
        process.stdout.write(HELP_TEXT);
        process.exit(0);
        break;
      default:
        fail(`unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP_TEXT = `aidlc-audit-view — read-only human digest of the audit log

  --trace             show every event (default: milestone events only)
  --out <path>        write the digest to <path> in addition to stdout
  --intent <slug>     target a specific intent record (default: active intent)
  --space <name>      target a specific space (default: active space)
  --project-dir <p>   project root (default: auto-resolved)
  -h, --help          show this help

Reads the audit shards and renders them. Writes no audit event and mutates no
state.
`;

// --- Parsing the shards --------------------------------------------------------

// Split the concatenated shard buffer into events, sorted CHRONOLOGICALLY (by
// ISO timestamp, ties broken by buffer position) — the same ordering contract
// findAllEvents() uses, because shards concatenate in filename order, not time
// order.
function parseEvents(audit: string): AuditEvent[] {
  const blocks = audit.replace(/\r\n/g, "\n").split(/\n---\n/);
  const events: AuditEvent[] = [];
  let pos = 0;
  for (const block of blocks) {
    const eventMatch = block.match(/^\*\*Event\*\*:\s*(\S+)\s*$/m);
    const tsMatch = block.match(/^\*\*Timestamp\*\*:\s*(\S+)/m);
    if (eventMatch && tsMatch) {
      events.push({ event: eventMatch[1], timestamp: tsMatch[1], block, pos });
    }
    pos++;
  }
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.pos - b.pos;
  });
  return events;
}

function field(ev: AuditEvent, name: string): string | null {
  return auditBlockField(ev.block, name);
}

// Date + time rendering: ISO `2026-07-30T04:06:31Z` -> `2026-07-30 04:06:31`,
// so every entry carries its date (multi-day runs stay unambiguous). Falls back
// to the raw value if it is not the expected shape.
function stamp(timestamp: string): string {
  const m = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : timestamp;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// Append a section header, guaranteeing a blank line before it (unless it opens
// the document) so the Markdown renders cleanly.
function pushHeader(out: string[], text: string): void {
  if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  out.push(text);
}

// --- Milestone line formatting -------------------------------------------------

// Per-stage rollup: who approved, how many revisions, the reviewer verdict, and
// the verified artifact fingerprint — folded onto the stage's completion line so
// there is no separate Gate Decisions block. Last occurrence wins (events are
// chronological), so a re-approved stage reflects its final actor.
interface StageContext {
  approvedBy: Map<string, string>;
  revisions: Map<string, number>;
  reviewVerdict: Map<string, string>;
  reviewFingerprint: Map<string, string>;
}

function buildStageContext(events: AuditEvent[]): StageContext {
  const approvedBy = new Map<string, string>();
  const revisions = new Map<string, number>();
  const reviewVerdict = new Map<string, string>();
  const reviewFingerprint = new Map<string, string>();
  for (const ev of events) {
    const stage = field(ev, "Stage");
    if (!stage) continue;
    if (ev.event === "GATE_APPROVED") {
      approvedBy.set(stage, field(ev, "Actor") || "unknown");
    } else if (ev.event === "GATE_REJECTED") {
      revisions.set(stage, (revisions.get(stage) ?? 0) + 1);
    } else if (ev.event === "REVIEW_COMPLETED") {
      const verdict = field(ev, "Verdict");
      if (verdict) reviewVerdict.set(stage, verdict);
      const fp = field(ev, "Artifact Fingerprint");
      if (fp && /^sha256:[0-9a-f]{64}$/.test(fp)) reviewFingerprint.set(stage, fp);
    }
  }
  return { approvedBy, revisions, reviewVerdict, reviewFingerprint };
}

// Inline suffix for a completed stage: reviewer verdict, approver, revisions.
function stageAnnotations(stage: string, ctx: StageContext): string {
  const parts: string[] = [];
  const actor = ctx.approvedBy.get(stage);
  if (actor !== undefined) {
    parts.push(actor !== "unknown" ? `approved by ${actor}` : "gate approved");
  }
  const revs = ctx.revisions.get(stage) ?? 0;
  if (revs > 0) parts.push(`${revs} revision${revs === 1 ? "" : "s"}`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

// Truncated, verified fingerprint sub-line (or null when the stage has none).
// Indented to sit under the stage line's content (past the timestamp column).
// The label names WHAT the hash covers: the reviewer fingerprint is always over
// the stage's declared record artifacts (markdown docs), never the workspace
// source code — so code-generation is called out explicitly to avoid implying
// the generated source is hashed.
const STAMP_INDENT = " ".repeat(21);
function fingerprintSubline(stage: string, ctx: StageContext): string | null {
  const fp = ctx.reviewFingerprint.get(stage);
  if (!fp) return null;
  const short = `${fp.slice(0, "sha256:".length + 12)}…`;
  const label =
    stage === "code-generation"
      ? "plan/design docs (source not hashed)"
      : "artifacts";
  return `${STAMP_INDENT}${label} ${short} (verified)`;
}

// One-line summary for a milestone event, WITHOUT the leading timestamp (the
// caller prepends it). Returns null for events that are rendered elsewhere
// (phase headers, gate decisions, skipped-phase list) or that carry no line.
function milestoneLine(ev: AuditEvent, ctx: StageContext): string | null {
  switch (ev.event) {
    // WORKFLOW_STARTED / WORKFLOW_COMPLETED are represented in the header and
    // Delivery Summary, so they carry no timeline line of their own.
    case "WORKFLOW_STARTED":
    case "WORKFLOW_COMPLETED":
      return null;
    case "WORKFLOW_PARKED":
      return `Workflow parked at ${field(ev, "Stage") ?? "?"}`;
    case "WORKFLOW_UNPARKED":
      return "Workflow resumed";
    case "STAGE_COMPLETED": {
      const stage = field(ev, "Stage") ?? "?";
      return `Stage: ${stage} ✓${stageAnnotations(stage, ctx)}`;
    }
    case "STAGE_SKIPPED":
      return `Stage: ${field(ev, "Stage") ?? "?"} — skipped (${field(ev, "Reason") ?? "no reason"})`;
    case "STAGE_JUMPED":
      return `Jumped ${field(ev, "Direction") ?? "?"}: ${field(ev, "Source") ?? "?"} → ${field(ev, "Target") ?? "?"}`;
    case "BOLT_FAILED":
      return `Bolt ${field(ev, "Failed Bolt") ?? "?"} FAILED · ${field(ev, "Error summary") ?? ""}`;
    case "REVIEW_COMPLETED":
      return null; // folded into the stage's completion line
    case "RULE_LEARNED":
      return `Learning kept · ${field(ev, "Stage") ?? "?"} → ${field(ev, "Destination") ?? "?"}`;
    case "RECOMPOSED":
      return `Recomposed · +${field(ev, "Stages added") ?? "0"} / -${field(ev, "Stages skipped") ?? "0"} stages`;
    case "SCOPE_CHANGED":
      return `Scope changed: ${field(ev, "Old scope") ?? "?"} → ${field(ev, "New scope") ?? "?"}`;
    default:
      return null; // PHASE_STARTED / PHASE_SKIPPED / GATE_* handled separately
  }
}

// Generic one-line fallback for the --trace view: `EVENT_NAME · k=v; k=v`,
// skipping the always-present Timestamp/Event scaffolding.
function traceLine(ev: AuditEvent): string {
  const pairs: string[] = [];
  for (const raw of ev.block.split("\n")) {
    const line = raw.startsWith("- ") ? raw.slice(2) : raw;
    const m = line.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (key === "Timestamp" || key === "Event") continue;
    pairs.push(`${key}=${m[2].trim()}`);
  }
  const detail = pairs.length > 0 ? ` · ${pairs.join("; ")}` : "";
  return `${ev.event}${detail}`;
}

// --- Rendering -----------------------------------------------------------------

function renderHeader(events: AuditEvent[]): string[] {
  const started = events.find((e) => e.event === "WORKFLOW_STARTED");
  const completed = events.find((e) => e.event === "WORKFLOW_COMPLETED");
  const parked = events.find((e) => e.event === "WORKFLOW_PARKED");
  const scope = started ? (field(started, "Scope") ?? "?") : "?";
  const request = started ? (field(started, "Request") ?? "") : "";

  let status = "IN PROGRESS";
  if (completed) status = "COMPLETE";
  else if (parked) status = "PARKED";

  const lines: string[] = [`# AI-DLC Audit — ${scope}`, ""];
  if (request) lines.push(`**Request:** ${request}`);
  const startedAt = started?.timestamp ?? "?";
  const endedAt = completed?.timestamp ?? parked?.timestamp ?? null;
  lines.push(
    `**Started:** ${startedAt}` +
      (endedAt ? ` · **Ended:** ${endedAt}` : "") +
      ` · **Status:** ${status}`,
  );
  lines.push("", "---", "");
  return lines;
}

function renderMilestoneView(events: AuditEvent[]): string {
  const ctx = buildStageContext(events);
  const out: string[] = renderHeader(events);

  // Phase-grouped timeline. A PHASE_STARTED opens a section; milestone lines
  // that follow (until the next PHASE_STARTED) land under it. Events before the
  // first PHASE_STARTED (rare) fall under an "Ungrouped" heading.
  let openPhase = false;
  const skipped: string[] = [];

  for (const ev of events) {
    // Phase 2 tiering: the milestone view shows only milestone-tier events.
    if (!MILESTONE_EVENTS.has(ev.event)) continue;
    if (ev.event === "PHASE_SKIPPED") {
      skipped.push(
        `${stamp(ev.timestamp)}  Phase: ${field(ev, "Phase") ?? "?"} — ${field(ev, "Reason") ?? "excluded by scope"}`,
      );
      continue;
    }
    if (ev.event === "PHASE_STARTED") {
      pushHeader(out, `## ${capitalize(field(ev, "Phase") ?? "phase")}`);
      openPhase = true;
      continue;
    }
    // Approvals, rejections, and reviews are folded onto the stage line via
    // stageAnnotations / the fingerprint sub-line, so they carry no line here.
    if (
      ev.event === "GATE_APPROVED" ||
      ev.event === "GATE_REJECTED" ||
      ev.event === "REVIEW_COMPLETED"
    ) {
      continue;
    }
    const line = milestoneLine(ev, ctx);
    if (line === null) continue;
    if (!openPhase) {
      pushHeader(out, "## Timeline");
      openPhase = true;
    }
    out.push(`${stamp(ev.timestamp)}  ${line}`);
    // Verified fingerprint sub-line under a completed reviewer stage.
    if (ev.event === "STAGE_COMPLETED") {
      const fp = fingerprintSubline(field(ev, "Stage") ?? "", ctx);
      if (fp) out.push(fp);
    }
  }

  if (skipped.length > 0) {
    out.push("", "## Skipped", ...skipped);
  }

  // Delivery Summary — verbatim Details from WORKFLOW_COMPLETED, when present.
  const completed = events.find((e) => e.event === "WORKFLOW_COMPLETED");
  const details = completed ? field(completed, "Details") : null;
  if (details) {
    out.push("", "## Delivery Summary", details);
  }

  return `${out.join("\n").trimEnd()}\n`;
}

function renderTraceView(events: AuditEvent[]): string {
  const out: string[] = renderHeader(events);
  let openPhase = false;
  for (const ev of events) {
    if (ev.event === "PHASE_STARTED") {
      pushHeader(out, `## ${capitalize(field(ev, "Phase") ?? "phase")}`);
      openPhase = true;
      continue;
    }
    if (!openPhase) {
      pushHeader(out, "## Timeline");
      openPhase = true;
    }
    out.push(`${stamp(ev.timestamp)}  ${traceLine(ev)}`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// --- Public API ----------------------------------------------------------------

// Render a shard buffer to the digest string. `trace` selects the full-timeline
// view; otherwise the milestone digest. Pure — no I/O.
export function renderAuditView(audit: string, opts: { trace: boolean }): string {
  const events = parseEvents(audit);
  if (events.length === 0) return "# AI-DLC Audit\n\nNo audit events recorded yet.\n";
  return opts.trace ? renderTraceView(events) : renderMilestoneView(events);
}

// Regenerate the persistent human-readable digest at `<record>/audit-trail.md`
// from the current shards. Best-effort and side-effect-scoped: it READS the
// shards and WRITES only the digest file — it never emits an audit event and
// never mutates workflow state. Returns the written path, or null when no
// record/audit exists yet (bare space root, or no events). Callers on the audit
// write path MUST wrap this so a render failure can never break the audit
// write itself.
export function refreshHumanAudit(
  projectDir: string,
  intent?: string,
  space?: string,
): string | null {
  const dir = recordDir(projectDir, intent, space);
  if (dir === null) return null;
  const audit = readAllAuditShards(projectDir, intent, space);
  if (audit.trim() === "") return null;
  const outPath = join(dir, HUMAN_AUDIT_FILENAME);
  writeFileSync(outPath, renderAuditView(audit, { trace: false }), "utf-8");
  return outPath;
}

// --- CLI -----------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = resolveProjectDir(args.projectDir);
  const space = args.space ?? activeSpace(projectDir);
  const intent = activeIntent(projectDir, space, args.intent);

  if (intent === null) {
    fail(
      "no active intent resolved — pass --intent <slug> (and --space if needed). " +
        "A fresh workspace has no audit log yet.",
    );
  }

  const audit = readAllAuditShards(projectDir, intent, space);
  const rendered = renderAuditView(audit, { trace: args.trace });
  process.stdout.write(rendered);

  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : resolvePath(process.cwd(), args.out);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, rendered, "utf-8");
      process.stderr.write(`aidlc-audit-view: wrote ${outPath}\n`);
    } catch (e) {
      fail(`could not write --out ${outPath}: ${errorMessage(e)}`);
    }
  }
}

if (import.meta.main) main();
