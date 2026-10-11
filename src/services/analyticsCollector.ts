import * as vscode from 'vscode';
import { StateParser } from './stateParser';
import { WorkflowState } from '../types';

export interface IntentAnalytics {
  slug: string;
  dirName: string;
  scope: string;
  status: string;
  projectName: string;
  stagesTotal: number;
  stagesCompleted: number;
  stagesSkipped: number;
  stagesActive: number;
  stagesAwaiting: number;
  stagesRevised: number;
  stagesPending: number;
  progressPercent: number;
  phases: PhaseAnalytics[];
  startDate: string | null;
  lastUpdated: string | null;
  totalArtifacts: number;
  currentStage: string | null;
  currentPhase: string | null;
  // Time analytics
  totalElapsedMinutes: number | null;      // Start to last update (wall clock)
  generationMinutes: number | null;        // Sum of STAGE_STARTED→STAGE_COMPLETED per stage
  waitMinutes: number | null;              // totalElapsed - generation (human idle/review)
  stageTimings: StageTimingEntry[];        // Per-stage timing breakdown
}

export interface StageTimingEntry {
  slug: string;
  name: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
}

export interface PhaseAnalytics {
  id: number;
  name: string;
  total: number;
  completed: number;
  skipped: number;
  active: number;
  awaiting: number;
  revised: number;
  pending: number;
  done: boolean;
}

export interface GlobalAnalytics {
  totalIntents: number;
  activeIntents: number;
  completedIntents: number;
  intents: IntentAnalytics[];
  scopeDistribution: Record<string, number>;
  totalStagesAcrossAll: number;
  totalCompletedAcrossAll: number;
  totalArtifactsAcrossAll: number;
}

export class AnalyticsCollector {
  private parser: StateParser;

  constructor() {
    this.parser = new StateParser();
  }

  async collectGlobal(workspaceUri: vscode.Uri): Promise<GlobalAnalytics> {
    const intentsJsonUri = vscode.Uri.joinPath(
      workspaceUri, 'aidlc', 'spaces', 'default', 'intents', 'intents.json'
    );

    let intentEntries: Array<{ slug: string; dirName: string; scope: string; status: string }> = [];
    try {
      const content = await vscode.workspace.fs.readFile(intentsJsonUri);
      intentEntries = JSON.parse(Buffer.from(content).toString('utf-8'));
    } catch {
      return {
        totalIntents: 0, activeIntents: 0, completedIntents: 0,
        intents: [], scopeDistribution: {},
        totalStagesAcrossAll: 0, totalCompletedAcrossAll: 0, totalArtifactsAcrossAll: 0,
      };
    }

    const intents: IntentAnalytics[] = [];
    const scopeDistribution: Record<string, number> = {};
    let totalStages = 0;
    let totalCompleted = 0;
    let totalArtifacts = 0;

    for (const entry of intentEntries) {
      const stateUri = vscode.Uri.joinPath(
        workspaceUri, 'aidlc', 'spaces', 'default', 'intents', entry.dirName, 'aidlc-state.md'
      );

      const analytics = await this.collectIntent(workspaceUri, entry, stateUri);
      intents.push(analytics);

      scopeDistribution[entry.scope] = (scopeDistribution[entry.scope] ?? 0) + 1;
      totalStages += analytics.stagesTotal;
      totalCompleted += analytics.stagesCompleted;
      totalArtifacts += analytics.totalArtifacts;
    }

    const activeIntents = intents.filter((i) => i.status === 'in-flight').length;
    const completedIntents = intents.filter((i) => i.status === 'completed').length;

    return {
      totalIntents: intents.length,
      activeIntents,
      completedIntents,
      intents,
      scopeDistribution,
      totalStagesAcrossAll: totalStages,
      totalCompletedAcrossAll: totalCompleted,
      totalArtifactsAcrossAll: totalArtifacts,
    };
  }

  async collectIntent(
    workspaceUri: vscode.Uri,
    entry: { slug: string; dirName: string; scope: string; status: string },
    stateUri: vscode.Uri
  ): Promise<IntentAnalytics> {
    let state: WorkflowState | null = null;
    try {
      state = await this.parser.parseStateFile(stateUri);
    } catch {
      // State file not parseable
    }

    const phaseNames = ['Initialization', 'Ideation', 'Inception', 'Construction', 'Operation'];
    const phases: PhaseAnalytics[] = [];

    const stages = state?.stages ?? [];

    for (let i = 0; i <= 4; i++) {
      const phaseStages = stages.filter((s) => s.phase === i);
      if (phaseStages.length === 0) { continue; }

      const completed = phaseStages.filter((s) => s.status === 'completed').length;
      const skipped = phaseStages.filter((s) => s.status === 'skipped').length;
      const active = phaseStages.filter((s) => s.status === 'active').length;
      const awaiting = phaseStages.filter((s) => s.status === 'awaiting-approval').length;
      const revised = phaseStages.filter((s) => s.status === 'revised').length;
      const pending = phaseStages.filter((s) => s.status === 'pending').length;

      phases.push({
        id: i,
        name: phaseNames[i],
        total: phaseStages.length,
        completed, skipped, active, awaiting, revised, pending,
        done: (completed + skipped) === phaseStages.length,
      });
    }

    const stagesCompleted = stages.filter((s) => s.status === 'completed').length;
    const stagesSkipped = stages.filter((s) => s.status === 'skipped').length;

    // Count artifacts on disk
    const intentDir = vscode.Uri.joinPath(
      workspaceUri, 'aidlc', 'spaces', 'default', 'intents', entry.dirName
    );
    const totalArtifacts = await this.countArtifactsOnDisk(intentDir);

    // Parse dates from state
    const startDate = state?.intent.createdAt ?? null;
    const currentStage = state ? stages.find((s) => s.id === state.currentStageId) : null;
    const currentPhase = state ? phaseNames[state.currentPhase] ?? null : null;

    // Parse last updated from state file
    let lastUpdated: string | null = null;
    try {
      const content = await vscode.workspace.fs.readFile(stateUri);
      const text = Buffer.from(content).toString('utf-8');
      const match = text.match(/\*\*Last Updated\*\*:\s*(.+)/);
      if (match) { lastUpdated = match[1].trim(); }
    } catch { /* ignore */ }

    // Parse audit trail for timing data
    const timing = await this.parseAuditTiming(intentDir);

    return {
      slug: entry.slug,
      dirName: entry.dirName,
      scope: entry.scope,
      status: entry.status,
      projectName: state?.intent.label ?? entry.slug,
      stagesTotal: stages.length,
      stagesCompleted,
      stagesSkipped,
      stagesActive: stages.filter((s) => s.status === 'active').length,
      stagesAwaiting: stages.filter((s) => s.status === 'awaiting-approval').length,
      stagesRevised: stages.filter((s) => s.status === 'revised').length,
      stagesPending: stages.filter((s) => s.status === 'pending').length,
      progressPercent: stages.length > 0 ? Math.round(((stagesCompleted + stagesSkipped) / stages.length) * 100) : 0,
      phases,
      startDate,
      lastUpdated,
      totalArtifacts,
      currentStage: currentStage?.name ?? null,
      currentPhase,
      totalElapsedMinutes: timing.totalElapsedMinutes,
      generationMinutes: timing.generationMinutes,
      waitMinutes: timing.waitMinutes,
      stageTimings: timing.stageTimings,
    };
  }

  /**
   * Parse audit trail markdown files to extract STAGE_STARTED/STAGE_COMPLETED
   * timestamps for per-stage and overall timing.
   */
  private async parseAuditTiming(intentDir: vscode.Uri): Promise<{
    totalElapsedMinutes: number | null;
    generationMinutes: number | null;
    waitMinutes: number | null;
    stageTimings: StageTimingEntry[];
  }> {
    const auditDir = vscode.Uri.joinPath(intentDir, 'audit');
    let auditText = '';

    try {
      const files = await vscode.workspace.fs.readDirectory(auditDir);
      // Concatenate all audit shard files
      for (const [name, type] of files) {
        if (type === vscode.FileType.File && name.endsWith('.md')) {
          const content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(auditDir, name));
          auditText += Buffer.from(content).toString('utf-8') + '\n';
        }
      }
    } catch {
      return { totalElapsedMinutes: null, generationMinutes: null, waitMinutes: null, stageTimings: [] };
    }

    if (!auditText) {
      return { totalElapsedMinutes: null, generationMinutes: null, waitMinutes: null, stageTimings: [] };
    }

    // Parse all STAGE_STARTED and STAGE_COMPLETED events with timestamps
    const stageStarts: Record<string, string> = {};
    const stageCompletions: Record<string, string> = {};

    const blocks = auditText.split(/\n---\n/);
    for (const block of blocks) {
      const tsMatch = block.match(/\*\*Timestamp\*\*:\s*(.+)/);
      const eventMatch = block.match(/\*\*Event\*\*:\s*(\S+)/);
      const stageMatch = block.match(/\*\*Stage\*\*:\s*(\S+)/);

      if (!tsMatch || !eventMatch || !stageMatch) { continue; }

      const ts = tsMatch[1].trim();
      const event = eventMatch[1].trim();
      const slug = stageMatch[1].trim();

      if (event === 'STAGE_STARTED') {
        stageStarts[slug] = ts;
      } else if (event === 'STAGE_COMPLETED') {
        stageCompletions[slug] = ts;
      }
    }

    // Build per-stage timings
    const stageTimings: StageTimingEntry[] = [];
    let totalGenerationMs = 0;

    for (const [slug, startTs] of Object.entries(stageStarts)) {
      const endTs = stageCompletions[slug] ?? null;
      let durationMinutes: number | null = null;

      if (endTs) {
        const startMs = new Date(startTs).getTime();
        const endMs = new Date(endTs).getTime();
        if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
          const diffMs = endMs - startMs;
          durationMinutes = Math.round(diffMs / 60000 * 10) / 10; // 1 decimal
          totalGenerationMs += diffMs;
        }
      }

      // Convert slug to display name
      const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      stageTimings.push({
        slug,
        name,
        startedAt: startTs,
        completedAt: endTs,
        durationMinutes,
      });
    }

    // Total elapsed: first STAGE_STARTED to last STAGE_COMPLETED (or last timestamp)
    const allTimestamps = [...Object.values(stageStarts), ...Object.values(stageCompletions)]
      .map((ts) => new Date(ts).getTime())
      .filter((t) => !isNaN(t));

    let totalElapsedMinutes: number | null = null;
    if (allTimestamps.length >= 2) {
      const first = Math.min(...allTimestamps);
      const last = Math.max(...allTimestamps);
      totalElapsedMinutes = Math.round((last - first) / 60000 * 10) / 10;
    }

    const generationMinutes = totalGenerationMs > 0 ? Math.round(totalGenerationMs / 60000 * 10) / 10 : null;
    const waitMinutes = (totalElapsedMinutes !== null && generationMinutes !== null)
      ? Math.round((totalElapsedMinutes - generationMinutes) * 10) / 10
      : null;

    return { totalElapsedMinutes, generationMinutes, waitMinutes, stageTimings };
  }

  private async countArtifactsOnDisk(intentDir: vscode.Uri): Promise<number> {
    let count = 0;
    const phaseDirs = ['initialization', 'ideation', 'inception', 'construction', 'operation'];

    for (const phase of phaseDirs) {
      const phaseUri = vscode.Uri.joinPath(intentDir, phase);
      try {
        const stageDirs = await vscode.workspace.fs.readDirectory(phaseUri);
        for (const [stageName, stageType] of stageDirs) {
          if (stageType === vscode.FileType.Directory) {
            try {
              const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(phaseUri, stageName));
              count += files.filter(([name, type]) => type === vscode.FileType.File && !name.startsWith('.')).length;
            } catch { /* empty stage dir */ }
          }
        }
      } catch { /* phase dir doesn't exist */ }
    }

    return count;
  }
}
