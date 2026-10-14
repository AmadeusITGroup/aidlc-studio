import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { aidlcBinaryCandidates } from './installCommands';

const execAsync = promisify(exec);

/**
 * Result of running an AIDLC CLI command.
 */
export interface AidlcCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Doctor check result parsed from /aidlc --doctor output.
 */
export interface DoctorResult {
  passed: boolean;
  checks: DoctorCheck[];
  failures: string[];
  warnings: string[];
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Wrapper around the /aidlc CLI commands.
 *
 * In Kiro IDE, /aidlc commands are invoked through the SKILL.md conductor
 * and bun-based tools under .kiro/tools/. This service provides programmatic
 * access to the deterministic utility commands that can be run outside the
 * chat context.
 */
export class AidlcCli {
  private toolsDir: string;

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly workspaceUri: vscode.Uri
  ) {
    this.toolsDir = path.join(workspaceUri.fsPath, '.kiro', 'tools');
  }

  /**
   * Run the AI-DLC doctor health check, using the command that matches how the
   * framework was installed — per each variant's official README:
   *
   *  - AWS native install  -> `aidlc doctor` (native binary; a native install
   *    runs everything through `aidlc` and does not call bun).
   *  - Amadeus / custom clone-copy -> `bun .kiro/tools/aidlc-utility.ts doctor`
   *    (there is no `aidlc` binary; the Bun tool is the entry point).
   *
   * When `mode` is omitted (e.g. the standalone Doctor command, which doesn't
   * know the variant) we auto-detect: if the workspace has the Bun tool
   * (.kiro/tools/aidlc-utility.ts) we use it; otherwise we use `aidlc doctor`.
   */
  async doctor(mode: 'native' | 'bun-tool' | 'auto' = 'auto'): Promise<DoctorResult> {
    const useNative = mode === 'native'
      || (mode === 'auto' && !(await this.hasBunTool()));

    const result = useNative
      ? await this.runNativeAidlc(['doctor'])
      : await this.runTool('aidlc-utility.ts', ['doctor']);

    const checks: DoctorCheck[] = [];
    const failures: string[] = [];
    const warnings: string[] = [];

    // Parse doctor output lines
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('\u2713') || trimmed.startsWith('✓')) {
        // Passed check
        const message = trimmed.replace(/^[✓\u2713]\s*/, '');
        checks.push({ name: message, passed: true, message });
      } else if (trimmed.startsWith('\u2717') || trimmed.startsWith('✗') || trimmed.startsWith('ERROR')) {
        // Failed check
        const message = trimmed.replace(/^[✗\u2717]\s*/, '').replace(/^ERROR\s*/, '');
        checks.push({ name: message, passed: false, message });
        failures.push(message);
      } else if (trimmed.startsWith('⚠') || trimmed.startsWith('WARNING')) {
        const message = trimmed.replace(/^[⚠]\s*/, '').replace(/^WARNING\s*/, '');
        warnings.push(message);
      }
    }

    return {
      passed: result.exitCode === 0,
      checks,
      failures,
      warnings,
    };
  }

  /**
   * Run /aidlc --doctor --export to create a diagnostic report.
   */
  async doctorExport(outputDir?: string): Promise<AidlcCliResult> {
    const args = ['doctor', '--export'];
    if (outputDir) {
      args.push('--output', outputDir);
    }
    return this.runTool('aidlc-utility.ts', args);
  }

  /**
   * Run /aidlc --status to get workflow status.
   */
  async status(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['status']);
  }

  /**
   * Run /aidlc --version to get framework version.
   */
  async version(): Promise<string> {
    const result = await this.runTool('aidlc-utility.ts', ['version']);
    return result.stdout.trim();
  }

  /**
   * Run workspace detection (aidlc-utility detect).
   */
  async detect(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['detect', '--json']);
  }

  /**
   * Run intent-create to initialize a new workflow.
   */
  async intentCreate(description: string, scope?: string): Promise<AidlcCliResult> {
    const args = ['intent-create'];
    if (scope) {
      args.push('--scope', scope);
    }
    args.push('--', description);
    return this.runTool('aidlc-utility.ts', args);
  }

  /**
   * List intents in the active space.
   */
  async intentList(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['intent-list', '--json']);
  }

  /**
   * Switch to a specific intent.
   */
  async intentSwitch(name: string): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['intent-switch', name]);
  }

  /**
   * List spaces.
   */
  async spaceList(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['space-list', '--json']);
  }

  /**
   * Create a new space.
   */
  async spaceCreate(name: string): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['space-create', name]);
  }

  /**
   * Run the graph compiler.
   */
  async graphCompile(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-graph.ts', ['compile']);
  }

  /**
   * Validate a stage's frontmatter schema.
   */
  async graphValidate(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-graph.ts', ['validate']);
  }

  /**
   * Get runtime summary.
   */
  async runtimeSummary(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-runtime.ts', ['summary', '--json']);
  }

  /**
   * List sensors.
   */
  async sensorList(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-sensor.ts', ['list']);
  }

  /**
   * List knowledge documents.
   */
  async knowledgeList(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['knowledge-list', '--json']);
  }

  /**
   * Index knowledge documents.
   */
  async knowledgeOnboard(filePath?: string): Promise<AidlcCliResult> {
    const args = ['knowledge-onboard'];
    if (filePath) {
      args.push(filePath);
    }
    return this.runTool('aidlc-utility.ts', args);
  }

  /**
   * Select plugins.
   */
  async pluginSelect(names?: string[]): Promise<AidlcCliResult> {
    const args = ['select-plugins'];
    if (names && names.length > 0) {
      args.push(names.join(','));
    }
    return this.runTool('aidlc-utility.ts', args);
  }

  /**
   * List plugins.
   */
  async pluginList(): Promise<AidlcCliResult> {
    return this.runTool('aidlc-utility.ts', ['plugin-list']);
  }

  // --- Private ---

  /**
   * True if this workspace has the Bun-based tool entry point, i.e. a
   * Kiro-harness (Amadeus/custom clone-copy, or AWS kiro-ide) layout. A native
   * AWS install does not ship .kiro/tools/aidlc-utility.ts.
   */
  private async hasBunTool(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(this.workspaceUri, '.kiro', 'tools', 'aidlc-utility.ts')
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the native `aidlc` binary to invoke. Prefers the known install
   * location by absolute path (quoted) when bare-PATH `aidlc` may be
   * unavailable in this process; defaults to bare `aidlc` otherwise. Mirrors
   * the install-time config fix.
   */
  private resolveNativeAidlcBinary(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    for (const bin of aidlcBinaryCandidates(process.platform, home)) {
      if (fs.existsSync(bin)) {
        return `"${bin}"`;
      }
    }
    return 'aidlc';
  }

  /**
   * Run the native `aidlc` binary (AWS native install). Mirrors runTool()'s
   * result shape and output logging.
   */
  private async runNativeAidlc(args: string[]): Promise<AidlcCliResult> {
    const bin = this.resolveNativeAidlcBinary();
    const cmd = `${bin} ${args.map((a) => `"${a}"`).join(' ')}`;
    this.outputChannel.appendLine(`> ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.workspaceUri.fsPath,
        timeout: 60000,
        env: { ...process.env },
      });
      if (stdout) {
        this.outputChannel.appendLine(stdout);
      }
      if (stderr) {
        this.outputChannel.appendLine(stderr);
      }
      return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      const stdout = execError.stdout ?? '';
      const stderr = execError.stderr ?? '';
      const exitCode = execError.code ?? 1;
      this.outputChannel.appendLine(`Command failed (exit ${exitCode}): ${stderr}`);
      return { success: false, stdout, stderr, exitCode };
    }
  }

  private async runTool(tool: string, args: string[]): Promise<AidlcCliResult> {
    const toolPath = path.join(this.toolsDir, tool);
    const cmd = `bun "${toolPath}" ${args.map((a) => `"${a}"`).join(' ')}`;

    this.outputChannel.appendLine(`> ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.workspaceUri.fsPath,
        timeout: 60000,
        env: { ...process.env },
      });

      if (stdout) {
        this.outputChannel.appendLine(stdout);
      }
      if (stderr) {
        this.outputChannel.appendLine(stderr);
      }

      return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      const stdout = execError.stdout ?? '';
      const stderr = execError.stderr ?? '';
      const exitCode = execError.code ?? 1;

      this.outputChannel.appendLine(`Command failed (exit ${exitCode}): ${stderr}`);

      return { success: false, stdout, stderr, exitCode };
    }
  }
}
