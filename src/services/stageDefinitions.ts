import { PhaseId, AgentId } from '../types';

interface StageDefinition {
  id: string;
  name: string;
  phase: PhaseId;
  leadAgent: AgentId;
  conditional?: boolean;
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  // Phase 0: Initialization
  { id: '0.1', name: 'Workspace Scaffold', phase: 0, leadAgent: 'lead' },
  { id: '0.2', name: 'Workspace Detection', phase: 0, leadAgent: 'developer' },
  { id: '0.3', name: 'State Initialization', phase: 0, leadAgent: 'lead' },

  // Phase 1: Ideation
  { id: '1.1', name: 'Intent Capture', phase: 1, leadAgent: 'product' },
  { id: '1.2', name: 'Market Research', phase: 1, leadAgent: 'product' },
  { id: '1.3', name: 'Feasibility & Constraints', phase: 1, leadAgent: 'architect' },
  { id: '1.4', name: 'Scope Definition', phase: 1, leadAgent: 'product' },
  { id: '1.5', name: 'Team Formation', phase: 1, leadAgent: 'lead' },
  { id: '1.6', name: 'Rough Mockups', phase: 1, leadAgent: 'ux' },
  { id: '1.7', name: 'Approval & Handoff', phase: 1, leadAgent: 'lead' },

  // Phase 2: Inception
  { id: '2.1', name: 'Reverse Engineering', phase: 2, leadAgent: 'developer', conditional: true },
  { id: '2.2', name: 'Practices Discovery', phase: 2, leadAgent: 'architect' },
  { id: '2.3', name: 'Requirements Analysis', phase: 2, leadAgent: 'product' },
  { id: '2.4', name: 'User Stories', phase: 2, leadAgent: 'product' },
  { id: '2.5', name: 'Application Design', phase: 2, leadAgent: 'architect' },
  { id: '2.6', name: 'Risk Assessment', phase: 2, leadAgent: 'architect' },
  { id: '2.7', name: 'Unit of Work Definition', phase: 2, leadAgent: 'architect' },
  { id: '2.8', name: 'Estimation', phase: 2, leadAgent: 'lead' },
  { id: '2.9', name: 'Delivery Planning', phase: 2, leadAgent: 'lead' },

  // Phase 3: Construction
  { id: '3.1', name: 'Functional Design', phase: 3, leadAgent: 'developer' },
  { id: '3.2', name: 'Technical Design', phase: 3, leadAgent: 'developer' },
  { id: '3.3', name: 'Environment Setup', phase: 3, leadAgent: 'devops' },
  { id: '3.4', name: 'Code Scaffolding', phase: 3, leadAgent: 'developer' },
  { id: '3.5', name: 'Code Generation', phase: 3, leadAgent: 'developer' },
  { id: '3.6', name: 'Build and Test', phase: 3, leadAgent: 'qa' },
  { id: '3.7', name: 'CI Pipeline', phase: 3, leadAgent: 'devops' },

  // Phase 4: Operation
  { id: '4.1', name: 'Deployment Planning', phase: 4, leadAgent: 'devops' },
  { id: '4.2', name: 'Infrastructure Setup', phase: 4, leadAgent: 'devops' },
  { id: '4.3', name: 'Deployment Execution', phase: 4, leadAgent: 'devops' },
  { id: '4.4', name: 'Smoke Testing', phase: 4, leadAgent: 'qa' },
  { id: '4.5', name: 'Monitoring Setup', phase: 4, leadAgent: 'devops' },
  { id: '4.6', name: 'Incident Playbook', phase: 4, leadAgent: 'devops' },
  { id: '4.7', name: 'Feedback & Optimization', phase: 4, leadAgent: 'product' },
];
