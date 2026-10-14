import * as vscode from 'vscode';

// --- Scopes ---

export type AidlcScope =
  | 'enterprise'
  | 'feature'
  | 'mvp'
  | 'poc'
  | 'bugfix'
  | 'refactor'
  | 'spike'
  | 'migration'
  | 'integration'
  | 'documentation'
  | 'express';

export type AidlcDepth = 'minimal' | 'standard' | 'comprehensive';

export type AidlcTestStrategy = 'minimal' | 'standard' | 'comprehensive';

// --- Phases & Stages ---

export type PhaseId = 0 | 1 | 2 | 3 | 4;

export interface Phase {
  id: PhaseId;
  name: string;
  label: string;
  stages: Stage[];
}

export type StageStatus = 'pending' | 'active' | 'awaiting-approval' | 'completed' | 'skipped' | 'revised';

export interface ApprovalInfo {
  timestamp: string;
  decision: ApprovalDecision;
  feedback?: string;
}

export interface Stage {
  id: string; // e.g. "1.1", "2.3"
  name: string;
  phase: PhaseId;
  leadAgent: AgentId;
  status: StageStatus;
  artifacts: string[];
  conditional?: boolean;
  skipReason?: string;
  approvalInfo?: ApprovalInfo;
  revisionCount?: number;
}

// --- Agents ---

export type AgentId =
  | 'product'
  | 'architect'
  | 'developer'
  | 'qa'
  | 'devops'
  | 'ux'
  | 'lead'
  | 'security'
  | 'data'
  | 'performance'
  | 'accessibility';

export interface Agent {
  id: AgentId;
  name: string;
  domain: string;
  perspective: string;
}

// --- Workspace ---

export type WorkspaceType = 'greenfield' | 'brownfield';

export interface WorkspaceInfo {
  type: WorkspaceType;
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  testRunner?: string;
  hasExistingAidlc: boolean;
}

// --- Intent & State ---

export interface Intent {
  label: string;
  createdAt: string; // ISO date
  space: string;
  directory: string; // relative path to intent record dir
  scope: AidlcScope;
  depth: AidlcDepth;
  testStrategy: AidlcTestStrategy;
}

export interface WorkflowState {
  intent: Intent;
  workspace: WorkspaceInfo;
  currentPhase: PhaseId;
  currentStageId: string;
  stagesCompleted: number;
  stagesTotal: number;
  stages: Stage[];
}

// --- Approval ---

export type ApprovalDecision = 'approve' | 'request-changes' | 'skip';

export interface ApprovalRecord {
  stageId: string;
  decision: ApprovalDecision;
  timestamp: string;
  feedback?: string;
}

// --- Audit ---

export type AuditEventType =
  | 'workflow-started'
  | 'stage-started'
  | 'stage-completed'
  | 'stage-skipped'
  | 'approval-gate'
  | 'scope-selected'
  | 'depth-selected'
  | 'extension-opted-in'
  | 'extension-opted-out'
  | 'workflow-completed'
  | 'workflow-resumed';

export interface AuditEntry {
  timestamp: string;
  eventType: AuditEventType;
  stageId?: string;
  details: Record<string, unknown>;
}

// --- Configuration ---

export interface ExtensionConfig {
  rulesSource: string;
  defaultScope: AidlcScope;
  defaultDepth: AidlcDepth;
  defaultTestStrategy: AidlcTestStrategy;
  autoDetectSetup: boolean;
  showProgressNotifications: boolean;
}

// --- Tree View Items ---

export interface ProgressTreeItem {
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  collapsibleState: vscode.TreeItemCollapsibleState;
  children?: ProgressTreeItem[];
  contextValue?: string;
}
