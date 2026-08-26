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
});