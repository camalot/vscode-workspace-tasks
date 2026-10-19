import * as assert from 'assert';
import * as vscode from 'vscode';
import { BaseTaskProvider } from '../../taskProvider';
import { TaskItem } from '../../taskItem';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskConfigService } from '../../services/taskConfigService';

class StubProvider extends BaseTaskProvider {
  constructor(type = 'makefile', filePattern = '**/*.mk') {
    super(type, filePattern);
  }

  async getTasks(): Promise<TaskItem[]> {
    return [];
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }

  public exposedGetFilePatterns(): string[] {
    return this.getFilePatterns();
  }

  public exposedGetMatchingFiles(exclude?: string[]): Promise<vscode.Uri[]> {
    return this.getMatchingFiles(exclude);
  }
}

suite('BaseTaskProvider Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
    (TaskConfigService as any).instance = undefined;
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (TaskConfigService as any).instance = undefined;
  });

  function stubAdditionalFilePatterns(patternsByType: Record<string, unknown>): void {
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, defaultValue?: T): T => {
            if (key === 'additionalFilePatterns') {
              return patternsByType as T;
            }
            return defaultValue as T;
          },
        };
      }
      return originalGetConfiguration(section);
    };
  }

  test('getFilePatterns returns the built-in pattern when no extras are configured', () => {
    stubAdditionalFilePatterns({});
    const provider = new StubProvider();

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/*.mk']);
  });

  test('getFilePatterns merges built-in and configured patterns with deduplication', () => {
    stubAdditionalFilePatterns({ make: ['**/*.mk', '**/*.mk', '**/*.mk.local'] });
    const provider = new StubProvider('makefile', '**/*.mk');

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/*.mk', '**/*.mk.local']);
  });

  test('getFilePatterns ignores configured patterns for recognized but non-file-based types', () => {
    stubAdditionalFilePatterns({ docker: ['**/Dockerfile.custom'] });
    const provider = new StubProvider('dockerfile', '**/Dockerfile');

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/Dockerfile']);
  });

  test('getFilePatterns ignores configured patterns for unknown types', () => {
    stubAdditionalFilePatterns({ 'custom-type': ['**/*.custom'] });
    const provider = new StubProvider('custom-type', '**/*.base');

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/*.base']);
  });

  test('getFilePatterns ignores non-array configuration values', () => {
    stubAdditionalFilePatterns({ make: '**/*.mk' });
    const provider = new StubProvider();

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/*.mk']);
  });

  test('getFilePatterns filters non-string and empty entries from configured patterns', () => {
    stubAdditionalFilePatterns({ make: ['**/*.mk', '', 123, null, '**/*.mk.extra'] });
    const provider = new StubProvider();

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/*.mk', '**/*.mk.extra']);
  });

  test('getMatchingFiles forwards merged patterns to TaskFilesService', async () => {
    stubAdditionalFilePatterns({ make: ['**/*.mk.extra'] });
    const provider = new StubProvider();
    const filesService = TaskFilesService.getInstance();
    const originalFindFiles = filesService.findFiles.bind(filesService);
    const calls: Array<{ patterns: string[]; exclude?: string[] }> = [];

    filesService.findFiles = async (patterns: string[], exclude?: string[]) => {
      calls.push({ patterns, exclude });
      return [vscode.Uri.file('/tmp/makefile.mk')];
    };

    try {
      const result = await provider.exposedGetMatchingFiles(['**/ignore/**']);
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(calls, [{ patterns: ['**/*.mk', '**/*.mk.extra'], exclude: ['**/ignore/**'] }]);
    } finally {
      filesService.findFiles = originalFindFiles;
    }
  });

  test('getFilePatterns merges the generic setting for workspace-task providers', () => {
    stubAdditionalFilePatterns({ workspace: ['**/.workspace-tasks.json'] });
    const provider = new StubProvider('workspace-task', '**/.workspace-tasks.json');

    assert.deepStrictEqual(provider.exposedGetFilePatterns(), ['**/.workspace-tasks.json']);
  });

  test('discovery respects opposite folder and workspace npm/pnpm settings', async () => {
    const folder = vscode.workspace.workspaceFolders![0];
    const folderFile = vscode.Uri.joinPath(folder.uri, 'folder-package.json');
    const otherFile = vscode.Uri.file('/other-project/package.json');
    const workspaceTypes: Record<string, boolean> = { npm: true, pnpm: false };
    const folderTypes: Record<string, boolean> = { npm: false, pnpm: true };
    vscode.workspace.getConfiguration = (_section, resource) => {
      const values = resource === folder.uri || resource === folderFile ? folderTypes : workspaceTypes;
      return {
        get: <T>(key: string, fallback?: T): T =>
          (key === 'enabledTaskTypes' ? values : fallback) as T,
      } as vscode.WorkspaceConfiguration;
    };
    const filesService = TaskFilesService.getInstance();
    const originalFindFiles = filesService.findFiles;
    filesService.findFiles = async () => [folderFile, otherFile];

    try {
      const npm = new StubProvider('npm', '**/package.json');
      const pnpm = new StubProvider('pnpm', '**/package.json');
      assert.strictEqual(npm.enabled, false);
      assert.strictEqual(pnpm.enabled, true);
      assert.deepStrictEqual(await npm.exposedGetMatchingFiles(), [otherFile]);
      assert.deepStrictEqual(await pnpm.exposedGetMatchingFiles(), [folderFile]);
    } finally {
      filesService.findFiles = originalFindFiles;
    }
  });

  test('enabled falls back to workspace settings when no folders are open', () => {
    const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders')!;
    Object.defineProperty(vscode.workspace, 'workspaceFolders', { configurable: true, value: undefined });
    vscode.workspace.getConfiguration = (_section, resource) => {
      assert.strictEqual(resource, undefined);
      return {
        get: <T>(key: string, fallback?: T): T =>
          (key === 'enabledTaskTypes' ? { npm: false, pnpm: true } : fallback) as T,
      } as vscode.WorkspaceConfiguration;
    };

    try {
      assert.strictEqual(new StubProvider('npm').enabled, false);
      assert.strictEqual(new StubProvider('pnpm').enabled, true);
    } finally {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', descriptor);
    }
  });
});