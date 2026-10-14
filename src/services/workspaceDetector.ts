import * as vscode from 'vscode';
import { WorkspaceInfo } from '../types';

export class WorkspaceDetector {
  private static readonly SOURCE_DIRS = ['src', 'app', 'lib', 'pages', 'components', 'tests', 'test'];

  private static readonly FRAMEWORK_INDICATORS: Record<string, string[]> = {
    react: ['react', 'next', 'gatsby'],
    vue: ['vue', 'nuxt'],
    angular: ['@angular/core'],
    express: ['express'],
    fastify: ['fastify'],
    nestjs: ['@nestjs/core'],
    django: ['django'],
    flask: ['flask'],
    spring: ['spring-boot'],
  };

  private static readonly LANGUAGE_EXTENSIONS: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
  };

  async detect(workspaceUri: vscode.Uri): Promise<WorkspaceInfo> {
    const info: WorkspaceInfo = {
      type: 'greenfield',
      languages: [],
      frameworks: [],
      hasExistingAidlc: false,
    };

    try {
      const rootEntries = await vscode.workspace.fs.readDirectory(workspaceUri);
      const rootFiles = rootEntries.map(([name]) => name);

      // Check for existing AIDLC
      info.hasExistingAidlc = rootFiles.includes('aidlc') || rootFiles.includes('.aidlc');

      // Detect package manager
      if (rootFiles.includes('package-lock.json')) {
        info.packageManager = 'npm';
      } else if (rootFiles.includes('yarn.lock')) {
        info.packageManager = 'yarn';
      } else if (rootFiles.includes('pnpm-lock.yaml')) {
        info.packageManager = 'pnpm';
      } else if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml')) {
        info.packageManager = 'pip';
      } else if (rootFiles.includes('go.mod')) {
        info.packageManager = 'go';
      } else if (rootFiles.includes('Cargo.toml')) {
        info.packageManager = 'cargo';
      }

      // Detect test runner
      if (rootFiles.includes('jest.config.js') || rootFiles.includes('jest.config.ts')) {
        info.testRunner = 'jest';
      } else if (rootFiles.includes('vitest.config.ts') || rootFiles.includes('vitest.config.js')) {
        info.testRunner = 'vitest';
      } else if (rootFiles.includes('pytest.ini') || rootFiles.includes('conftest.py')) {
        info.testRunner = 'pytest';
      }

      // Detect languages by scanning source directories
      const languages = new Set<string>();
      const dirsToScan = rootEntries
        .filter(([name, type]) => type === vscode.FileType.Directory && WorkspaceDetector.SOURCE_DIRS.includes(name))
        .map(([name]) => name);

      // Also scan root for source files
      dirsToScan.push('.');

      for (const dir of dirsToScan) {
        const dirUri = dir === '.' ? workspaceUri : vscode.Uri.joinPath(workspaceUri, dir);
        try {
          const entries = await vscode.workspace.fs.readDirectory(dirUri);
          for (const [fileName] of entries) {
            const ext = this.getExtension(fileName);
            if (ext && WorkspaceDetector.LANGUAGE_EXTENSIONS[ext]) {
              languages.add(WorkspaceDetector.LANGUAGE_EXTENSIONS[ext]);
            }
          }
        } catch {
          // Directory not accessible
        }
      }

      info.languages = Array.from(languages);

      // Detect frameworks from package.json
      if (rootFiles.includes('package.json')) {
        const packageUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
        try {
          const content = await vscode.workspace.fs.readFile(packageUri);
          const pkg = JSON.parse(Buffer.from(content).toString('utf-8'));
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

          for (const [framework, indicators] of Object.entries(WorkspaceDetector.FRAMEWORK_INDICATORS)) {
            if (indicators.some((ind) => ind in allDeps)) {
              info.frameworks.push(framework);
            }
          }
        } catch {
          // package.json not parseable
        }
      }

      // Classify workspace type
      const hasSourceFiles = info.languages.length > 0;
      const hasSourceDirs = dirsToScan.length > 1; // More than just '.'
      info.type = (hasSourceFiles || hasSourceDirs) ? 'brownfield' : 'greenfield';

    } catch {
      // Workspace not accessible — default to greenfield
    }

    return info;
  }

  private getExtension(fileName: string): string | null {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) {
      return null;
    }
    return fileName.slice(lastDot);
  }
}
