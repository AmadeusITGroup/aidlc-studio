#!/usr/bin/env bun
// amadeus-audit-view.ts — Amadeus audit digest + gate-actor reconciliation.
//
// WHY THIS EXISTS: shipped Amadeus generated a curated, human-readable audit
// trail — `<record>/audit-trail.md`, the `# AI-DLC Audit — <scope>` digest with
// per-phase stage completions, "approved by <actor>", skipped phases, and a
// delivery summary — via a core tool `aidlc-audit-view.ts`. CURRENT AWS core
// DROPPED that tool entirely: unmodified core keeps only the machine-readable
// per-clone shards under `<record>/audit/*.md` and ships no human digest. So an
// additive plugin over bare core has no `audit-trail.md`. This tool restores it,
// and in `--reconcile` mode also stamps WHO approved each gate.
//
// WHY THE RECONCILE LIVES HERE (and not in a hook script). Amadeus's one
// divergence from core is attributing a gate approval to a person; core's
// GATE_APPROVED row carries no actor and there is no additive seam to add a
// field to it, so the plugin keeps a supplementary ledger beside the shard.
// That used to be a separate PostToolUse hook script (amadeus-gate-actor.ts)
// which duplicated this file's shard globbing and Markdown parsing and then
// shelled back into this tool to regenerate the digest. Folding it in as
// `--reconcile` leaves ONE implementation of the parse and, because `tools/` is
// a contributed subtree that `plugin sync` projects automatically, nothing has
// to be delivered into an install — a registration alone is enough.
//
// AWS's plugin contract exposes exactly ONE hook trigger (SessionStart — see
// writeHookWiring in core's aidlc-plugin-emit.ts) and nothing that runs after a
// gate approval, so per-approval freshness cannot come from the contract. The
// registration is therefore one PostToolUse entry whose command is core's native
// hook route, `aidlc engine hook amadeus-audit-reconcile`. The installed `aidlc`
// resolves that to <leaf>/hooks/aidlc-amadeus-audit-reconcile.ts, a thin module
// that imports this file and calls runReconcile(). Both the module and the
// registration are installed by scripts/setup/amadeus-audit-hooks.ts:
//   * kiro-ide  drop-in <leaf>/hooks/amadeus-audit-reconcile.json.
//   * kiro-cli  a reversible merge into hooks.postToolUse[] of agents/aidlc.json.
//   * copilot   a reversible merge into .github/hooks/aidlc.json PostToolUse[].
// The launcher also runs `--reconcile` at session start, so the first session
// (before the PostToolUse entry has ever fired) and harnesses with no
// registration still converge.
//
// Two differences from the old core tool, both forced by the additive model:
//   1. It is fully SELF-CONTAINED — it globs the audit shards and parses the
//      Markdown blocks itself (no `aidlc-lib` import), so it cannot break on a
//      core refactor.
//   2. The "approved by <actor>" attribution comes from the plugin actor ledger
//      (audit/amadeus/gate-actor.jsonl, written by `--reconcile`), NOT from an
//      `Actor` field on the core GATE_APPROVED row — unmodified core omits that
//      field (it was a core edit with no additive seam).
//
// The digest is written INSIDE the audit folder, in the plugin's namespaced
// subdir beside the actor ledger: `<record>/audit/amadeus/audit-trail.md`.
// Why not a direct child `<record>/audit/audit-trail.md`: core's auditShards()
// does a NON-recursive readdir of `<record>/audit/` and merges EVERY `*.md` as a
// shard — a direct child would be mis-read as audit content. One level deeper in
// `audit/amadeus/` is still "inside the audit folder" but is invisible to core's
// non-recursive glob (and to our own `audit/*.md` shard glob, which only
// collects files whose parent dir is exactly `audit`). It is a derived view:
// read-only w.r.t. the shards, never emits an audit event, never mutates state.
//
// Usage:
//   bun amadeus-audit-view.ts [--project <dir>]            print the digest(s)
//   bun amadeus-audit-view.ts --write [--project <dir>]    (re)write audit-trail.md
//   bun amadeus-audit-view.ts --reconcile                  stamp actors + rewrite (hook mode)
//   bun amadeus-audit-view.ts --trace                      full timeline
//   bun amadeus-audit-view.ts --json                       gate-approval rows as JSON
//   Env fallback: AIDLC_PROJECT_DIR.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const LEDGER_SUBDIR = "amadeus";
const LEDGER_NAME = "gate-actor.jsonl";
export const HUMAN_AUDIT_FILENAME = "audit-trail.md";

// Continuation indent for wrapped milestone detail (artifact hash lines). The
// milestone writer emits `<19-char stamp><2 spaces><text>`, so 23 hangs the
// detail two columns inside the text column.
const DETAIL_INDENT = " ".repeat(23);

// Milestone-tier events (the boundaries + human decisions a reader wants).
// Everything else is trace-tier, shown only with --trace.
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

// --- args ----------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
// An explicit --project / AIDLC_PROJECT_DIR always wins. Otherwise prefer the
// nearest ancestor of cwd that actually carries a workflow (aidlc/spaces): the
// launcher and the PostToolUse hook both invoke this from the project root, but
// a hand-run from a subdirectory should still find the workflow rather than
// silently reporting "no audit shards".
function resolveProject(): string {
  const explicit = arg("--project") ?? process.env.AIDLC_PROJECT_DIR;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "aidlc", "spaces"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

// --- shard discovery (self-contained) -----------------------------------------
function basenameDir(dir: string): string {
  const parts = dir.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}
// Every `*.md` whose parent dir is `audit`, under <project>/aidlc/spaces.
function findAuditShards(projectDir: string): string[] {
  const root = join(projectDir, "aidlc", "spaces");
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".md") && basenameDir(dir) === "audit") out.push(p);
    }
  };
  walk(root, 0);
  return out;
}
// <record> for a shard at <record>/audit/<shard>.md
function recordDirForShard(shardPath: string): string {
  return dirname(dirname(shardPath));
}

// --- audit block parsing (self-contained) --------------------------------------
interface AuditEvent {
  event: string;
  timestamp: string;
  block: string;
  pos: number;
}
// Read a `**Field**:` value from a block (also tolerates a leading `- ` bullet).
function auditBlockField(block: string, name: string): string | null {
  const re = new RegExp(`^\\s*(?:- )?\\*\\*${name}\\*\\*:\\s*(.+?)\\s*$`, "m");
  return block.match(re)?.[1] ?? null;
}
function field(ev: AuditEvent, name: string): string | null {
  return auditBlockField(ev.block, name);
}
// Parse a concatenated shard buffer into events, sorted chronologically.
function parseEvents(audit: string): AuditEvent[] {
  const blocks = audit.replace(/\r\n/g, "\n").split(/\n---\n/);
  const events: AuditEvent[] = [];
  let pos = 0;
  for (const block of blocks) {
    const eventMatch = block.match(/^\*\*Event\*\*:\s*(\S+)\s*$/m);
    const tsMatch = block.match(/^\*\*Timestamp\*\*:\s*(\S+)/m);
    if (eventMatch && tsMatch) events.push({ event: eventMatch[1], timestamp: tsMatch[1], block, pos });
    pos++;
  }
  events.sort((a, b) => (a.timestamp !== b.timestamp ? (a.timestamp < b.timestamp ? -1 : 1) : a.pos - b.pos));
  return events;
}

// --- actor ledger join ---------------------------------------------------------
// timestamp|stage -> actor, from the plugin ledger beside a record's audit dir.
function loadActorMap(recordDir: string): Map<string, string> {
  const m = new Map<string, string>();
  const ledgerPath = join(recordDir, "audit", LEDGER_SUBDIR, LEDGER_NAME);
  if (!existsSync(ledgerPath)) return m;
  let text: string;
  try {
    text = readFileSync(ledgerPath, "utf8");
  } catch {
    return m;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as { timestamp: string; stage: string; actor: string };
      m.set(`${row.timestamp}|${row.stage}`, row.actor);
    } catch {
      /* skip malformed */
    }
  }
  return m;
}

// --- actor ledger reconciliation (--reconcile) ----------------------------------
// Best-effort actor label. Same fallback chain the retired core `resolveActor`
// used, so ledgers written by the previous hook stay consistent with new rows.
// This is self-reported clone identity, not authenticated: core's own
// audit-format notes that shards are operational evidence, not a tamper-proof
// authorship boundary. Treat it as attribution, not proof.
function resolveActor(projectDir: string): string {
  try {
    const r = spawnSync("git", ["config", "user.name"], { cwd: projectDir, encoding: "utf-8" });
    if (r.status === 0) {
      const name = (r.stdout ?? "").trim();
      if (name) return name;
    }
  } catch {
    /* git missing / not a repo — fall through */
  }
  try {
    const user = userInfo().username;
    if (user) return user;
  } catch {
    /* no OS identity — fall through */
  }
  return "unknown";
}

// LEVEL-TRIGGERED: reconciles the whole ledger against the canonical core
// GATE_APPROVED rows on every run rather than reacting to one event. That is why
// it self-heals — it does not matter which tool call fired the hook, whether a
// run was missed, or whether the approval landed while no hook was registered;
// the next run backfills every unrecorded approval. IDEMPOTENT via the
// timestamp|stage key, so re-firing appends nothing.
//
// The ledger path, row shape and dedup key are unchanged from the retired
// amadeus-gate-actor.ts hook, so existing ledgers keep working with no migration.
// It lives at <record>/audit/amadeus/gate-actor.jsonl — one level below the audit
// dir, because core's shard resolver does a NON-recursive readdir of
// <record>/audit/ and would otherwise merge a sibling file in as audit content.
function reconcileActorLedger(projectDir: string): number {
  const actor = resolveActor(projectDir);
  const recordedAt = new Date().toISOString();
  let appended = 0;
  for (const [recordDir, buffer] of shardsByRecord(projectDir)) {
    const seen = new Set(loadActorMap(recordDir).keys());
    const rows: string[] = [];
    for (const ev of parseEvents(buffer)) {
      if (ev.event !== "GATE_APPROVED") continue;
      const stage = field(ev, "Stage") ?? "";
      const key = `${ev.timestamp}|${stage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(JSON.stringify({ timestamp: ev.timestamp, stage, actor, recordedAt }));
    }
    if (rows.length === 0) continue;
    const ledgerPath = join(recordDir, "audit", LEDGER_SUBDIR, LEDGER_NAME);
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, `${rows.join("\n")}\n`);
    appended += rows.length;
  }
  return appended;
}

// --- rendering (ported from the old core aidlc-audit-view.ts) -------------------
function stamp(timestamp: string): string {
  const m = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : timestamp;
}
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
function pushHeader(out: string[], text: string): void {
  if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  out.push(text);
}

interface StageContext {
  approvedBy: Map<string, string>;
  revisions: Map<string, number>;
}
function buildStageContext(events: AuditEvent[], actorMap: Map<string, string>): StageContext {
  const approvedBy = new Map<string, string>();
  const revisions = new Map<string, number>();
  for (const ev of events) {
    const stage = field(ev, "Stage");
    if (!stage) continue;
    if (ev.event === "GATE_APPROVED") {
      // Actor from the plugin ledger (core row carries none); fall back to a
      // core Actor field if a future core adds one, else "unknown".
      const fromLedger = actorMap.get(`${ev.timestamp}|${stage}`);
      approvedBy.set(stage, fromLedger || field(ev, "Actor") || "unknown");
    } else if (ev.event === "GATE_REJECTED") {
      revisions.set(stage, (revisions.get(stage) ?? 0) + 1);
    }
  }
  return { approvedBy, revisions };
}
function stageAnnotations(stage: string, ctx: StageContext): string {
  const parts: string[] = [];
  const actor = ctx.approvedBy.get(stage);
  if (actor !== undefined) parts.push(actor !== "unknown" ? `approved by ${actor}` : "gate approved");
  const revs = ctx.revisions.get(stage) ?? 0;
  if (revs > 0) parts.push(`${revs} revision${revs === 1 ? "" : "s"}`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

// --- approved-artifact hashes ---------------------------------------------------
// Core already records a SHA-256 per artifact: `aidlc-validity.ts` spreads a
// `Validation Basis` field onto the main-workflow STAGE_COMPLETED row, and for a
// gated stage that row shares its timestamp with GATE_APPROVED — so the hashes of
// exactly what the human approved are a pure read, with nothing to recompute. On
// capture failure core substitutes a `Validation Warning` instead, so treat the
// basis as optional and say so rather than implying the stage produced nothing.
//
// Outputs only: those are the artifacts the stage produced and the gate approved.
// Inputs are in the basis too but belong to upstream stages' own lines. Full
// 64-hex digests are kept deliberately — a truncated hash cannot be verified
// against a file, which is the entire point of putting it in an audit trail.
interface ArtifactBasis {
  artifact?: unknown;
  contentHash?: unknown;
  presentCount?: unknown;
}
function approvedArtifactDetail(ev: AuditEvent): string[] {
  const raw = field(ev, "Validation Basis");
  if (raw === null) {
    const warning = field(ev, "Validation Warning");
    return warning === null ? [] : [`artifact hashes unavailable · ${warning}`];
  }
  let outputs: unknown;
  try {
    outputs = (JSON.parse(raw) as { outputs?: unknown }).outputs;
  } catch {
    return ["artifact hashes unavailable · validity receipt is not parseable JSON"];
  }
  if (!Array.isArray(outputs)) return [];
  const rows: { artifact: string; hash: string }[] = [];
  for (const entry of outputs as ArtifactBasis[]) {
    if (typeof entry?.artifact !== "string" || typeof entry?.contentHash !== "string") continue;
    // presentCount 0 = declared by the graph but never written; it was not approved.
    if (typeof entry.presentCount === "number" && entry.presentCount === 0) continue;
    rows.push({ artifact: entry.artifact, hash: entry.contentHash });
  }
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.artifact.length));
  return rows.map((r) => `${r.artifact.padEnd(width)}  ${r.hash}`);
}

// Returns the milestone's own line first, then any detail lines to hang under it.
function milestoneLines(ev: AuditEvent, ctx: StageContext): string[] | null {
  switch (ev.event) {
    case "WORKFLOW_STARTED":
    case "WORKFLOW_COMPLETED":
      return null;
    case "WORKFLOW_PARKED":
      return [`Workflow parked at ${field(ev, "Stage") ?? "?"}`];
    case "WORKFLOW_UNPARKED":
      return ["Workflow resumed"];
    case "STAGE_COMPLETED": {
      const stage = field(ev, "Stage") ?? "?";
      return [`Stage: ${stage} ✓${stageAnnotations(stage, ctx)}`, ...approvedArtifactDetail(ev)];
    }
    case "STAGE_SKIPPED":
      return [`Stage: ${field(ev, "Stage") ?? "?"} — skipped (${field(ev, "Reason") ?? "no reason"})`];
    case "STAGE_JUMPED":
      return [
        `Jumped ${field(ev, "Direction") ?? "?"}: ${field(ev, "Source") ?? "?"} → ${field(ev, "Target") ?? "?"}`,
      ];
    case "BOLT_FAILED":
      return [`Bolt ${field(ev, "Failed Bolt") ?? "?"} FAILED · ${field(ev, "Error summary") ?? ""}`];
    case "RULE_LEARNED":
      return [`Learning kept · ${field(ev, "Stage") ?? "?"} → ${field(ev, "Destination") ?? "?"}`];
    case "RECOMPOSED":
      return [`Recomposed · +${field(ev, "Stages added") ?? "0"} / -${field(ev, "Stages skipped") ?? "0"} stages`];
    case "SCOPE_CHANGED":
      return [`Scope changed: ${field(ev, "Old scope") ?? "?"} → ${field(ev, "New scope") ?? "?"}`];
    default:
      return null;
  }
}
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
  lines.push(`**Started:** ${startedAt}${endedAt ? ` · **Ended:** ${endedAt}` : ""} · **Status:** ${status}`);
  lines.push("", "---", "");
  return lines;
}
function renderMilestoneView(events: AuditEvent[], actorMap: Map<string, string>): string {
  const ctx = buildStageContext(events, actorMap);
  const out: string[] = renderHeader(events);
  let openPhase = false;
  const skipped: string[] = [];
  for (const ev of events) {
    if (!MILESTONE_EVENTS.has(ev.event)) continue;
    if (ev.event === "PHASE_SKIPPED") {
      skipped.push(`${stamp(ev.timestamp)}  Phase: ${field(ev, "Phase") ?? "?"} — ${field(ev, "Reason") ?? "excluded by scope"}`);
      continue;
    }
    if (ev.event === "PHASE_STARTED") {
      pushHeader(out, `## ${capitalize(field(ev, "Phase") ?? "phase")}`);
      openPhase = true;
      continue;
    }
    if (ev.event === "GATE_APPROVED" || ev.event === "GATE_REJECTED" || ev.event === "REVIEW_COMPLETED") continue;
    const lines = milestoneLines(ev, ctx);
    if (lines === null || lines.length === 0) continue;
    if (!openPhase) {
      pushHeader(out, "## Timeline");
      openPhase = true;
    }
    out.push(`${stamp(ev.timestamp)}  ${lines[0]}`);
    for (const detail of lines.slice(1)) out.push(`${DETAIL_INDENT}${detail}`);
  }
  if (skipped.length > 0) out.push("", "## Skipped", ...skipped);
  const completed = events.find((e) => e.event === "WORKFLOW_COMPLETED");
  const details = completed ? field(completed, "Details") : null;
  if (details) out.push("", "## Delivery Summary", details);
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
function renderAuditView(audit: string, actorMap: Map<string, string>, opts: { trace: boolean }): string {
  const events = parseEvents(audit);
  if (events.length === 0) return "# AI-DLC Audit\n\nNo audit events recorded yet.\n";
  return opts.trace ? renderTraceView(events) : renderMilestoneView(events, actorMap);
}

// --- record grouping -----------------------------------------------------------
// Map <record> -> concatenated shard buffer (filename order; events resorted by time).
function shardsByRecord(projectDir: string): Map<string, string> {
  const byRecord = new Map<string, string[]>();
  for (const shard of findAuditShards(projectDir).sort()) {
    const rec = recordDirForShard(shard);
    let text = "";
    try {
      text = readFileSync(shard, "utf8");
    } catch {
      continue;
    }
    const list = byRecord.get(rec) ?? [];
    list.push(text);
    byRecord.set(rec, list);
  }
  const merged = new Map<string, string>();
  for (const [rec, parts] of byRecord) merged.set(rec, parts.join("\n"));
  return merged;
}

// Regenerate <record>/audit-trail.md for every record dir with shards.
// Best-effort per record; returns the written paths. Never throws to the caller.
export function regenerateHumanAudit(projectDir: string): string[] {
  const written: string[] = [];
  for (const [rec, buffer] of shardsByRecord(projectDir)) {
    if (buffer.trim() === "") continue;
    try {
      const actorMap = loadActorMap(rec);
      const outPath = join(rec, "audit", LEDGER_SUBDIR, HUMAN_AUDIT_FILENAME);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, renderAuditView(buffer, actorMap, { trace: false }), "utf-8");
      written.push(outPath);
    } catch {
      /* per-record best-effort */
    }
  }
  return written;
}

// --- gate-approval rows (backward-compatible --json output) --------------------
function approvalRows(projectDir: string): { timestamp: string; stage: string; actor: string }[] {
  const rows: { timestamp: string; stage: string; actor: string }[] = [];
  for (const [rec, buffer] of shardsByRecord(projectDir)) {
    const actorMap = loadActorMap(rec);
    for (const ev of parseEvents(buffer)) {
      if (ev.event !== "GATE_APPROVED") continue;
      const stage = field(ev, "Stage") ?? "";
      const actor = actorMap.get(`${ev.timestamp}|${stage}`) || field(ev, "Actor") || "unknown";
      rows.push({ timestamp: ev.timestamp, stage, actor });
    }
  }
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows;
}

// Hook mode. NON-BLOCKING by construction: every failure is swallowed and the
// exit code is always 0, because this runs from a PostToolUse registration and
// must never break the user's tool call. Silent unless AIDLC_SDL_DEBUG is set.
// Exported so the hook module <leaf>/hooks/aidlc-amadeus-audit-reconcile.ts
// (run by `aidlc engine hook amadeus-audit-reconcile`) can call it in-process
// with the project it derives from its own location.
export function runReconcile(projectDir?: string): void {
  try {
    const project = projectDir ?? resolveProject();
    if (!existsSync(join(project, "aidlc", "spaces"))) return; // no workflow here
    const appended = reconcileActorLedger(project);
    const written = regenerateHumanAudit(project);
    if (process.env.AIDLC_SDL_DEBUG) {
      process.stderr.write(
        `amadeus-audit-view: reconciled ${appended} gate approval actor row(s), wrote ${written.length} digest(s)\n`,
      );
    }
  } catch {
    /* never break the tool call */
  }
}

function main(): void {
  // Checked before anything else so the hook path cannot be diverted by another
  // flag, and so it exits 0 on every outcome.
  if (process.argv.includes("--reconcile")) {
    runReconcile();
    return;
  }

  const project = resolveProject();
  const trace = process.argv.includes("--trace");

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(approvalRows(project), null, 2)}\n`);
    return;
  }

  if (process.argv.includes("--write")) {
    const paths = regenerateHumanAudit(project);
    if (paths.length === 0) process.stderr.write("amadeus-audit-view: no audit shards found; nothing written\n");
    else for (const p of paths) process.stderr.write(`amadeus-audit-view: wrote ${p}\n`);
    return;
  }

  const records = shardsByRecord(project);
  if (records.size === 0) {
    process.stdout.write("amadeus-audit-view: no audit shards found (no workflow run in this project yet).\n");
    return;
  }
  let first = true;
  for (const [rec, buffer] of records) {
    if (!first) process.stdout.write("\n");
    first = false;
    process.stdout.write(renderAuditView(buffer, loadActorMap(rec), { trace }));
  }
}

if (import.meta.main) main();
