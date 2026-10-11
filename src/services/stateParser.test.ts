import { describe, expect, it, vi } from 'vitest';
import { StateParser } from './stateParser';

vi.mock('vscode', () => ({
  workspace: {
    asRelativePath: () => 'aidlc/spaces/default/intents/example/aidlc-state.md',
  },
}));

describe('StateParser', () => {
  it('parses project details and stage progress', () => {
    const parser = new StateParser();
    const state = parser.parseMarkdown(`
## Project Information
- **Project**: Readiness test
- **Project Type**: Greenfield
- **Scope**: feature
- **Start Date**: 2026-09-29

## Phase Progress
- **Ideation**: Active

## Stage Progress
### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [?] feasibility — EXECUTE

## Current Status
- **Lifecycle Phase**: Ideation
- **Current Stage**: feasibility
- **Status**: Running
`, {} as import('vscode').Uri);

    expect(state).not.toBeNull();
    expect(state?.intent.label).toBe('Readiness test');
    expect(state?.workspace.type).toBe('greenfield');
    expect(state?.currentPhase).toBe(1);
    expect(state?.currentStageId).toBe('1.3');
    expect(state?.stagesCompleted).toBe(1);
    expect(state?.stagesTotal).toBe(2);
    expect(state?.stages[1].status).toBe('awaiting-approval');
  });

  it('returns null when project information is missing', () => {
    const parser = new StateParser();

    expect(parser.parseMarkdown('## Current Status\n- **Status**: Running', {} as import('vscode').Uri)).toBeNull();
  });

  it('counts skipped stages as completed progress and records a skip reason', () => {
    const parser = new StateParser();
    const state = parser.parseMarkdown(`
## Project Information
- **Project**: Skip test
- **Project Type**: Brownfield

## Stage Progress
### IDEATION PHASE
- [x] intent-capture — EXECUTE
- [S] market-research — SKIP
- [ ] feasibility — EXECUTE
`, {} as import('vscode').Uri);

    expect(state).not.toBeNull();
    expect(state?.workspace.type).toBe('brownfield');
    // completed + skipped both count toward progress
    expect(state?.stagesCompleted).toBe(2);
    expect(state?.stagesTotal).toBe(3);

    const skipped = state?.stages.find((s) => s.status === 'skipped');
    expect(skipped?.skipReason).toBe('Scope excludes this stage');
  });

  it('maps checkbox marks to stage statuses including revised', () => {
    const parser = new StateParser();
    const state = parser.parseMarkdown(`
## Project Information
- **Project**: Status marks

## Stage Progress
### INCEPTION PHASE
- [R] requirements-analysis — EXECUTE
- [-] user-stories — EXECUTE
`, {} as import('vscode').Uri);

    const statuses = state?.stages.map((s) => s.status);
    expect(statuses).toContain('revised');
    expect(statuses).toContain('active');
    // phase header "INCEPTION" maps to phase id 2
    expect(state?.stages[0].phase).toBe(2);
  });

  it('resolves the current phase from the Current Status section', () => {
    const parser = new StateParser();
    const state = parser.parseMarkdown(`
## Project Information
- **Project**: Phase resolve

## Phase Progress
- **Ideation**: Active

## Current Status
- **Lifecycle Phase**: Construction
`, {} as import('vscode').Uri);

    // Current Status wins over Phase Progress
    expect(state?.currentPhase).toBe(3);
  });

  it('maps a known slug to its canonical stage id and name', () => {
    const parser = new StateParser();
    const state = parser.parseMarkdown(`
## Project Information
- **Project**: Slug map

## Stage Progress
### CONSTRUCTION PHASE
- [ ] code-generation — EXECUTE
`, {} as import('vscode').Uri);

    expect(state?.stages[0].id).toBe('3.5');
    expect(state?.stages[0].name).toBe('Code Generation');
  });
});