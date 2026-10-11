import * as vscode from 'vscode';
import { WorkflowState, Intent, Stage, PhaseId, StageStatus, WorkspaceInfo, AidlcScope, AidlcDepth, AidlcTestStrategy, AgentId } from '../types';
import { STAGE_DEFINITIONS } from './stageDefinitions';

/**
 * Parses the REAL aidlc-state.md format written by the Amadeus AIDLC framework.
 *
 * The framework writes state in this format:
 *
 * ## Project Information
 * - **Project**: description
 * - **Scope**: feature
 * ...
 *
 * ## Stage Progress
 * ### IDEATION PHASE
 * - [x] intent-capture — EXECUTE
 * - [-] feasibility — EXECUTE
 * - [ ] scope-definition — EXECUTE
 * - [?] stage-name — EXECUTE  (awaiting approval)
 * - [R] stage-name — EXECUTE  (revising after rejection)
 * - [S] stage-name — SKIP     (skipped via jump)
 *
 * ## Current Status
 * - **Current Stage**: feasibility
 * - **Status**: Running
 */
export class StateParser {

  async parseStateFile(stateUri: vscode.Uri): Promise<WorkflowState | null> {
    try {
      const content = await vscode.workspace.fs.readFile(stateUri);
      const text = Buffer.from(content).toString('utf-8');
      return this.parseMarkdown(text, stateUri);
    } catch {
      return null;
    }
  }

  parseMarkdown(text: string, sourceUri: vscode.Uri): WorkflowState | null {
    try {
      const projectInfo = this.parseProjectInfo(text);
      const scopeConfig = this.parseScopeConfig(text);
      const currentStatus = this.parseCurrentStatus(text);
      const stages = this.parseStageProgress(text);
      const phaseProgress = this.parsePhaseProgress(text);

      if (!projectInfo) {
        return null;
      }

      const intentDir = this.deriveIntentDir(sourceUri);

      const intent: Intent = {
        label: projectInfo.project,
        createdAt: projectInfo.startDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        space: 'default',
        directory: intentDir,
        scope: (projectInfo.scope ?? 'feature') as AidlcScope,
        depth: (scopeConfig?.depth ?? 'standard') as AidlcDepth,
        testStrategy: (scopeConfig?.testStrategy ?? 'standard') as AidlcTestStrategy,
      };

      const workspace: WorkspaceInfo = {
        type: projectInfo.projectType === 'Greenfield' ? 'greenfield' : 'brownfield',
        languages: projectInfo.languages ? [projectInfo.languages] : [],
        frameworks: projectInfo.frameworks ? [projectInfo.frameworks] : [],
        hasExistingAidlc: true,
      };

      // Compute progress from stages
      const completedCount = stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;

      // Determine current phase from phaseProgress or currentStatus
      const currentPhase = this.resolveCurrentPhase(phaseProgress, currentStatus?.phase);
      const currentStageId = this.resolveCurrentStageId(stages, currentStatus?.currentStage);

      return {
        intent,
        workspace,
        currentPhase,
        currentStageId,
        stagesCompleted: completedCount,
        stagesTotal: stages.length,
        stages,
      };
    } catch {
      return null;
    }
  }

  // --- Section Parsers ---

  private parseProjectInfo(text: string): {
    project: string;
    projectType?: string;
    scope?: string;
    startDate?: string;
    activeAgent?: string;
    languages?: string;
    frameworks?: string;
  } | null {
    const section = this.extractSection(text, 'Project Information');
    if (!section) { return null; }

    return {
      project: this.extractBoldField(section, 'Project') ?? 'Unknown Intent',
      projectType: this.extractBoldField(section, 'Project Type') ?? undefined,
      scope: this.extractBoldField(section, 'Scope') ?? undefined,
      startDate: this.extractBoldField(section, 'Start Date') ?? undefined,
      activeAgent: this.extractBoldField(section, 'Active Agent') ?? undefined,
      languages: this.extractBoldField(section, 'Languages') ?? undefined,
      frameworks: this.extractBoldField(section, 'Frameworks') ?? undefined,
    };
  }

  private parseScopeConfig(text: string): {
    depth?: string;
    testStrategy?: string;
    stagesToExecute?: string[];
    stagesToSkip?: string[];
  } | null {
    const section = this.extractSection(text, 'Scope Configuration');
    if (!section) { return null; }

    return {
      depth: this.extractBoldField(section, 'Depth') ?? undefined,
      testStrategy: this.extractBoldField(section, 'Test Strategy') ?? undefined,
    };
  }

  private parseCurrentStatus(text: string): {
    phase?: string;
    currentStage?: string;
    nextStage?: string;
    status?: string;
  } | null {
    const section = this.extractSection(text, 'Current Status');
    if (!section) { return null; }

    return {
      phase: this.extractBoldField(section, 'Lifecycle Phase') ?? undefined,
      currentStage: this.extractBoldField(section, 'Current Stage') ?? undefined,
      nextStage: this.extractBoldField(section, 'Next Stage') ?? undefined,
      status: this.extractBoldField(section, 'Status') ?? undefined,
    };
  }

  private parsePhaseProgress(text: string): Record<string, string> {
    const section = this.extractSection(text, 'Phase Progress');
    if (!section) { return {}; }

    const result: Record<string, string> = {};
    const lines = section.split('\n');

    for (const line of lines) {
      // Match: - **Ideation**: Active
      const match = line.match(/^\s*-\s*\*\*(\w+)\*\*:\s*(\w+)/);
      if (match) {
        result[match[1].toLowerCase()] = match[2];
      }
    }

    return result;
  }

  /**
   * Parse the ## Stage Progress section.
   * Format: - [x] slug-name — EXECUTE/SKIP
   * Checkbox states: [ ] not started, [-] in progress, [?] awaiting approval,
   *   [R] revising, [x] completed, [S] skipped
   */
  private parseStageProgress(text: string): Stage[] {
    const section = this.extractSection(text, 'Stage Progress');
    if (!section) {
      return [];
    }

    const stages: Stage[] = [];
    let currentPhaseId: PhaseId = 0;

    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect phase headers: ### IDEATION PHASE
      const phaseHeader = trimmed.match(/^###\s+(\w+)\s+PHASE/i);
      if (phaseHeader) {
        currentPhaseId = this.phaseNameToId(phaseHeader[1]);
        continue;
      }

      // Match stage lines: - [x] slug-name — EXECUTE
      // Also handles: - [ ] slug-name — SKIP
      const stageMatch = trimmed.match(/^-\s*\[([x\-?RS ])\]\s*([a-z0-9-]+)\s*—?\s*(EXECUTE|SKIP)?/i);
      if (stageMatch) {
        const [, mark, slug, action] = stageMatch;

        let status: StageStatus;
        switch (mark) {
          case 'x': status = 'completed'; break;
          case '-': status = 'active'; break;
          case '?': status = 'awaiting-approval'; break;
          case 'R': status = 'revised'; break;
          case 'S': status = 'skipped'; break;
          default: status = 'pending'; break;
        }

        // If action is SKIP and not already completed/active, mark as skipped
        if (action?.toUpperCase() === 'SKIP' && status === 'pending') {
          status = 'skipped';
        }

        // Find the matching STAGE_DEFINITION by slug
        const def = this.findDefinitionBySlug(slug);
        const stageId = def?.id ?? `${currentPhaseId}.?`;
        const stageName = def?.name ?? this.slugToName(slug);
        const leadAgent = (def?.leadAgent ?? 'lead') as AgentId;

        stages.push({
          id: stageId,
          name: stageName,
          phase: currentPhaseId,
          leadAgent,
          status,
          artifacts: [],
          skipReason: (status === 'skipped' && action?.toUpperCase() === 'SKIP') ? 'Scope excludes this stage' : undefined,
        });
      }
    }

    return stages;
  }

  // --- Helpers ---

  private extractSection(text: string, heading: string): string | null {
    const regex = new RegExp(`##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  private extractBoldField(section: string, key: string): string | null {
    // Match: - **Key**: Value
    const regex = new RegExp(`^\\s*-\\s*\\*\\*${key}\\*\\*:\\s*(.+)$`, 'im');
    const match = section.match(regex);
    if (match) {
      const value = match[1].trim();
      return value === '' || value === 'Unknown' ? null : value;
    }
    return null;
  }

  private phaseNameToId(name: string): PhaseId {
    const map: Record<string, PhaseId> = {
      'initialization': 0,
      'ideation': 1,
      'inception': 2,
      'construction': 3,
      'operation': 4,
    };
    return map[name.toLowerCase()] ?? 0;
  }

  private resolveCurrentPhase(phaseProgress: Record<string, string>, statusPhase?: string): PhaseId {
    // Prefer the Current Status section's phase
    if (statusPhase) {
      return this.phaseNameToId(statusPhase);
    }
    // Otherwise find the active phase from Phase Progress
    for (const [name, status] of Object.entries(phaseProgress)) {
      if (status === 'Active') {
        return this.phaseNameToId(name);
      }
    }
    return 1;
  }

  private resolveCurrentStageId(stages: Stage[], currentStageSlug?: string): string {
    if (currentStageSlug) {
      // Find matching stage by slug
      const match = stages.find((s) => {
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return slug === currentStageSlug || s.id === currentStageSlug;
      });
      if (match) { return match.id; }

      // Try finding by definition slug
      const def = this.findDefinitionBySlug(currentStageSlug);
      if (def) {
        const stageMatch = stages.find((s) => s.id === def.id);
        if (stageMatch) { return stageMatch.id; }
      }
    }

    // Fallback: first active or in-progress stage
    const active = stages.find((s) => s.status === 'active' || s.status === 'awaiting-approval');
    return active?.id ?? stages[0]?.id ?? '1.1';
  }

  private findDefinitionBySlug(slug: string): (typeof STAGE_DEFINITIONS)[number] | undefined {
    // Map known slugs to stage IDs
    const slugMap: Record<string, string> = {
      'workspace-scaffold': '0.1',
      'workspace-detection': '0.2',
      'state-init': '0.3',
      'intent-capture': '1.1',
      'market-research': '1.2',
      'feasibility': '1.3',
      'scope-definition': '1.4',
      'team-formation': '1.5',
      'rough-mockups': '1.6',
      'approval-handoff': '1.7',
      'reverse-engineering': '2.1',
      'practices-discovery': '2.2',
      'requirements-analysis': '2.3',
      'user-stories': '2.4',
      'refined-mockups': '2.5',
      'application-design': '2.5',
      'units-generation': '2.7',
      'delivery-planning': '2.9',
      'functional-design': '3.1',
      'nfr-requirements': '3.2',
      'nfr-design': '3.2',
      'technical-design': '3.2',
      'infrastructure-design': '3.3',
      'code-scaffolding': '3.4',
      'code-generation': '3.5',
      'build-and-test': '3.6',
      'ci-pipeline': '3.7',
      'deployment-pipeline': '4.1',
      'environment-provisioning': '4.2',
      'deployment-execution': '4.3',
      'observability-setup': '4.4',
      'incident-response': '4.5',
      'performance-validation': '4.6',
      'feedback-optimization': '4.7',
    };

    const id = slugMap[slug];
    if (id) {
      return STAGE_DEFINITIONS.find((d) => d.id === id);
    }

    // Fuzzy match by name
    return STAGE_DEFINITIONS.find((d) => {
      const defSlug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return defSlug === slug || defSlug.includes(slug) || slug.includes(defSlug);
    });
  }

  private slugToName(slug: string): string {
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private deriveIntentDir(stateUri: vscode.Uri): string {
    const relativePath = vscode.workspace.asRelativePath(stateUri);
    const parts = relativePath.replace(/\\/g, '/').split('/');
    parts.pop(); // Remove aidlc-state.md
    return parts.join('/');
  }

  /**
   * Find the active state file. Uses the active-intent file to know which intent is current.
   */
  async findActiveState(workspaceUri: vscode.Uri): Promise<vscode.Uri | null> {
    // First try reading the active-intent pointer
    const activeIntentFile = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents', 'active-intent');

    let activeIntentDir: string | null = null;
    try {
      const content = await vscode.workspace.fs.readFile(activeIntentFile);
      activeIntentDir = Buffer.from(content).toString('utf-8').trim();
    } catch {
      // No active-intent file — fall back to scanning
    }

    const intentsDir = vscode.Uri.joinPath(workspaceUri, 'aidlc', 'spaces', 'default', 'intents');

    if (activeIntentDir) {
      // Use the active intent directly
      const stateUri = vscode.Uri.joinPath(intentsDir, activeIntentDir, 'aidlc-state.md');
      try {
        await vscode.workspace.fs.stat(stateUri);
        return stateUri;
      } catch {
        // active-intent file points to nonexistent dir — fall through
      }
    }

    // Fallback: scan for most recent intent
    try {
      const entries = await vscode.workspace.fs.readDirectory(intentsDir);
      const intentDirs = entries
        .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.'))
        .map(([name]) => name)
        .sort()
        .reverse();

      for (const dir of intentDirs) {
        const stateUri = vscode.Uri.joinPath(intentsDir, dir, 'aidlc-state.md');
        try {
          await vscode.workspace.fs.stat(stateUri);
          return stateUri;
        } catch {
          // No state in this dir
        }
      }
    } catch {
      // intents dir doesn't exist
    }

    return null;
  }

  /**
   * Parse intents.json for the intents list.
   */
  async parseIntentsJson(workspaceUri: vscode.Uri): Promise<Intent[]> {
    const intentsJsonUri = vscode.Uri.joinPath(
      workspaceUri, 'aidlc', 'spaces', 'default', 'intents', 'intents.json'
    );

    try {
      const content = await vscode.workspace.fs.readFile(intentsJsonUri);
      const data = JSON.parse(Buffer.from(content).toString('utf-8'));

      if (!Array.isArray(data)) { return []; }

      return data.map((entry: { slug?: string; dirName?: string; scope?: string; status?: string }) => ({
        label: entry.slug ?? 'unknown',
        createdAt: entry.dirName?.slice(0, 6) ?? '',
        space: 'default',
        directory: `aidlc/spaces/default/intents/${entry.dirName ?? ''}`,
        scope: (entry.scope ?? 'feature') as AidlcScope,
        depth: 'standard' as AidlcDepth,
        testStrategy: 'standard' as AidlcTestStrategy,
      }));
    } catch {
      return [];
    }
  }
}
