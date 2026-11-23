// aidlc-sensor-octane-format.ts — ADVISORY Octane test-case format + coverage
// gate (core build-and-test Octane sensor).
//
// Reads octane-import.json (emitted by the build-and-test stage when the user
// opts into Octane generation) and reports malformed Octane test cases and any
// functional requirement not covered by a test case. ADVISORY (no blocking
// severity in the framework yet). Needs only the --output-path the dispatcher
// always passes. Ships in core tools (<harness>/tools/).
import { existsSync, readFileSync } from "node:fs";

// Self-contained — no import of the framework's aidlc-lib, so the sensor script
// can run standalone from the dispatcher.
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Result {
  pass: boolean;
  findings_count: number;
  invalid_test_cases: string[];
  uncovered_requirements: string[];
}

interface Flags {
  stage?: string;
  outputPath?: string;
}

interface TestCase {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  origin?: unknown;
  source_test?: unknown;
  steps?: unknown;
  gherkin?: unknown;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--stage") out.stage = argv[++i];
    else if (argv[i] === "--output-path") out.outputPath = argv[++i];
  }
  return out;
}

function fail(msg: string): never {
  process.stderr.write(`aidlc-sensor-octane-format: ${msg}\n`);
  process.exit(1);
}

// Pass-through when the sensor fired on a write it doesn't own (the dispatcher
// fires on EVERY write under the record dir, not just this sensor's JSON) or
// when Octane was not requested (bundle absent).
function passThrough(): never {
  process.stdout.write(
    `${JSON.stringify({ pass: true, findings_count: 0, invalid_test_cases: [], uncovered_requirements: [] })}\n`,
  );
  process.exit(0);
}

// A test case is well-formed when it has a non-empty id, name, a recognised
// type, a recognised origin, and the body that type/origin requires:
//   - manual → non-empty steps[]
//   - gherkin → non-empty gherkin string
//   - origin "projected" → non-empty source_test (back-reference to the real
//     code-level test it mirrors, so the Octane set stays a projection, not a
//     drifting parallel suite)
// Returns the offending id/label when invalid.
function invalidReason(tc: TestCase, index: number): string | null {
  const label =
    typeof tc.id === "string" && tc.id.length > 0 ? tc.id : `#${index}`;
  if (typeof tc.id !== "string" || tc.id.length === 0) return `${label}: missing id`;
  if (typeof tc.name !== "string" || tc.name.length === 0) return `${label}: missing name`;
  if (tc.type !== "manual" && tc.type !== "gherkin") return `${label}: invalid type`;
  if (tc.origin !== "projected" && tc.origin !== "authored") {
    return `${label}: invalid or missing origin (expected "projected" or "authored")`;
  }
  if (tc.type === "manual" && !(Array.isArray(tc.steps) && tc.steps.length > 0)) {
    return `${label}: manual case has no steps`;
  }
  if (tc.type === "gherkin" && !(typeof tc.gherkin === "string" && tc.gherkin.trim().length > 0)) {
    return `${label}: gherkin case has no scenario body`;
  }
  if (tc.origin === "projected" && !(typeof tc.source_test === "string" && tc.source_test.trim().length > 0)) {
    return `${label}: projected case has no source_test back-reference`;
  }
  return null;
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.outputPath) fail("--output-path is required");
  if (!flags.outputPath.endsWith("octane-import.json")) passThrough();
  if (!existsSync(flags.outputPath)) passThrough();

  let parsed: {
    test_cases?: TestCase[];
    requirements?: Record<string, { covered?: boolean }>;
  };
  try {
    parsed = JSON.parse(readFileSync(flags.outputPath, "utf-8"));
  } catch (err) {
    fail(`failed to parse Octane bundle ${flags.outputPath}: ${errorMessage(err)}`);
  }

  const testCases = Array.isArray(parsed.test_cases) ? parsed.test_cases : [];
  const invalid_test_cases = testCases
    .map((tc, i) => invalidReason(tc, i))
    .filter((r): r is string => r !== null);

  const reqs = parsed.requirements ?? {};
  const uncovered_requirements = Object.entries(reqs)
    .filter(([, v]) => v?.covered !== true)
    .map(([k]) => k)
    .sort();

  const findings_count = invalid_test_cases.length + uncovered_requirements.length;
  const result: Result = {
    pass: findings_count === 0,
    findings_count,
    invalid_test_cases,
    uncovered_requirements,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
