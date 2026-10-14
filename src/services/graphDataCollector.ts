import * as vscode from 'vscode';

export interface GraphNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  agent: string;
  status: string;
  durationMinutes: number | null;
  startedAt: string | null;
  completedAt: string | null;
  sensorsPassed: number;
  sensorsFailed: number;
  outcome: string;
}

export interface GraphEdge {
  from: string; // slug
  to: string;   // slug
  type: 'requires'; // could add 'consumes' later
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  phases: string[];
}

/**
 * Collects stage dependency graph data by merging:
 * - stage-graph.json (dependencies, agents, phases)
 * - runtime-graph.json (status, duration, sensors)
 * - aidlc-state.md (current status of each stage)
 */
export class GraphDataCollector {

  async collect(workspaceUri: vscode.Uri): Promise<GraphData | null> {
    // Read stage-graph.json for structure/dependencies
    const stageGraphUri = vscode.Uri.joinPath(workspaceUri, '.kiro', 'tools', 'data', 'stage-graph.json');
    let stageGraph: StageGraphEntry[] = [];
    try {
      const content = await vscode.workspace.fs.readFile(stageGraphUri);
      stageGraph = JSON.parse(Buffer.from(content).toString('utf-8'));
    } catch {
      return null; // No stage graph = can't build the visualization
    }

    // Read runtime-graph.json for runtime data (optional — may not exist yet)
    const runtimeData = await this.readRuntimeGraph(workspaceUri);

    // Read state for current stage statuses
    const stateStatuses = await this.readStateStatuses(workspaceUri);

    // Build nodes
    const phases = new Set<string>();
    const nodes: GraphNode[] = stageGraph.map((entry) => {
      phases.add(entry.phase);
      const runtime = runtimeData.get(entry.slug);
      const stateStatus = stateStatuses.get(entry.slug);

      let durationMinutes: number | null = null;
      if (runtime?.started_at && runtime?.completed_at) {
        const ms = new Date(runtime.completed_at).getTime() - new Date(runtime.started_at).getTime();
        if (ms > 0) { durationMinutes = Math.round(ms / 60000 * 10) / 10; }
      }

      const sensorsPassed = runtime?.sensor_firings?.filter((s: { result: string }) => s.result === 'passed').length ?? 0;
      const sensorsFailed = runtime?.sensor_firings?.filter((s: { result: string }) => s.result === 'failed').length ?? 0;

      // Determine status: prefer state file, fall back to runtime outcome
      let status = stateStatus ?? 'pending';
      if (status === 'pending' && runtime?.outcome === 'approved') {
        status = 'completed';
      }

      return {
        slug: entry.slug,
        number: entry.number,
        name: entry.name,
        phase: entry.phase,
        agent: runtime?.agent ?? entry.lead_agent,
        status,
        durationMinutes,
        startedAt: runtime?.started_at ?? null,
        completedAt: runtime?.completed_at ?? null,
        sensorsPassed,
        sensorsFailed,
        outcome: runtime?.outcome ?? 'pending',
      };
    });

    // Build edges from requires_stage
    const edges: GraphEdge[] = [];
    for (const entry of stageGraph) {
      for (const dep of entry.requires_stage ?? []) {
        edges.push({ from: dep, to: entry.slug, type: 'requires' });
      }
    }

    return {
      nodes,
      edges,
      phases: [...phases],
    };
  }

  private async readRuntimeGraph(workspaceUri: vscode.Uri): Promise<Map<string, RuntimeEntry>> {
    const map = new Map<string, RuntimeEntry>();

    try {
      // Try active-intent pointer first
      let runtimeUri: vscode.Uri | null = null;

      const activeIntentFile = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents', 'active-intent');
      try {
        const activeContent = await vscode.workspace.fs.readFile(activeIntentFile);
        const activeDir = Buffer.from(activeContent).toString('utf-8').trim();
        if (activeDir) {
          runtimeUri = vscode.Uri.joinPath(
            workspaceUri, 'aidlc', 'spaces', 'default', 'intents', activeDir, 'runtime-graph.json'
          );
          // Verify it exists
          await vscode.workspace.fs.stat(runtimeUri);
        }
      } catch {
        runtimeUri = null;
      }

      // Fallback: scan intents directory for most recent runtime-graph.json
      if (!runtimeUri) {
        const intentsDir = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents');
        try {
          const entries = await vscode.workspace.fs.readDirectory(intentsDir);
          const dirs = entries
            .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.'))
            .map(([name]) => name)
            .sort()
            .reverse();

          for (const dir of dirs) {
            const candidate = vscode.Uri.joinPath(intentsDir, dir, 'runtime-graph.json');
            try {
              await vscode.workspace.fs.stat(candidate);
              runtimeUri = candidate;
              break;
            } catch { /* try next */ }
          }
        } catch { /* intents dir doesn't exist */ }
      }

      if (!runtimeUri) { return map; }

      const content = await vscode.workspace.fs.readFile(runtimeUri);
      const data = JSON.parse(Buffer.from(content).toString('utf-8'));

      if (data.stages && Array.isArray(data.stages)) {
        for (const stage of data.stages) {
          map.set(stage.stage_slug, stage);
        }
      }
    } catch {
      // No runtime graph
    }

    return map;
  }

  private async readStateStatuses(workspaceUri: vscode.Uri): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      // Try active-intent pointer first
      let stateUri: vscode.Uri | null = null;

      const activeIntentFile = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents', 'active-intent');
      try {
        const activeContent = await vscode.workspace.fs.readFile(activeIntentFile);
        const activeDir = Buffer.from(activeContent).toString('utf-8').trim();
        if (activeDir) {
          stateUri = vscode.Uri.joinPath(
            workspaceUri, 'aidlc', 'spaces', 'default', 'intents', activeDir, 'aidlc-state.md'
          );
          await vscode.workspace.fs.stat(stateUri);
        }
      } catch {
        stateUri = null;
      }

      // Fallback: scan for most recent state file
      if (!stateUri) {
        const intentsDir = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents');
        try {
          const entries = await vscode.workspace.fs.readDirectory(intentsDir);
          const dirs = entries
            .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.'))
            .map(([name]) => name)
            .sort()
            .reverse();

          for (const dir of dirs) {
            const candidate = vscode.Uri.joinPath(intentsDir, dir, 'aidlc-state.md');
            try {
              await vscode.workspace.fs.stat(candidate);
              stateUri = candidate;
              break;
            } catch { /* try next */ }
          }
        } catch { /* no intents */ }
      }

      if (!stateUri) { return map; }

      const content = await vscode.workspace.fs.readFile(stateUri);
      const text = Buffer.from(content).toString('utf-8');

      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^-\s*\[([x\-?RS ])\]\s*([a-z0-9-]+)/i);
        if (match) {
          const [, mark, slug] = match;
          let status: string;
          switch (mark) {
            case 'x': status = 'completed'; break;
            case '-': status = 'active'; break;
            case '?': status = 'awaiting-approval'; break;
            case 'R': status = 'revised'; break;
            case 'S': status = 'skipped'; break;
            default: status = 'pending'; break;
          }
          map.set(slug, status);
        }
      }
    } catch {
      // No state file
    }

    return map;
  }
}

interface StageGraphEntry {
  slug: string;
  number: string;
  name: string;
  phase: string;
  lead_agent: string;
  requires_stage?: string[];
}

interface RuntimeEntry {
  stage_slug: string;
  started_at?: string;
  completed_at?: string;
  agent?: string;
  outcome?: string;
  sensor_firings?: Array<{ id: string; result: string; ts: string }>;
}
