import * as assert from 'assert';
import fs = require('fs');
import * as path from 'path';
import os = require('os');
import * as vscode from 'vscode';
import { TaskfileTaskProvider } from '../../providers/taskfileTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskCacheService } from '../../services/taskCacheService';
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

  suite('getSystemTasks', () => {
    const fakeHome = os.tmpdir();
    const variants = [
      'Taskfile.yml',
      'taskfile.yml',
      'Taskfile.yaml',
      'taskfile.yaml',
    ];

    let originalExistsSync: typeof fs.existsSync;
    let originalHomeDir: typeof os.homedir;
    let originalCreateFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher;

    setup(() => {
      originalExistsSync = fs.existsSync;
      originalHomeDir = os.homedir;
      originalCreateFileSystemWatcher = vscode.workspace.createFileSystemWatcher;
    });

    teardown(() => {
      (fs as any).existsSync = originalExistsSync;
      (os as any).homedir = originalHomeDir;
      (vscode.workspace as any).createFileSystemWatcher = originalCreateFileSystemWatcher;
    });

    test('returns empty and skips CLI when workspace is not trusted', async () => {
      let cliCalled = false;
      (provider as any).getCommand = () => {
        cliCalled = true;
        return { command: 'task', args: [] };
      };
      Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
      try {
        const tasks = await provider.getSystemTasks();
        assert.deepStrictEqual(tasks, []);
        assert.strictEqual(cliCalled, false, 'CLI must not be invoked for untrusted workspace');
      } finally {
        Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
      }
    });

    test('returns empty when discoverGlobalTaskfile is false', async () => {
      const tasks = await provider.getSystemTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('returns empty when no global Taskfile exists', async () => {
      (os as any).homedir = () => fakeHome;
      (fs as any).existsSync = () => false;

      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.discoverGlobalTaskfile') {
                return true as T;
              }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      (vscode.workspace as any).createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: () => undefined,
        onDidDelete: () => undefined,
        dispose: () => undefined,
      });

      const tasks = await provider.getSystemTasks();
      assert.deepStrictEqual(tasks, []);
    });

    test('discovers tasks from global Taskfile and sets metadata', async () => {
      const globalTaskfilePath = path.join(fakeHome, 'Taskfile.yml');
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'global-output.json'), 'utf8');

      (os as any).homedir = () => fakeHome;
      (fs as any).existsSync = (p: string) => p === globalTaskfilePath;

      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.discoverGlobalTaskfile') {
                return true as T;
              }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      (vscode.workspace as any).createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: () => undefined,
        onDidDelete: () => undefined,
        dispose: () => undefined,
      });

      const script = `process.stdout.write(${JSON.stringify(stdout)});`;
      (provider as any).getCommand = () => ({ command: 'node', args: ['-e', script, '--'], cwd: fakeHome });

      const tasks = await provider.getSystemTasks();
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[0].metadata?.isGlobalTask, true);
      assert.strictEqual(tasks[0].metadata?.globalTaskfilePath, globalTaskfilePath);
      assert.strictEqual(tasks[1].metadata?.isGlobalTask, true);
      assert.strictEqual(tasks[1].metadata?.globalTaskfilePath, globalTaskfilePath);
    });

    test('checks variants in precedence order', async () => {
      const seen: string[] = [];
      const winner = path.join(fakeHome, variants[2]);

      (os as any).homedir = () => fakeHome;
      (fs as any).existsSync = (p: string) => {
        seen.push(p);
        return p === winner;
      };

      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.discoverGlobalTaskfile') {
                return true as T;
              }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      (vscode.workspace as any).createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: () => undefined,
        onDidDelete: () => undefined,
        dispose: () => undefined,
      });

      (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command-xyz', args: [], cwd: fakeHome });
      await provider.getSystemTasks();

      assert.ok(seen.length >= 3);
      assert.strictEqual(seen[0], path.join(fakeHome, variants[0]));
      assert.strictEqual(seen[1], path.join(fakeHome, variants[1]));
      assert.strictEqual(seen[2], path.join(fakeHome, variants[2]));
    });

    test('watcher events trigger cache refresh (debounced)', async () => {
      const globalTaskfilePath = path.join(fakeHome, 'Taskfile.yml');
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'global-output.json'), 'utf8');

      (os as any).homedir = () => fakeHome;
      (fs as any).existsSync = (p: string) => p === globalTaskfilePath;

      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.discoverGlobalTaskfile') {
                return true as T;
              }
              return def as T;
            },
          };
        }
        return originalGetConfiguration(section);
      };

      let onDidChangeCallback: (() => void) | undefined;
      let disposeCount = 0;
      (vscode.workspace as any).createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: (cb: () => void) => {
          onDidChangeCallback = cb;
          return undefined;
        },
        onDidDelete: () => undefined,
        dispose: () => {
          disposeCount += 1;
        },
      });

      const script = `process.stdout.write(${JSON.stringify(stdout)});`;
      (provider as any).getCommand = () => ({ command: 'node', args: ['-e', script, '--'], cwd: fakeHome });

      const cache = TaskCacheService.getInstance();
      const originalRefresh = cache.refresh.bind(cache);
      let refreshCount = 0;
      (cache as any).refresh = async () => {
        refreshCount += 1;
        return [];
      };

      try {
        await provider.getSystemTasks();
        assert.ok(onDidChangeCallback);
        onDidChangeCallback!();
        await new Promise((resolve) => setTimeout(resolve, 220));
        assert.strictEqual(refreshCount, 1);
      } finally {
        (cache as any).refresh = originalRefresh;
      }

      await provider.getSystemTasks();
      assert.ok(disposeCount > 0);
    });
  });

  test('getTasks returns empty when disabled', async () => {
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getTasks returns empty and skips CLI when workspace is not trusted', async () => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = async () => [vscode.Uri.file('/workspace/Taskfile.yml')];
    let cliCalled = false;
    (provider as any).getCommand = () => {
      cliCalled = true;
      return { command: 'task', args: [] };
    };
    Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => false, configurable: true });
    try {
      const tasks = await provider.getTasks();
      assert.deepStrictEqual(tasks, []);
      assert.strictEqual(cliCalled, false, 'CLI must not be invoked for untrusted workspace');
    } finally {
      Object.defineProperty(vscode.workspace, 'isTrusted', { get: () => true, configurable: true });
    }
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

  suite('additionalFilePatterns', () => {
    test('getTasks uses only built-in patterns when additionalFilePatterns is empty', async () => {
      const filesService = TaskFilesService.getInstance();
      let capturedPatterns: string[] = [];
      filesService.findFiles = async (patterns: string[]) => {
        capturedPatterns = patterns;
        return [];
      };

      await provider.getTasks();
      assert.deepStrictEqual(capturedPatterns, [constants.GLOB_TASKFILE]);
    });

    test('getTasks merges custom patterns with built-in', async () => {
      const filesService = TaskFilesService.getInstance();
      let capturedPatterns: string[] = [];
      filesService.findFiles = async (patterns: string[]) => {
        capturedPatterns = patterns;
        return [];
      };

      const previous = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.additionalFilePatterns') {
                return ['**/Taskfile.ci.yml'] as T;
              }
              return def as T;
            },
          };
        }
        return previous(section);
      };

      try {
        await provider.getTasks();
      } finally {
        (vscode.workspace as any).getConfiguration = previous;
      }

      assert.deepStrictEqual(capturedPatterns, [constants.GLOB_TASKFILE, '**/Taskfile.ci.yml']);
    });

    test('Taskfiles are deduplicated by path', async () => {
      const dir = '/workspace';
      const file1 = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));
      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [file1, file1];

      let invocationCount = 0;
      const previousLoader = (provider as any)._loadTasksFromDirectory;
      (provider as any)._loadTasksFromDirectory = async () => {
        invocationCount += 1;
        return [];
      };

      try {
        await provider.getTasks();
      } finally {
        (provider as any)._loadTasksFromDirectory = previousLoader;
      }

      assert.strictEqual(invocationCount, 1);
    });

    test('multiple distinct Taskfiles in same directory each get a CLI invocation', async () => {
      const dir = '/workspace/backend';
      const firstTaskfile = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));
      const secondTaskfile = vscode.Uri.file(path.join(dir, 'Taskfile.ci.yml'));
      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [firstTaskfile, secondTaskfile];

      let invocationCount = 0;
      const previousLoader = (provider as any)._loadTasksFromDirectory;
      (provider as any)._loadTasksFromDirectory = async () => {
        invocationCount += 1;
        return [];
      };

      try {
        await provider.getTasks();
      } finally {
        (provider as any)._loadTasksFromDirectory = previousLoader;
      }

      assert.strictEqual(invocationCount, 2);
    });

    test('discovery loader is invoked with expected positional args', async () => {
      const selectedTaskfile = vscode.Uri.file('/workspace/backend/Taskfile.ci.yml');
      const filesService = TaskFilesService.getInstance();
      filesService.findFiles = async () => [selectedTaskfile];

      let capturedDir: string | undefined;
      let capturedPath: string | undefined;
      const previousLoader = (provider as any)._loadTasksFromDirectory;
      (provider as any)._loadTasksFromDirectory = async (
        dir: string,
        file: vscode.Uri,
        _iconService: unknown,
      ) => {
        capturedDir = dir;
        capturedPath = file.fsPath;
        return [];
      };

      try {
        await provider.getTasks();
      } finally {
        (provider as any)._loadTasksFromDirectory = previousLoader;
      }

      assert.strictEqual(capturedDir, '/workspace/backend');
      assert.strictEqual(capturedPath, '/workspace/backend/Taskfile.ci.yml');
    });
  });

  suite('parseOutput', () => {
    const dir = '/workspace';

    test('returns task items from valid JSON', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks.length, 4);
    });

    test('uses custom-named taskfile location when present', () => {
      const stdout = fs.readFileSync(path.join(FIXTURE_DIR, 'custom-named-output.json'), 'utf8');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks.length, 1);
      assert.ok(tasks[0].taskFileUri?.fsPath.endsWith('Taskfile.ci.yml'));
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

  // ── Wildcard & CLI_ARGS detection ────────────────────────────────────────

  suite('wildcard and CLI_ARGS detection', () => {
    const dir = '/workspace';

    function makeWildcardJson(name: string, aliases?: string[]): string {
      return JSON.stringify({
        tasks: [
          {
            name,
            task: name,
            desc: '',
            aliases: aliases ?? [],
            location: { line: 1, column: 1, taskfile: path.join(dir, 'Taskfile.yml') },
          },
        ],
        location: dir,
      });
    }

    // ── T-W1 ──────────────────────────────────────────────────────────────
    test('T-W1: parseOutput sets isWildcardTask=true and wildcardCount=1 for start:*', () => {
      const stdout = makeWildcardJson('start:*');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].metadata?.isWildcardTask, true);
      assert.strictEqual(tasks[0].metadata?.wildcardCount, 1);
    });

    // ── T-W2 ──────────────────────────────────────────────────────────────
    test('T-W2: parseOutput sets wildcardCount=2 for start:*:*', () => {
      const stdout = makeWildcardJson('start:*:*');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].metadata?.isWildcardTask, true);
      assert.strictEqual(tasks[0].metadata?.wildcardCount, 2);
    });

    // ── T-W3 ──────────────────────────────────────────────────────────────
    test('T-W3: parseOutput leaves isWildcardTask unset for non-wildcard tasks', () => {
      const stdout = makeWildcardJson('build');
      const tasks = provider.parseOutput(stdout, dir);
      assert.strictEqual(tasks[0].metadata?.isWildcardTask, undefined);
    });

    // ── T-W4 ──────────────────────────────────────────────────────────────
    test('T-W4: parseOutput sets isWildcardTask on alias items when alias contains *', () => {
      const previous = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.showAliases') { return true as T; }
              return def as T;
            },
          };
        }
        return previous(section);
      };
      try {
        const stdout = makeWildcardJson('start:*', ['run:*']);
        const tasks = provider.parseOutput(stdout, dir);
        assert.strictEqual(tasks[0].children.length, 1);
        const alias = tasks[0].children[0];
        assert.strictEqual(alias.metadata?.isWildcardTask, true);
        assert.strictEqual(alias.metadata?.wildcardCount, 1);
      } finally {
        (vscode.workspace as any).getConfiguration = previous;
      }
    });

    // Wildcard tooltip
    test('parseOutput sets wildcard tooltip when task name contains *', () => {
      const stdout = makeWildcardJson('start:*');
      const tasks = provider.parseOutput(stdout, dir);
      assert.ok((tasks[0].tooltip as string).includes('Wildcard task'));
    });

    // ── T-C1 ──────────────────────────────────────────────────────────────
    test('T-C1: detectCLIArgsTasks returns task name when cmds has string cmd with {{.CLI_ARGS}}', () => {
      const yaml = [
        'version: "3"',
        'tasks:',
        '  yarn:',
        '    cmds:',
        '      - yarn {{.CLI_ARGS}}',
      ].join('\n');
      const result = provider.detectCLIArgsTasks('/some/Taskfile.yml', yaml);
      assert.ok(result.has('yarn'));
    });

    // ── T-C2 ──────────────────────────────────────────────────────────────
    test('T-C2: detectCLIArgsTasks returns task name when cmds has {cmd:...} object with {{.CLI_ARGS}}', () => {
      const yaml = [
        'version: "3"',
        'tasks:',
        '  serve:',
        '    cmds:',
        '      - cmd: node server.js {{.CLI_ARGS}}',
      ].join('\n');
      const result = provider.detectCLIArgsTasks('/some/Taskfile2.yml', yaml);
      assert.ok(result.has('serve'));
    });

    // ── T-C3 ──────────────────────────────────────────────────────────────
    test('T-C3: detectCLIArgsTasks does not return task name when {{.CLI_ARGS}} absent', () => {
      const yaml = [
        'version: "3"',
        'tasks:',
        '  build:',
        '    cmds:',
        '      - go build ./...',
      ].join('\n');
      const result = provider.detectCLIArgsTasks('/other/Taskfile.yml', yaml);
      assert.strictEqual(result.has('build'), false);
    });

    // ── T-C4 ──────────────────────────────────────────────────────────────
    test('T-C4: detectCLIArgsTasks caches result (second call returns cached set)', () => {
      const filePath = '/cached/Taskfile.yml';
      const yaml = [
        'version: "3"',
        'tasks:',
        '  run:',
        '    cmds:',
        '      - ./run.sh {{.CLI_ARGS}}',
      ].join('\n');
      const first = provider.detectCLIArgsTasks(filePath, yaml);
      // Change the yaml — the cache should still return the original set
      const differentYaml = 'version: "3"\ntasks:\n  other:\n    cmds:\n      - echo hi\n';
      const second = provider.detectCLIArgsTasks(filePath, differentYaml);
      assert.strictEqual(first, second, 'second call must return the same cached Set instance');
    });

    // ── T-C5 ──────────────────────────────────────────────────────────────
    test('T-C5: parseOutput sets hasCLIArgs=true on item when task is in cliArgs set', () => {
      const filePath = path.join(dir, 'Taskfile.yml');
      const yamlContent = [
        'version: "3"',
        'tasks:',
        '  yarn:',
        '    cmds:',
        '      - yarn {{.CLI_ARGS}}',
      ].join('\n');
      const stdout = makeWildcardJson('yarn');
      const tasks = provider.parseOutput(stdout, dir, undefined, filePath, yamlContent);
      assert.strictEqual(tasks[0].metadata?.hasCLIArgs, true);
    });

    // ── T-C6 ──────────────────────────────────────────────────────────────
    test('T-C6: invalidateCLIArgsCache removes the cached entry', () => {
      const filePath = '/invalidate/Taskfile.yml';
      const yaml = 'version: "3"\ntasks:\n  run:\n    cmds:\n      - echo {{.CLI_ARGS}}\n';
      provider.detectCLIArgsTasks(filePath, yaml);
      provider.invalidateCLIArgsCache(filePath);
      // After invalidation, new content should be parsed (different result)
      const newYaml = 'version: "3"\ntasks:\n  other:\n    cmds:\n      - echo hi\n';
      const result = provider.detectCLIArgsTasks(filePath, newYaml);
      assert.strictEqual(result.has('run'), false, 'Cache should be invalidated');
      assert.strictEqual(result.has('other'), false, 'other has no CLI_ARGS');
    });

    // ── T-C7 ──────────────────────────────────────────────────────────────
    test('T-C7: detectCLIArgsTasks returns empty Set (not throw) when YAML is malformed', () => {
      const filePath = '/bad/Taskfile.yml';
      let result: Set<string>;
      assert.doesNotThrow(() => {
        result = provider.detectCLIArgsTasks(filePath, '{ not: valid: yaml: [}');
      });
      assert.ok(result! instanceof Set);
      assert.strictEqual(result!.size, 0);
    });

    // ── T-C8 ──────────────────────────────────────────────────────────────
    test('T-C8: parseOutput does not set hasCLIArgs when task is not in cliArgs set', () => {
      const filePath = path.join(dir, 'Taskfile.yml');
      const yamlContent = [
        'version: "3"',
        'tasks:',
        '  build:',
        '    cmds:',
        '      - go build ./...',
      ].join('\n');
      const stdout = makeWildcardJson('build');
      const tasks = provider.parseOutput(stdout, dir, undefined, filePath, yamlContent);
      assert.strictEqual(tasks[0].metadata?.hasCLIArgs, undefined);
    });

    // ── T-C8b ─────────────────────────────────────────────────────────────
    test('T-C8b: detectCLIArgsTasks detects {{.CLI_ARGS}} inside double-quoted string with embedded quotes', () => {
      // This Taskfile syntax causes yaml.parse to fail without pre-processing:
      //   - echo "Running with arguments: {{.CLI_ARGS}}"
      const filePath = path.join(dir, 'Taskfile-C8b.yml');
      const yamlContent = [
        'version: "3"',
        'tasks:',
        '  withArgs:',
        '    desc: Run a command with arguments',
        '    cmds:',
        '      - echo "Running with arguments: {{.CLI_ARGS}}"',
      ].join('\n');
      const result = provider.detectCLIArgsTasks(filePath, yamlContent);
      assert.ok(result.has('withArgs'), 'should detect CLI_ARGS even when cmd contains embedded double-quotes');
    });

    // ── T-C8c ─────────────────────────────────────────────────────────────
    test('T-C8c: parseOutput sets hasCLIArgs for task using double-quoted CLI_ARGS cmd', () => {
      const filePath = path.join(dir, 'Taskfile-C8c.yml');
      const yamlContent = [
        'version: "3"',
        'tasks:',
        '  withArgs:',
        '    desc: Run a command with arguments',
        '    cmds:',
        '      - echo "Running with arguments: {{.CLI_ARGS}}"',
      ].join('\n');
      const stdout = JSON.stringify({ tasks: [{ name: 'withArgs', desc: 'Run a command with arguments', location: { taskfile: filePath, line: 3 } }] });
      const tasks = provider.parseOutput(stdout, dir, undefined, filePath, yamlContent);
      assert.strictEqual(tasks[0].metadata?.hasCLIArgs, true, 'hasCLIArgs should be true for double-quoted CLI_ARGS cmd');
    });

    // ── T-C9 ──────────────────────────────────────────────────────────────
    test('T-C9: watcher onDidDelete event triggers cache invalidation', async () => {
      const fakeHome = os.tmpdir();
      const globalTaskfilePath = path.join(fakeHome, 'Taskfile.yml');

      // Pre-seed the cache
      const yaml = 'version: "3"\ntasks:\n  run:\n    cmds:\n      - echo {{.CLI_ARGS}}\n';
      provider.detectCLIArgsTasks(globalTaskfilePath, yaml);

      const onDeleteCallbacks: Array<() => void> = [];
      const originalCreateWatcher = vscode.workspace.createFileSystemWatcher;
      (vscode.workspace as any).createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: () => undefined,
        onDidDelete: (cb: () => void) => { onDeleteCallbacks.push(cb); return undefined; },
        dispose: () => undefined,
      });

      const originalExistsSync = fs.existsSync;
      (fs as any).existsSync = (p: string) => p === globalTaskfilePath;
      const originalHomeDir = os.homedir;
      (os as any).homedir = () => fakeHome;
      const originalGetConfig = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.discoverGlobalTaskfile') { return true as T; }
              return def as T;
            },
          };
        }
        return originalGetConfig(section);
      };

      try {
        // This registers the watchers (one per variant path)
        (provider as any).getCommand = () => ({ command: 'definitely-not-a-real-command-xyz', args: [] });
        await provider.getSystemTasks().catch(() => { /* expected CLI failure */ });

        assert.ok(onDeleteCallbacks.length > 0, 'onDidDelete handlers should be registered');
        // Fire all delete callbacks (each invalidates its respective path, including globalTaskfilePath)
        for (const cb of onDeleteCallbacks) { cb(); }

        // Cache should be cleared — re-parsing with different content should work
        const newYaml = 'version: "3"\ntasks:\n  other:\n    cmds:\n      - echo hi\n';
        const result = provider.detectCLIArgsTasks(globalTaskfilePath, newYaml);
        assert.strictEqual(result.has('run'), false, 'old entry should be gone after delete invalidation');
      } finally {
        (vscode.workspace as any).createFileSystemWatcher = originalCreateWatcher;
        (fs as any).existsSync = originalExistsSync;
        (os as any).homedir = originalHomeDir;
        (vscode.workspace as any).getConfiguration = originalGetConfig;
      }
    });
  });

  suite('required vars detection', () => {
    const dir = '/workspace';

    function makeTaskJson(name: string, aliases?: string[]): string {
      return JSON.stringify({
        tasks: [
          {
            name,
            task: name,
            desc: '',
            aliases: aliases ?? [],
            location: { line: 1, column: 1, taskfile: path.join(dir, 'Taskfile.yml') },
          },
        ],
        location: dir,
      });
    }

    test('detectRequiredVars parses requires.vars and predefined var defaults', () => {
      const filePath = path.join(dir, 'Taskfile.yml');
      const yaml = [
        'version: "3"',
        'vars:',
        '  VERSION: 1.2.3',
        'tasks:',
        '  deploy:',
        '    vars:',
        '      ENV: prod',
        '    requires:',
        '      vars:',
        '        - VERSION',
        '        - name: ENV',
        '          enum: [dev, staging, prod]',
      ].join('\n');

      const info = provider.detectRequiredVars(filePath, yaml);
      assert.ok(info.tasks.has('deploy'));
      assert.deepStrictEqual(info.tasks.get('deploy'), [
        { name: 'VERSION' },
        { name: 'ENV', enum: ['dev', 'staging', 'prod'] },
      ]);
      assert.deepStrictEqual(info.taskVarDefaults.get('deploy'), {
        VERSION: '1.2.3',
        ENV: 'prod',
      });
    });

    test('detectRequiredVars returns cached result for same file path', () => {
      const filePath = path.join(dir, 'Taskfile-cache.yml');
      const yaml = [
        'version: "3"',
        'tasks:',
        '  deploy:',
        '    requires:',
        '      vars:',
        '        - VERSION',
      ].join('\n');

      const first = provider.detectRequiredVars(filePath, yaml);
      const second = provider.detectRequiredVars(filePath, yaml.replace('VERSION', 'OTHER'));
      assert.strictEqual(first, second);
      assert.deepStrictEqual(second.tasks.get('deploy'), [{ name: 'VERSION' }]);
    });

    test('invalidateTaskfileCache clears required vars cache', () => {
      const filePath = path.join(dir, 'Taskfile-invalidate.yml');
      const yaml = [
        'version: "3"',
        'tasks:',
        '  deploy:',
        '    requires:',
        '      vars:',
        '        - VERSION',
      ].join('\n');

      provider.detectRequiredVars(filePath, yaml);
      provider.invalidateTaskfileCache(filePath);

      const after = provider.detectRequiredVars(filePath, yaml.replace('VERSION', 'OTHER'));
      assert.deepStrictEqual(after.tasks.get('deploy'), [{ name: 'OTHER' }]);
    });

    test('parseOutput sets requiredVars and predefinedVarValues metadata on task and aliases', () => {
      const previous = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'taskfile.showAliases') {
                return true as T;
              }
              return def as T;
            },
          };
        }
        return previous(section);
      };

      const filePath = path.join(dir, 'Taskfile.yml');
      const yaml = [
        'version: "3"',
        'vars:',
        '  VERSION: 1.2.3',
        'tasks:',
        '  deploy:',
        '    vars:',
        '      ENV: prod',
        '    requires:',
        '      vars:',
        '        - VERSION',
      ].join('\n');

      try {
        const tasks = provider.parseOutput(makeTaskJson('deploy', ['ship']), dir, undefined, filePath, yaml);
        assert.strictEqual(tasks.length, 1);
        assert.deepStrictEqual(tasks[0].metadata?.requiredVars, [{ name: 'VERSION' }]);
        assert.deepStrictEqual(tasks[0].metadata?.predefinedVarValues, { VERSION: '1.2.3', ENV: 'prod' });
        assert.ok((tasks[0].tooltip as string).includes('Requires variables: VERSION'));

        assert.strictEqual(tasks[0].children.length, 1);
        assert.deepStrictEqual(tasks[0].children[0].metadata?.requiredVars, [{ name: 'VERSION' }]);
        assert.deepStrictEqual(tasks[0].children[0].metadata?.predefinedVarValues, { VERSION: '1.2.3', ENV: 'prod' });
      } finally {
        (vscode.workspace as any).getConfiguration = previous;
      }
    });
  });
});
