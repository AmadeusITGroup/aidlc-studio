// Amadeus AI-DLC 2.5 install migration. Shipped in the Amadeus CLI runtime by
// scripts/patch-legacy-migration.ts; `aidlc config` calls it before setup reads
// the project.
//
// The 2.5 installer (scripts/install-aidlc.sh / .ps1) copied dist/<harness> into
// the project and listed every file it copied in <harnessDir>/.aidlc-install-manifest:
//   - kiro, kiro-ide: .kiro/.aidlc-install-manifest, entries relative to .kiro
//   - copilot:        .aidlc/.aidlc-install-manifest, entries relative to the
//                     project root, spanning .aidlc/, .github/ and .vscode/
// and wrapped its onboarding in AGENTS.md between the AMADEUS AI-DLC markers.
// Those trees carry no projection stamp or ownership baseline, so core cannot
// adopt them: it reads every unstamped .kiro as `kiro` and .aidlc as `aidlc`,
// refuses kiro-ide and copilot as colliding with them, and fails refreshing kiro
// on the 2.5 stage files.
//
// Migration removes the 2.5 install the way the 2.5 installer's --uninstall did:
// exactly the files the manifest lists, the manifest itself, and the AGENTS.md
// block, so setup then installs fresh. It keeps the aidlc/ workspace records
// (never listed in the manifest), every file the manifest does not list, and the
// team's MCP settings.

import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const LEGACY_MANIFEST = ".aidlc-install-manifest";
const AGENTS_FILE = "AGENTS.md";
const AGENTS_BEGIN = "<!-- BEGIN AMADEUS AI-DLC -->";
const AGENTS_END = "<!-- END AMADEUS AI-DLC -->";

// Shipped by 2.5 but edited per team (servers, tokens), so they stay in place
// unless the harness being set up ships its own copy: only Kiro CLI (`kiro`)
// ships .kiro/settings/mcp.json, and no harness ships .vscode/mcp.json.
function keptFiles(targetHarness: string): ReadonlySet<string> {
  return new Set(targetHarness === "kiro" ? [".vscode/mcp.json"] : [".kiro/settings/mcp.json", ".vscode/mcp.json"]);
}

type LegacyLayout = {
  harnessDir: ".kiro" | ".aidlc";
  // Where manifest entries resolve: inside harnessDir, or at the project root.
  entriesUnder: "harnessDir" | "projectRoot";
  trees: readonly string[];
};

const LAYOUTS: readonly LegacyLayout[] = [
  { harnessDir: ".kiro", entriesUnder: "harnessDir", trees: [".kiro"] },
  { harnessDir: ".aidlc", entriesUnder: "projectRoot", trees: [".aidlc", ".github", ".vscode"] },
];

export type AmadeusLegacyInstall = {
  harness: "kiro" | "kiro-ide" | "copilot";
  harnessDir: ".kiro" | ".aidlc";
  trees: readonly string[];
  // Project-relative, "/"-separated paths present on disk, the manifest last.
  remove: string[];
  // Project-relative paths the manifest lists that stay in place.
  keep: string[];
};

export type AmadeusLegacyProject = {
  projectDir: string;
  installs: AmadeusLegacyInstall[];
  agentsBlock: boolean;
};

export type AmadeusLegacyReport = {
  removed: number;
  kept: string[];
  agents: "stripped" | "removed" | "untouched";
};

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function regularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

// The 2.5 PowerShell installer writes CRLF and may write "\" separators.
function manifestEntries(manifestPath: string): string[] {
  const entries: string[] = [];
  for (const raw of readFileSync(manifestPath, "utf-8").split("\n")) {
    const entry = raw.replace(/\r$/, "").replaceAll("\\", "/").trim();
    if (!entry) continue;
    const segments = entry.split("/");
    if (
      entry.startsWith("/") ||
      /^[A-Za-z]:/.test(entry) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`${manifestPath}: invalid path in the Amadeus AI-DLC 2.5 install manifest: ${JSON.stringify(entry)}`);
    }
    entries.push(entry);
  }
  return entries;
}

function agentsLines(projectDir: string): string[] | null {
  const path = join(projectDir, AGENTS_FILE);
  if (!regularFile(path)) return null;
  return readFileSync(path, "utf-8").split("\n");
}

function hasAgentsBlock(lines: readonly string[] | null): boolean {
  if (!lines) return false;
  const trimmed = lines.map((line) => line.replace(/\r$/, ""));
  return trimmed.includes(AGENTS_BEGIN) && trimmed.includes(AGENTS_END);
}

function findInstall(projectDir: string, realProject: string, layout: LegacyLayout): AmadeusLegacyInstall | null {
  const manifestRel = `${layout.harnessDir}/${LEGACY_MANIFEST}`;
  const manifestPath = join(projectDir, manifestRel);
  if (!regularFile(manifestPath)) return null;
  // A stamped tree was set up by the CLI; a leftover 2.5 manifest there is inert.
  if (present(join(projectDir, layout.harnessDir, "tools", "data", "aidlc-stamp.json"))) return null;

  const listed = manifestEntries(manifestPath).map((entry) =>
    layout.entriesUnder === "harnessDir" ? `${layout.harnessDir}/${entry}` : entry
  );
  for (const path of listed) {
    if (!layout.trees.includes(path.split("/")[0])) {
      throw new Error(`${manifestPath}: ${JSON.stringify(path)} is outside the trees the 2.5 installer managed (${layout.trees.join(", ")})`);
    }
  }
  const files: string[] = [];
  for (const path of [...new Set(listed)].sort()) {
    const absolute = join(projectDir, path);
    if (!present(absolute)) continue;
    // A linked folder on the way would remove a file from outside the project.
    if (!within(realProject, realpathSync(dirname(absolute)))) {
      throw new Error(`${path} resolves outside ${projectDir}; move it out of the way, then rerun`);
    }
    if (lstatSync(absolute).isDirectory()) {
      throw new Error(`${path} is listed as a file in ${manifestRel} but is a directory; move it out of the way, then rerun`);
    }
    files.push(path);
  }
  const kiroIdeHooks = listed.some((path) => /^\.kiro\/hooks\/[^/]+\.kiro\.hook$/.test(path));
  return {
    harness: layout.harnessDir === ".aidlc" ? "copilot" : kiroIdeHooks ? "kiro-ide" : "kiro",
    harnessDir: layout.harnessDir,
    trees: layout.trees,
    // The manifest goes last: if a removal fails, a rerun still finds the install
    // and finishes it (files already gone are skipped).
    remove: [...files, manifestRel],
    keep: [],
  };
}

// targetHarness is the harness this run sets up; it defaults to the 2.5 one.
// Throws when a manifest cannot be trusted; nothing is touched before migrate.
export function findAmadeusLegacyProject(projectDir: string, targetHarness?: string): AmadeusLegacyProject | null {
  const realProject = realpathSync(projectDir);
  const installs = LAYOUTS
    .map((layout) => findInstall(projectDir, realProject, layout))
    .filter((install): install is AmadeusLegacyInstall => install !== null);
  if (installs.length === 0) return null;
  const kept = keptFiles(targetHarness ?? installs[0].harness);
  for (const install of installs) {
    install.keep = install.remove.filter((path) => kept.has(path));
    install.remove = install.remove.filter((path) => !kept.has(path));
  }
  return { projectDir, installs, agentsBlock: hasAgentsBlock(agentsLines(projectDir)) };
}

export function describeAmadeusLegacyProject(project: AmadeusLegacyProject): string {
  // Plain wording: what goes (only what the 2.5 installer added) and what stays.
  const removed = project.installs.map((install) =>
    `    - ${install.remove.length} file(s) the 2.5 installer added in ${install.harnessDir}/`
  );
  const kept = project.installs.flatMap((install) => install.keep);
  return [
    "This project still has the Amadeus AI-DLC 2.5 setup. Setup will remove what the 2.5 installer added and keep everything else.",
    "  Removes:",
    ...removed,
    ...(project.agentsBlock ? [`    - the Amadeus AI-DLC section in ${AGENTS_FILE}`] : []),
    "  Keeps:",
    "    - your aidlc/ folder (workflow records)",
    ...kept.map((path) => `    - ${path}`),
    "    - every other file in the project",
  ].join("\n");
}

function pruneEmptyDirs(projectDir: string, trees: readonly string[], removedPaths: readonly string[]): void {
  const roots = new Set(trees.map((tree) => join(projectDir, tree)));
  const candidates = new Set<string>();
  for (const path of removedPaths) {
    let dir = dirname(join(projectDir, path));
    while (within(projectDir, dir) && dir !== projectDir) {
      candidates.add(dir);
      if (roots.has(dir)) break;
      dir = dirname(dir);
    }
  }
  // Deepest first, so a parent is checked after its children are gone.
  for (const dir of [...candidates].sort((a, b) => b.length - a.length)) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // Already gone or not removable: leave it.
    }
  }
}

export function migrateAmadeusLegacyProject(project: AmadeusLegacyProject): AmadeusLegacyReport {
  const { projectDir } = project;
  let removed = 0;
  try {
    for (const install of project.installs) {
      for (const path of install.remove) {
        unlinkSync(join(projectDir, path));
        removed++;
      }
    }
  } catch (error) {
    throw new Error(
      `could not remove the Amadeus AI-DLC 2.5 install (${error instanceof Error ? error.message : String(error)}); ` +
        "fix the cause and rerun aidlc config, which finishes the removal",
    );
  }

  let agents: AmadeusLegacyReport["agents"] = "untouched";
  const lines = agentsLines(projectDir);
  if (project.agentsBlock && lines && hasAgentsBlock(lines)) {
    const agentsPath = join(projectDir, AGENTS_FILE);
    let managed = false;
    const kept = lines.filter((line) => {
      const bare = line.replace(/\r$/, "");
      if (bare === AGENTS_BEGIN) return (managed = true), false;
      if (bare === AGENTS_END) return (managed = false), false;
      return !managed;
    });
    const content = kept.join("\n").replace(/\s+$/, "");
    if (content) {
      writeFileSync(agentsPath, `${content}\n`);
      agents = "stripped";
    } else {
      // Nothing but the block, as the 2.5 uninstall treated it.
      unlinkSync(agentsPath);
      agents = "removed";
    }
  }

  for (const install of project.installs) pruneEmptyDirs(projectDir, install.trees, install.remove);
  return {
    removed,
    kept: project.installs.flatMap((install) => install.keep),
    agents,
  };
}
