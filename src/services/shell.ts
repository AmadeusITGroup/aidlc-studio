import { exec, spawn, ExecOptions } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export interface ShellResult {
  stdout: string;
  stderr: string;
}

/**
 * Cross-platform shell helper.
 *
 * On Windows, child_process.exec defaults to cmd.exe which does NOT understand
 * PowerShell cmdlets like New-Item / Copy-Item / Remove-Item. This helper runs
 * PowerShell commands through powershell.exe explicitly, and plain commands
 * (git, bun, curl) directly.
 */
export class Shell {
  static get isWindows(): boolean {
    return process.platform === 'win32';
  }

  /**
   * Run a plain command (git, bun, curl, npm) that works in any shell.
   */
  static async run(command: string, options: ExecOptions = {}): Promise<ShellResult> {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      ...options,
      env: { ...process.env, ...(options.env ?? {}) },
    });
    return {
      stdout: typeof stdout === 'string' ? stdout : stdout.toString(),
      stderr: typeof stderr === 'string' ? stderr : stderr.toString(),
    };
  }

  /**
   * Run a PowerShell command on Windows; on Unix, run the provided POSIX equivalent.
   */
  static async runShell(
    windowsPowerShell: string,
    unixCommand: string,
    options: ExecOptions = {}
  ): Promise<ShellResult> {
    if (this.isWindows) {
      // Wrap in powershell.exe -NoProfile -Command
      const escaped = windowsPowerShell.replace(/"/g, '\\"');
      return this.run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${escaped}"`, options);
    }
    return this.run(unixCommand, options);
  }

  /**
   * Ensure a directory exists (mkdir -p equivalent).
   */
  static async ensureDir(dirPath: string, options: ExecOptions = {}): Promise<void> {
    if (this.isWindows) {
      await this.run(
        `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${dirPath}' | Out-Null"`,
        options
      );
    } else {
      await this.run(`mkdir -p "${dirPath}"`, options);
    }
  }

  /**
   * Remove a directory recursively and forcefully (rm -rf equivalent).
   * Never throws — best effort.
   */
  static async removeDir(dirPath: string, options: ExecOptions = {}): Promise<void> {
    try {
      if (this.isWindows) {
        await this.run(
          `powershell -NoProfile -Command "Remove-Item -Recurse -Force -Path '${dirPath}' -ErrorAction SilentlyContinue"`,
          { timeout: 30000, ...options }
        );
      } else {
        await this.run(`rm -rf "${dirPath}"`, { timeout: 30000, ...options });
      }
    } catch {
      // Best-effort; ignore failures
    }
  }

  /**
   * Copy directory contents (cp -R src/. dst/ equivalent).
   */
  static async copyDirContents(sourceDir: string, targetDir: string, options: ExecOptions = {}): Promise<void> {
    if (this.isWindows) {
      await this.run(
        `powershell -NoProfile -Command "Copy-Item -Recurse -Force -Path '${sourceDir}\\*' -Destination '${targetDir}\\'"`,
        { timeout: 60000, ...options }
      );
    } else {
      await this.run(`cp -R "${sourceDir}/." "${targetDir}/"`, { timeout: 60000, ...options });
    }
  }

  /**
   * Copy a single file.
   */
  static async copyFile(source: string, target: string, options: ExecOptions = {}): Promise<void> {
    if (this.isWindows) {
      await this.run(
        `powershell -NoProfile -Command "Copy-Item -Force -Path '${source}' -Destination '${target}'"`,
        options
      );
    } else {
      await this.run(`cp "${source}" "${target}"`, options);
    }
  }

  /**
   * Run a command and stream its stdout/stderr line-by-line to the given
   * output channel as it runs, rather than buffering until completion.
   * Use this for long-running installer commands where live progress matters.
   *
   * Resolves with { stdout, stderr } (full accumulated text) on exit code 0.
   * Rejects with an Error whose message includes stderr on non-zero exit.
   */
  static runStreaming(
    command: string,
    outputChannel: vscode.OutputChannel,
    options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}
  ): Promise<ShellResult> {
    return new Promise((resolve, reject) => {
      // On Windows, spawn via cmd.exe so the command string is interpreted
      // identically to child_process.exec (handles powershell one-liners, etc.)
      const [shell, shellFlag] = this.isWindows
        ? ['cmd.exe', '/c']
        : ['/bin/sh', '-c'];

      const child = spawn(shell, [shellFlag, command], {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      // Guard against the promise settling twice (e.g. timeout fires then
      // close fires, or error fires then close fires).
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      // Stream stdout line-by-line to the output channel
      let stdoutBuf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBuf += text;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? ''; // keep incomplete last line in buffer
        for (const line of lines) {
          if (line.trim()) { outputChannel.appendLine(line); }
        }
      });

      // Stream stderr line-by-line too — installers use stderr for progress
      let stderrBuf = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuf += text;
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) { outputChannel.appendLine(line); }
        }
      });

      // Single close handler — flushes buffers, clears timeout, settles promise.
      let timer: ReturnType<typeof setTimeout> | undefined;
      child.on('close', (code) => {
        if (timer !== undefined) { clearTimeout(timer); }
        if (stdoutBuf.trim()) { outputChannel.appendLine(stdoutBuf); }
        if (stderrBuf.trim()) { outputChannel.appendLine(stderrBuf); }

        settle(() => {
          if (code === 0 || code === null) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(
              stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`
            ));
          }
        });
      });

      child.on('error', (err) => {
        settle(() => reject(new Error(`Failed to spawn process: ${err.message}`)));
      });

      // Enforce timeout if specified — kill the child and reject; the close
      // handler will fire after kill() but the settle guard prevents a double-reject.
      if (options.timeout && options.timeout > 0) {
        timer = setTimeout(() => {
          child.kill();
          settle(() => reject(new Error(`Command timed out after ${options.timeout}ms`)));
        }, options.timeout);
      }
    });
  }
}
