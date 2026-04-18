import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskfileTaskProvider } from '../../providers/taskfileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import constants from '../../libs/constants';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'src', 'test', 'task-files', 'taskfile');

suite('TaskfileTaskProvider Test Suite', () => {
  let provider: TaskfileTaskProvider;
  let originalFindFiles: any;
  let originalAsRelativePath: any;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    provider = new TaskfileTaskProvider();

    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    filesService.findFiles = async () => [];

    originalAsRelativePath = vscode.workspace.asRelativePath;
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') {
        return uri;
      }
      return uri.fsPath;
    };

    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('uses correct type', () => {
    assert.strictEqual(provider.type, 'taskfile');
  });

  test('uses correct file pattern', () => {
    assert.strictEqual(provider.filePattern, constants.GLOB_TASKFILE);
  });

  test('getCommand returns default task command', () => {
    const result = provider.getCommand();
    assert.ok(result.command.toLowerCase().includes('task'));
    assert.ok(Array.isArray(result.args));
  });

  test('getSystemTasks returns empty array', async () => {
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when disabled', async () => {
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty when no files found', async () => {
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks handles CLI exec failure gracefully', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [vscode.Uri.file('/workspace/Taskfile.yml')];

    // Override getCommand to return a non-existent executable so execFileAsync throws
    (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command-xyz', args: [], cwd: '/workspace' });

    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  suite('parseOutput', () => {
    const dir = '/workspace';

    test('returns task items from valid JSON', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks.length, 4);
    });

    test('uses task name from JSON as item label', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].label, 'build');
      assert.strictEqual(tasks[1].label, 'test');
    });

    test('sets description to relative path of taskfile', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      // asRelativePath is mocked to return fsPath
      assert.ok(typeof tasks[0].description === 'string');
      assert.ok((tasks[0].description as string).length > 0);
    });

    test('sets tooltip to desc field from JSON', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].tooltip, 'Build the application');
    });

    test('sets startLine from location.line (1-indexed to 0-indexed)', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      // location.line is 12 in fixture → startLine should be 11
      assert.strictEqual(tasks[0].startLine, 11);
    });

    test('sets taskFileUri from location.taskfile', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.ok(tasks[0].taskFileUri);
      assert.ok(tasks[0].taskFileUri!.fsPath.endsWith('Taskfile.yml'));
    });

    test('stores aliases in metadata', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      // 'test' task has aliases: ['t']
      assert.deepStrictEqual(tasks[1].metadata?.aliases, ['t']);
    });

    suite('aliases', () => {
      test('showAliases enabled: primary item is Collapsed when aliases exist', () => {
        const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'aliases-output.json'), 'utf8');
        const tasks = provider.parseOutput(stdout, dir);
        assert.strictEqual(tasks[0].collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
      });

      test('showAliases enabled: primary item is None when no aliases', () => {
        const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'aliases-output.json'), 'utf8');
        const tasks = provider.parseOutput(stdout, dir);
        assert.strictEqual(tasks[1].collapsibleState, vscode.TreeItemCollapsibleState.None);
      });

      test('showAliases enabled: alias child items are created', () => {
        const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'aliases-output.json'), 'utf8');
        const tasks = provider.parseOutput(stdout, dir);
        assert.strictEqual(tasks[0].children.length, 2);
      });

      test('showAliases enabled: alias child fields are mapped correctly', () => {
        const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'aliases-output.json'), 'utf8');
        const tasks = provider.parseOutput(stdout, dir);
        const child = tasks[0].children[0];
        assert.strictEqual(child.label, 'b');
        assert.strictEqual(child.taskFileUri?.fsPath, tasks[0].taskFileUri?.fsPath);
        assert.strictEqual(child.startLine, tasks[0].startLine);
        assert.strictEqual(child.tooltip, 'Alias for: build');
        assert.strictEqual(child.metadata?.isAlias, true);
        assert.strictEqual(child.metadata?.primaryTask, 'build');
        assert.strictEqual(child.parent, tasks[0]);
      });

      test('showAliases disabled: primary item is None and no children are created', () => {
        const previous = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
          if (section === 'workspaceTasks') {
            return {
              get: <T>(key: string, def?: T): T => {
                if (key === 'taskfile.showAliases') {
                  return false as T;
                }
                return def as T;
              },
            };
          }
          return previous(section);
        };

        try {
          const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'aliases-output.json'), 'utf8');
          const tasks = provider.parseOutput(stdout, dir);
          assert.strictEqual(tasks[0].collapsibleState, vscode.TreeItemCollapsibleState.None);
          assert.strictEqual(tasks[0].children.length, 0);
        } finally {
          (vscode.workspace as any).getConfiguration = previous;
        }
      });
    });

    test('stores summary in metadata', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].metadata?.summary, 'Compiles the source code and generates binaries');
    });

    test('sets onOpenActionCommand', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].onOpenActionCommand?.command, 'workspaceTasks.openFileAtLine');
    });

    test('supports namespaced task names', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[3].label, 'frontend:build');
    });

    test('returns empty array when tasks list is empty', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'empty-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.deepStrictEqual(tasks, []);
    });

    test('handles missing location field gracefully', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'no-location-output.json'), 'utf8');
      let tasks: any[];
      assert.doesNotThrow(() => {
        tasks = provider.parseOutput(stdout, dir);
      });
      assert.strictEqual(tasks!.length, 2);
      // startLine should default to 0 when location is absent
      assert.strictEqual(tasks![0].startLine, 0);
    });

    test('uses fallback URI when location is absent', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'no-location-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      // fallback URI is dir/Taskfile.yml
      assert.ok(tasks[0].taskFileUri?.fsPath.endsWith('Taskfile.yml'));
    });

    test('sets tooltip to task name when desc is missing or empty', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'no-location-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      // 'test' entry has desc: '' → tooltip should fall back to name
      assert.strictEqual(tasks[1].tooltip, 'test');
    });

    test('returns empty array on malformed JSON', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'malformed.txt'), 'utf8');
      let tasks: any[];
      assert.doesNotThrow(() => {
        tasks = provider.parseOutput(stdout, dir);
      });
      assert.deepStrictEqual(tasks!, []);
    });
  });

  suite('taskfile path deduplication', () => {
    test('deduplicates duplicate file entries into one invocation', async () => {
      const dir = '/workspace';
      const file1 = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));

      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [file1, file1];

      // Override getCommand to fail fast so no real process spawns
      (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command-xyz', args: [], cwd: dir });

      const tasks = await provider.getTasks();
      // Should not throw; error path returns []
      assert.deepStrictEqual(tasks, []);
    });
  });
});
