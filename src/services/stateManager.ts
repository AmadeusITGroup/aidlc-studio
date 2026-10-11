import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorkflowState, Intent } from '../types';
import { StateParser } from './stateParser';

const execAsync = promisify(exec);

export interface ValidationResult {
  valid: boolean;
  missingArtifacts: string[];
}

/**
 * StateManager is STATELESS — every call reads fresh from the framework's
 * files on disk. No caching, no local state, no writes. The framework
 * files are always the single source of truth.
 */
export class StateManager {
  private parser: StateParser;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.parser = new StateParser();
  }

  /**
   * Always reads fresh from disk. No cache.
   */
  async getCurrentState(): Promise<WorkflowState | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    const stateUri = await this.parser.findActiveState(workspaceFolder.uri);
    if (!stateUri) {
      return null;
    }

    return this.parser.parseStateFile(stateUri);
  }

  /**
   * List intents from the real intents.json file. Always fresh.
   */
  async listIntents(): Promise<Intent[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    return this.parser.parseIntentsJson(workspaceFolder.uri);
  }

  /**
   * Switch to a different intent using the framework's own CLI tool.
   * Runs: bun .kiro/tools/aidlc-utility.ts intent <slug>
   */
  async switchToIntent(intent: Intent): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }

    const slug = intent.label;
    const toolPath = vscode.Uri.joinPath(workspaceFolder.uri, '.kiro', 'tools', 'aidlc-utility.ts').fsPath;

    try {
      await execAsync(`bun "${toolPath}" intent ${slug}`, {
        cwd: workspaceFolder.uri.fsPath,
        timeout: 15000,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Framework intent switch failed: ${msg}`);
    }

    // No local state to update — next getCurrentState() reads fresh from disk
  }

  async validateCompletedArtifacts(_state: WorkflowState): Promise<ValidationResult> {
    return { valid: true, missingArtifacts: [] };
  }

  // These are kept for interface compatibility but are no-ops now
  setCurrentState(_state: WorkflowState): void { /* no-op — always reads from disk */ }
  invalidateCache(): void { /* no-op — there is no cache */ }
}
