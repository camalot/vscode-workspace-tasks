import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ShellTaskProvider } from '../../providers/shellTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';

// Helper to build a file URI from the task-files/shell directory.
// The compiled tests run from out/test/suite but task-files live in src/test/task-files,
// so we navigate up from the compiled directory to the source fixtures.
function shellUri(filename: string): vscode.Uri {
  return vscode.Uri.file(path.resolve(__dirname, '../../../src/test/task-files/shell', filename));
}

suite('ShellTaskProvider Test Suite', () => {
  let originalFindFiles: typeof TaskFilesService.prototype.findFiles;
  let originalGetConfig: typeof vscode.workspace.getConfiguration;
  let originalAsRelativePath: typeof vscode.workspace.asRelativePath;

  // Default configuration returned by mocked getConfiguration('workspaceTasks')
  let mockConfig: Record<string, unknown>;

  setup(() => {
    const filesService = TaskFilesService.getInstance();
    originalFindFiles = filesService.findFiles.bind(filesService);
    originalGetConfig = vscode.workspace.getConfiguration.bind(vscode.workspace);
    originalAsRelativePath = vscode.workspace.asRelativePath.bind(vscode.workspace);

    // Default: all built-in shell types enabled, no custom paths
    mockConfig = {
      shellEnabled: true,
      shellEnabledTaskTypes: {
        bash: true, zsh: true, fish: true, pwsh: true, batch: true,
        python: true, perl: true, ruby: true, sh: true, nushell: true,
        other: false,
      },
      shellPaths: {},
      shellAdditionalExtensions: {},
    };

    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, def?: T): T => {
            return (Object.prototype.hasOwnProperty.call(mockConfig, key) ? mockConfig[key] : def) as T;
          },
        };
      }
      return originalGetConfig(section);
    };

    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
      return fsPath;
    };

    // Default: no files found — individual tests override as needed
    filesService.findFiles = async () => [];
  });

  teardown(() => {
    const filesService = TaskFilesService.getInstance();
    filesService.findFiles = originalFindFiles;
    (vscode.workspace as any).getConfiguration = originalGetConfig;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  });

  // ── Identity ─────────────────────────────────────────────────────────────────

  test('has correct type', () => {
    const provider = new ShellTaskProvider();
    assert.strictEqual(provider.type, 'shell');
  });

  // ── Disabled provider ─────────────────────────────────────────────────────

  test('getTasks returns empty array when disabled', async () => {
    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when disabled', async () => {
    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  test('getSystemTasks returns empty array when enabled', async () => {
    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getSystemTasks();
    assert.deepStrictEqual(tasks, []);
  });

  // ── Python: no requireShebang ─────────────────────────────────────────────

  test('python files WITHOUT a shebang are included as tasks', async () => {
    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [noShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    assert.ok(tasks.length > 0, 'Should produce at least one task for the python file without shebang');
    const pyTask = tasks.find((t) => t.resourceUri?.fsPath === noShebangUri.fsPath);
    assert.ok(pyTask, 'Should find a task for no-shebang.py');
    assert.strictEqual(pyTask?.metadata?.interpreter, 'python3', 'Should use default interpreter');
    assert.strictEqual(pyTask?.metadata?.useShebang, false, 'useShebang should be false when no shebang present');
  });

  test('python files WITH a shebang are executed directly (useShebang)', async () => {
    const filesService = TaskFilesService.getInstance();
    const withShebangUri = shellUri('with-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [withShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const pyTask = tasks.find((t) => t.resourceUri?.fsPath === withShebangUri.fsPath);
    assert.ok(pyTask, 'Should find a task for with-shebang.py');
    assert.strictEqual(pyTask?.metadata?.interpreter, '', 'interpreter should be empty when useShebang applies');
    assert.strictEqual(pyTask?.metadata?.useShebang, true, 'useShebang should be true when shebang is present');
  });

  // ── Configured interpreter override ──────────────────────────────────────

  test('configured interpreter (shellPaths) is used for files without a shebang', async () => {
    mockConfig.shellPaths = { python: 'python3' };

    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [noShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const pyTask = tasks.find((t) => t.resourceUri?.fsPath === noShebangUri.fsPath);
    assert.ok(pyTask, 'Should find a task for no-shebang.py');
    assert.strictEqual(pyTask?.metadata?.interpreter, 'python3', 'Should use overridden interpreter from shellPaths');
  });

  test('configured interpreter is ignored for files with a shebang (direct execution used instead)', async () => {
    mockConfig.shellPaths = { python: 'python3' };

    const filesService = TaskFilesService.getInstance();
    const withShebangUri = shellUri('with-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [withShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const pyTask = tasks.find((t) => t.resourceUri?.fsPath === withShebangUri.fsPath);
    assert.ok(pyTask, 'Should find a task for with-shebang.py');
    // When the file has a shebang, useShebang takes priority over the configured interpreter
    assert.strictEqual(pyTask?.metadata?.interpreter, '', 'interpreter should be empty (direct execution)');
    assert.strictEqual(pyTask?.metadata?.useShebang, true, 'useShebang should be true');
  });

  // ── Bash: useShebang ─────────────────────────────────────────────────────

  test('bash files without a shebang are included (no requireShebang)', async () => {
    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.sh');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.sh'))) {
        return [noShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const bashTask = tasks.find((t) => t.resourceUri?.fsPath === noShebangUri.fsPath);
    assert.ok(bashTask, 'Should find a task for no-shebang.sh');
    assert.strictEqual(bashTask?.metadata?.interpreter, 'bash', 'Should use default bash interpreter');
    assert.strictEqual(bashTask?.metadata?.useShebang, false, 'useShebang should be false');
  });

  test('bash files with a shebang are executed directly', async () => {
    const filesService = TaskFilesService.getInstance();
    const withShebangUri = shellUri('with-shebang.sh');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.sh'))) {
        return [withShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const bashTask = tasks.find((t) => t.resourceUri?.fsPath === withShebangUri.fsPath);
    assert.ok(bashTask, 'Should find a task for with-shebang.sh');
    assert.strictEqual(bashTask?.metadata?.interpreter, '', 'interpreter should be empty (direct execution)');
    assert.strictEqual(bashTask?.metadata?.useShebang, true, 'useShebang should be true');
  });

  // ── PowerShell: no useShebang ─────────────────────────────────────────────

  test('powershell files always use the configured interpreter (no shebang support)', async () => {
    const filesService = TaskFilesService.getInstance();
    const ps1Uri = shellUri('script.ps1');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.ps1'))) {
        return [ps1Uri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const ps1Task = tasks.find((t) => t.resourceUri?.fsPath === ps1Uri.fsPath);
    assert.ok(ps1Task, 'Should find a task for script.ps1');
    assert.strictEqual(ps1Task?.metadata?.interpreter, 'pwsh', 'Should use pwsh interpreter');
    assert.strictEqual(ps1Task?.metadata?.useShebang, false, 'useShebang should be false for PowerShell');
  });

  // ── Duplicate file prevention ─────────────────────────────────────────────

  test('duplicate files are not added twice even when matched by multiple patterns', async () => {
    const filesService = TaskFilesService.getInstance();
    // both 'bash' (.sh, .bash) and 'sh' (.sh) match .sh files
    const shUri = shellUri('no-shebang.sh');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.sh'))) {
        return [shUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const matching = tasks.filter((t) => t.resourceUri?.fsPath === shUri.fsPath);
    assert.strictEqual(matching.length, 1, 'Same file should only appear once in the task list');
  });

  // ── Disabled shell type ───────────────────────────────────────────────────

  test('disabled shell type produces no tasks', async () => {
    mockConfig.shellEnabledTaskTypes = { ...((mockConfig.shellEnabledTaskTypes as object) || {}), python: false };

    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [noShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const pyTask = tasks.find((t) => t.resourceUri?.fsPath === noShebangUri.fsPath);
    assert.ok(!pyTask, 'Should not produce a task for python when the python type is disabled');
  });

  // ── Phase 1: Parallel shebang reads ──────────────────────────────────────────

  test('shebang checks for multiple files are all performed and all tasks produced', async () => {
    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');
    const withShebangUri = shellUri('with-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [noShebangUri, withShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });

    let shebangCheckCount = 0;
    const originalCheck = (provider as any).checkForShebang.bind(provider);
    (provider as any).checkForShebang = async (uri: vscode.Uri) => {
      shebangCheckCount++;
      return originalCheck(uri);
    };

    const tasks = await provider.getTasks();

    assert.strictEqual(shebangCheckCount, 2, 'checkForShebang should be called once per python file');
    const pyTasks = tasks.filter((t) => t.resourceUri?.fsPath.endsWith('.py'));
    assert.strictEqual(pyTasks.length, 2, 'Both python files should produce tasks regardless of resolution order');
  });

  test('a failed shebang check does not abort the batch — remaining files still produce tasks', async () => {
    const filesService = TaskFilesService.getInstance();
    const goodUri = shellUri('no-shebang.py');
    const badUri = vscode.Uri.file('/nonexistent/path/bad.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [badUri, goodUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });

    const tasks = await provider.getTasks();

    // bad.py cannot be read but should not block good.py from producing a task
    const goodTask = tasks.find((t) => t.resourceUri?.fsPath === goodUri.fsPath);
    assert.ok(goodTask, 'Should produce a task for the readable file even when another file fails');
  });

  // ── Phase 1: Cross-type deduplication preserves deterministic order ────────

  test('cross-type deduplication assigns .sh file to bash (higher precedence than sh)', async () => {
    const filesService = TaskFilesService.getInstance();
    const shUri = shellUri('no-shebang.sh');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.sh'))) {
        return [shUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });
    const tasks = await provider.getTasks();

    const matching = tasks.filter((t) => t.resourceUri?.fsPath === shUri.fsPath);
    assert.strictEqual(matching.length, 1, 'Same file should only appear once even with parallel processing');
    assert.strictEqual(matching[0].metadata?.subType, 'bash', 'bash should win over sh (bash is first in BUILT_IN_SHELLS)');
  });
});
