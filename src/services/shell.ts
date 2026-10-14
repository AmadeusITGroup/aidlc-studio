import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';

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
}
