// amadeus-telemetry-report.ts — renders an intent's telemetry.md from its
// telemetry.json (amadeus-telemetry plugin).
//
// This is the code form of plugins/amadeus-telemetry/report-instructions.md. Every
// rule there (derived values, labels, layout, wording) is implemented here, and a
// change to one must be made to the other.
//
// Pure: no file I/O, no clock. The same telemetry.json always renders the same
// report, so telemetry.md changes only when the data does. The collector
// (aidlc-sensor-amadeus-telemetry.ts) writes it next to telemetry.json.

// Error counts (schema 4). Older files have none, and render without them.
export type ReportErrors = { total: number; by_kind: Record<string, number>; by_source: Record<string, number> };
// Credits (schema 5; credit_type from schema 6). null or absent: not tracked;
// rendered without them.
export type ReportUsage = { credits: number; credit_type?: string };
export type ReportIntentUsage = {
  source: string;
  unit: string;
  credit_type?: string;
  credits: number;
  unassigned: number;
  split_turns: number;
  turns: { session: string; started_at: string; ended_at: string; credits: number; stage: string | null }[];
};
export type ReportStage = {
  status: string;
  duration: string | null;
  human_wait: string | null;
  started_at: string | null;
  completed_at: string | null;
  units: number;
  errors?: ReportErrors;
  signals?: Record<string, number>;
  usage?: ReportUsage | null;
};
export type ReportPhase = {
  status: string;
  duration: string | null;
  human_wait: string | null;
  started_at: string | null;
  completed_at: string | null;
  errors?: ReportErrors;
  signals?: Record<string, number>;
  usage?: ReportUsage | null;
  stages: Record<string, ReportStage>;
};
// The harness of the install that wrote the file (schema 6). Absent in older files:
// rendered without the Harness line.
export type ReportHarness = { name: string; product: string | null };
export type ReportIntent = {
  intent_identified: string;
  harness?: ReportHarness | null;
  scope_used: string | null;
  scope_changes: { from: string | null; to: string; at: string }[];
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  errors?: ReportErrors & { unassigned: number };
  signals?: Record<string, number>;
  usage?: ReportIntentUsage | null;
  phases: Record<string, ReportPhase>;
};
export type ReportDoc = { updated_at: string; intent: ReportIntent };

// Bump when the rendered layout or wording changes, so existing reports are
// re-rendered on upgrade even when their telemetry.json is unchanged.
export const REPORT_VERSION = 7;

const ACTIVE = new Set(["in-flight", "awaiting-approval", "revising"]);
const STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  "in-flight": "In progress",
  "awaiting-approval": "Awaiting approval",
  revising: "Revising",
  completed: "Completed",
  skipped: "Skipped",
};
const INTENT_STATUS_LABEL: Record<string, string> = {
  "in-flight": "In progress",
  complete: "Completed",
  completed: "Completed",
  archived: "Archived",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A completed stage is called out when at least this share of it was human wait.
const WAIT_SHARE = 0.5;

// Error kinds, singular and plural, in the Errors bullet.
const KIND_LABEL: Record<string, [string, string]> = {
  tool_error: ["tool error", "tool errors"],
  sensor_failed: ["sensor failure", "sensor failures"],
  sensor_script_error: ["sensor script error", "sensor script errors"],
  sensor_timeout: ["sensor timeout", "sensor timeouts"],
  run_failure: ["failed run", "failed runs"],
  guard_block: ["guard block", "guard blocks"],
};

// Credit units, in the Harness line, the Usage bullet and the Credits column headers.
const UNIT_LABEL: Record<string, string> = { "kiro-credit": "Kiro credits", "copilot-credit": "Copilot credits" };
// The product that records each source's credits, in the Harness line.
const SOURCE_PRODUCT: Record<string, string> = { "kiro-ide": "Kiro IDE", "kiro-cli": "Kiro CLI", vscode: "VS Code" };
// The note's last sentence when credits are tracked, by source.
const USAGE_NOTE: Record<string, string> = {
  "kiro-ide":
    "Credits are the Kiro credits Kiro IDE records for each turn. A turn counts for the stage it spent the most time in. " +
    "Kiro IDE records no token counts.",
  "kiro-cli":
    "Credits are the Kiro credits Kiro CLI records for each turn. A turn counts for the stage it spent the most time in. " +
    "Token counts are not reported.",
  vscode:
    "Credits are the GitHub Copilot credits VS Code records for each chat request (a turn). " +
    "A turn counts for the stage it spent the most time in. Token counts are not reported.",
};
const USAGE_NOTE_OTHER = "Credits are recorded per turn. A turn counts for the stage it spent the most time in.";

const NOTE_START =
  "*Active = duration minus human wait. Human wait is time spent waiting for answers or approval, including any time away. " +
  "Durations appear once an item finishes. ";
const ERRORS_SENTENCE =
  "Errors counts each failed tool command, sensor failure, sensor script error or timeout, failed run and guard block in the audit. ";
const NOTE = `${NOTE_START}Errors and token usage are not tracked.*`;
const NOTE_ERRORS = `${NOTE_START}${ERRORS_SENTENCE}Token usage is not tracked.*`;
const noteWithUsage = (source: string): string => `${NOTE_START}${ERRORS_SENTENCE}${USAGE_NOTE[source] ?? USAGE_NOTE_OTHER}*`;
const FOOTER = "*Generated from `telemetry.json` by the amadeus-telemetry plugin. Edits to this file are not kept.*";

// --- values ------------------------------------------------------------------------
// "2h 5m 18s" -> seconds; null for null or unreadable text.
export function parseDuration(text: string | null): number | null {
  if (!text) return null;
  const unit: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let matched = false;
  for (const m of text.matchAll(/(\d+)\s*([dhms])/g)) {
    total += Number(m[1]) * unit[m[2]];
    matched = true;
  }
  return matched ? total : null;
}

// Largest unit first; once a unit is shown every smaller one is too; zero is "0s".
export function formatDuration(seconds: number): string {
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

// Words kept upper-case in display names.
const ACRONYMS: Record<string, string> = { ci: "CI", nfr: "NFR", ui: "UI", api: "API" };
// "requirements-analysis" -> "Requirements analysis", "ci-pipeline" -> "CI pipeline"
const displayName = (slug: string): string => {
  const words = slug.split("-").filter(Boolean).map((w) => ACRONYMS[w] ?? w);
  if (words.length === 0) return slug;
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(" ");
};
// Lower-case the first letter for mid-sentence use, unless it starts an acronym.
const lowerFirst = (s: string): string => (!s || /^[A-Z]{2}/.test(s) ? s : s[0].toLowerCase() + s.slice(1));
const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

// "a", "a and b", "a, b and c"
function joinAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Largest count first, then by name.
const byCount = (counts: Record<string, number> | undefined): [string, number][] =>
  Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));

const kindText = ([kind, n]: [string, number]): string => {
  const words = KIND_LABEL[kind] ?? [kind.replace(/_/g, " "), `${kind.replace(/_/g, " ")}s`];
  return `${n} ${words[n === 1 ? 0 : 1]}`;
};

// Credits to two decimal places.
const creditText = (credits: number): string => (Math.round(credits * 100) / 100).toFixed(2);

function fullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${iso.slice(11, 19)} UTC`;
}

// --- report ------------------------------------------------------------------------
type StageRow = { slug: string; s: ReportStage; dur: number | null; wait: number | null };

export function renderReport(doc: ReportDoc): string {
  const intent = doc.intent;
  const snapshot = doc.updated_at;
  const phases = Object.entries(intent.phases ?? {});
  const stages: StageRow[] = phases.flatMap(([, p]) =>
    Object.entries(p.stages ?? {}).map(([slug, s]) => ({
      slug,
      s,
      dur: parseDuration(s.duration),
      wait: parseDuration(s.human_wait),
    })),
  );

  // Times drop the date when every time in the file is on the snapshot's date.
  const allTimes = [
    snapshot,
    intent.started_at,
    intent.completed_at,
    ...intent.scope_changes.map((c) => c.at),
    ...phases.flatMap(([, p]) => [p.started_at, p.completed_at]),
    ...stages.flatMap((r) => [r.s.started_at, r.s.completed_at]),
  ].filter((t): t is string => typeof t === "string");
  const oneDay = allTimes.every((t) => t.slice(0, 10) === snapshot.slice(0, 10));
  const shortTime = (iso: string): string => {
    if (oneDay) return iso.slice(11, 19);
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${iso.slice(11, 19)}`;
  };

  const activeOf = (dur: number | null, wait: number | null): number | null =>
    dur !== null && wait !== null ? Math.max(0, dur - wait) : null;
  const timeCell = (status: string, value: number | null): string =>
    ACTIVE.has(status) ? "running" : value === null ? "–" : formatDuration(value);
  const label = (status: string): string => STATUS_LABEL[status] ?? upperFirst(status);
  const phaseLabel = (p: ReportPhase): string =>
    p.status === "skipped" && Object.keys(p.stages ?? {}).length === 0 ? "Skipped (not in scope)" : label(p.status);

  // Summary line.
  const completed = !!intent.completed_at;
  const elapsed = intent.started_at ? secondsBetween(intent.started_at, completed ? intent.completed_at! : snapshot) : null;
  const done = stages.filter((r) => r.s.status === "completed").length;
  const skipped = stages.filter((r) => r.s.status === "skipped").length;
  const status = intent.status ? (INTENT_STATUS_LABEL[intent.status] ?? upperFirst(intent.status)) : completed ? "Completed" : "In progress";
  const summary = [
    `${intent.scope_used ?? "unknown"} scope`,
    status,
    ...(elapsed === null ? [] : [`${formatDuration(elapsed)} ${completed ? "total" : "elapsed"}`]),
    `${done} of ${stages.length} stages complete${skipped ? `, ${skipped} skipped` : ""}`,
  ].join(" · ");

  // Bullets, each only when it applies.
  const bullets: string[] = [];
  const current = stages.find((r) => ACTIVE.has(r.s.status)) ?? null;
  const next = stages.find((r, i) => i > (current ? stages.indexOf(current) : -1) && r.s.status === "pending") ?? null;
  if (current) {
    const started = current.s.started_at ? `, started ${shortTime(current.s.started_at)}` : "";
    bullets.push(
      `**Now:** ${displayName(current.slug)} (${lowerFirst(label(current.s.status))}${started}).` +
        (next ? ` Next: ${lowerFirst(displayName(next.slug))}.` : ""),
    );
  } else if (!completed && next) {
    bullets.push(`**Next:** ${displayName(next.slug)}.`);
  }
  const errors = intent.errors ?? null; // null: a file from before error counts
  if (errors && errors.total > 0) {
    const kinds = byCount(errors.by_kind);
    let text = kinds.length === 1 ? `${kindText(kinds[0])}.` : `${errors.total} (${kinds.map(kindText).join(", ")}).`;
    const [top, topCount] = byCount(errors.by_source)[0] ?? [null, 0];
    if (top) {
      const where = stages.filter((r) => (r.s.errors?.by_source?.[top] ?? 0) > 0).map((r) => lowerFirst(displayName(r.slug)));
      const inStages = where.length ? `, in ${joinAnd(where)}` : "";
      if (topCount === errors.total) text += ` All came from ${top}${inStages}.`;
      else if (topCount * 2 > errors.total) text += ` Most came from ${top}: ${topCount}${inStages}.`;
      else text += ` The largest share came from ${top}: ${topCount}${inStages}.`;
    }
    if (errors.unassigned > 0) text += ` ${errors.unassigned} could not be tied to a stage.`;
    bullets.push(`**Errors:** ${text}`);
  }
  const usage = intent.usage ?? null; // null: credits not tracked (other harness, or a file from before them)
  const turnCount = usage?.turns?.length ?? 0;
  if (usage && usage.credits > 0 && turnCount > 0) {
    let text = `${creditText(usage.credits)} ${UNIT_LABEL[usage.unit] ?? "credits"} over ${turnCount} turn${turnCount === 1 ? "" : "s"}.`;
    // Largest first; ties keep table order.
    const spent = stages.filter((r) => (r.s.usage?.credits ?? 0) > 0).sort((a, b) => b.s.usage!.credits - a.s.usage!.credits);
    const top = spent[0];
    if (top) {
      const name = lowerFirst(displayName(top.slug));
      const credits = top.s.usage!.credits;
      if (spent.length === 1 && !(usage.unassigned > 0)) text += ` All went to ${name}.`;
      else if (credits * 2 > usage.credits) text += ` Most went to ${name}: ${creditText(credits)}.`;
      else text += ` The largest share went to ${name}: ${creditText(credits)}.`;
    }
    if (usage.unassigned > 0) text += ` ${creditText(usage.unassigned)} could not be tied to a stage.`;
    if (usage.split_turns > 0) {
      text += turnCount === 1 ? " The turn crossed a stage boundary." : ` ${usage.split_turns} of the ${turnCount} turns crossed a stage boundary.`;
    }
    bullets.push(`**Usage:** ${text}`);
  }
  const waited = stages
    .filter((r) => r.s.status === "completed" && r.dur && r.wait !== null && r.wait / r.dur >= WAIT_SHARE)
    .sort((a, b) => b.wait! - a.wait!)[0];
  if (waited) {
    bullets.push(
      `**Waiting:** ${Math.round((waited.wait! / waited.dur!) * 100)}% of ${lowerFirst(displayName(waited.slug))} ` +
        `(${waited.s.human_wait} of ${waited.s.duration}) was spent waiting on a person.`,
    );
  }
  if (intent.scope_changes.length > 0) {
    bullets.push(
      `**Scope:** changed ${intent.scope_changes
        .map((c) => `from ${c.from ?? "unknown"} to ${c.to} at ${shortTime(c.at)}`)
        .join(", then ")}.`,
    );
  }

  // Two sections, each with its own table: phase-level information in "Phases",
  // stage-level information in "Stages".
  const units = stages.some((r) => r.s.units > 0);
  // `–` for a pending row with no errors, and for a phase the scope leaves out.
  const errorCell = (status: string, e: ReportErrors | undefined, outOfScope: boolean): string =>
    outOfScope || (status === "pending" && !e?.total) ? "–" : String(e?.total ?? 0);
  // Credits follow the same rule as errors.
  const creditCell = (status: string, u: ReportUsage | null | undefined, outOfScope: boolean): string =>
    outOfScope || (status === "pending" && !u?.credits) ? "–" : creditText(u?.credits ?? 0);
  const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  const table = (headers: string[], rows: string[]): string[] => [row(headers), `|${headers.map(() => "---|").join("")}`, ...rows];

  // Phase table: one row per phase.
  const phaseRows = phases.map(([name, p]) => {
    const dur = parseDuration(p.duration);
    const wait = parseDuration(p.human_wait);
    const outOfScope = p.status === "skipped" && Object.keys(p.stages ?? {}).length === 0;
    return row([
      displayName(name),
      phaseLabel(p),
      timeCell(p.status, dur),
      timeCell(p.status, wait),
      timeCell(p.status, activeOf(dur, wait)),
      ...(errors ? [errorCell(p.status, p.errors, outOfScope)] : []),
      ...(usage ? [creditCell(p.status, p.usage, outOfScope)] : []),
    ]);
  });
  // The Credits column says which credits they are ("Kiro credits", "Copilot credits").
  const creditsHeader = usage ? upperFirst(UNIT_LABEL[usage.unit] ?? "credits") : "Credits";
  const phaseHeaders = [
    "Phase",
    "Status",
    "Duration",
    "Human wait",
    "Active",
    ...(errors ? ["Errors"] : []),
    ...(usage ? [creditsHeader] : []),
  ];

  // Stage table: every stage of every phase, with the phase it belongs to.
  const stageRows = phases.flatMap(([name, p]) =>
    Object.entries(p.stages ?? {}).map(([slug, s]) => {
      const sd = parseDuration(s.duration);
      const sw = parseDuration(s.human_wait);
      return row([
        displayName(name),
        displayName(slug),
        label(s.status),
        timeCell(s.status, sd),
        timeCell(s.status, sw),
        timeCell(s.status, activeOf(sd, sw)),
        ...(errors ? [errorCell(s.status, s.errors, false)] : []),
        ...(usage ? [creditCell(s.status, s.usage, false)] : []),
        ...(units ? [String(s.units)] : []),
      ]);
    }),
  );
  const stageHeaders = [
    "Phase",
    "Stage",
    "Status",
    "Duration",
    "Human wait",
    "Active",
    ...(errors ? ["Errors"] : []),
    ...(usage ? [creditsHeader] : []),
    ...(units ? ["Units"] : []),
  ];
  const note = usage ? noteWithUsage(usage.source) : errors ? NOTE_ERRORS : NOTE;

  // Harness line (schema 6): the harness, and which credits the report's figures are.
  let harnessLine: string | null = null;
  if (intent.harness !== undefined) {
    const h = intent.harness;
    const harnessText = !h ? "not recorded" : h.product ? `${h.product} (\`${h.name}\`)` : `\`${h.name}\``;
    const by = usage && SOURCE_PRODUCT[usage.source] ? `, recorded by ${SOURCE_PRODUCT[usage.source]}` : "";
    const creditsText = usage ? `${upperFirst(UNIT_LABEL[usage.unit] ?? "credits")}${by}` : "not tracked";
    harnessLine = `**Harness:** ${harnessText} · **Credits:** ${creditsText}`;
  }

  // Errors tables: what the errors were and where they came from, one table for
  // phases and one for stages, each only for rows that have errors. With the
  // not-tied row, each table's Errors column adds up to the intent's total.
  const phaseErrorRows: string[] = [];
  const stageErrorRows: string[] = [];
  if (errors && errors.total > 0) {
    const kindsCell = (counts: Record<string, number> | undefined): string =>
      byCount(counts).map(kindText).join(", ") || "–";
    const sourcesCell = (counts: Record<string, number> | undefined): string =>
      byCount(counts)
        .map(([source, n]) => `${source.replace(/\|/g, "\\|")}: ${n}`)
        .join(", ") || "–";
    const phaseKinds = new Map<string, number>();
    const phaseSources = new Map<string, number>();
    const addTo = (m: Map<string, number>, counts: Record<string, number> | undefined): void => {
      for (const [k, n] of Object.entries(counts ?? {})) m.set(k, (m.get(k) ?? 0) + n);
    };
    for (const [name, p] of phases) {
      addTo(phaseKinds, p.errors?.by_kind);
      addTo(phaseSources, p.errors?.by_source);
      if ((p.errors?.total ?? 0) > 0) {
        phaseErrorRows.push(row([displayName(name), String(p.errors!.total), kindsCell(p.errors!.by_kind), sourcesCell(p.errors!.by_source)]));
      }
      for (const [slug, s] of Object.entries(p.stages ?? {})) {
        if ((s.errors?.total ?? 0) === 0) continue;
        stageErrorRows.push(
          row([displayName(name), displayName(slug), String(s.errors!.total), kindsCell(s.errors!.by_kind), sourcesCell(s.errors!.by_source)]),
        );
      }
    }
    // Errors not tied to a stage (and so to no phase): the intent's counts minus every phase's.
    if (errors.unassigned > 0) {
      const rest = (all: Record<string, number> | undefined, assigned: Map<string, number>): Record<string, number> =>
        Object.fromEntries(Object.entries(all ?? {}).map(([k, n]) => [k, n - (assigned.get(k) ?? 0)]));
      const kinds = kindsCell(rest(errors.by_kind, phaseKinds));
      const sources = sourcesCell(rest(errors.by_source, phaseSources));
      phaseErrorRows.push(row(["*Not tied to a phase*", String(errors.unassigned), kinds, sources]));
      stageErrorRows.push(row(["–", "*Not tied to a stage*", String(errors.unassigned), kinds, sources]));
    }
  }

  const out: string[] = [`# AI-DLC telemetry: ${intent.intent_identified}`, "", `*Snapshot ${fullTime(snapshot)}*`, ""];
  if (harnessLine) out.push(harnessLine, "");
  out.push(summary, "");
  if (bullets.length) out.push(...bullets.map((b) => `- ${b}`), "");
  out.push("## Phases", "", ...table(phaseHeaders, phaseRows), "");
  if (phaseErrorRows.length) out.push("**Errors by phase**", "", ...table(["Phase", "Errors", "Kinds", "Sources"], phaseErrorRows), "");
  if (stageRows.length) {
    out.push("## Stages", "", ...table(stageHeaders, stageRows), "");
    if (stageErrorRows.length) out.push("**Errors by stage**", "", ...table(["Phase", "Stage", "Errors", "Kinds", "Sources"], stageErrorRows), "");
  }
  out.push(note, "", FOOTER, "");
  return out.join("\n");
}
