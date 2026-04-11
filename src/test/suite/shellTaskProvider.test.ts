import * as assert from 'assert';
import * as fs from 'fs';
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

  // ── getFilePatterns — Fix 7 individual pattern registration ──────────────

  test('getFilePatterns includes individual per-extension patterns for all built-in shell types', () => {
    const provider = new ShellTaskProvider();
    const patterns = provider.getFilePatterns();
    const expectedIndividual = [
      '**/*.sh', '**/*.bash', '**/*.zsh', '**/*.fish',
      '**/*.ps1', '**/*.bat', '**/*.cmd',
      '**/*.py', '**/*.pl', '**/*.rb', '**/*.nu',
    ];
    for (const expected of expectedIndividual) {
      assert.ok(patterns.includes(expected), `Expected getFilePatterns() to contain '${expected}'`);
    }
  });

  test('getFilePatterns contains no duplicate patterns', () => {
    const provider = new ShellTaskProvider();
    const patterns = provider.getFilePatterns();
    const seen = new Set<string>();
    for (const p of patterns) {
      assert.ok(!seen.has(p), `Duplicate pattern found in getFilePatterns(): '${p}'`);
      seen.add(p);
    }
  });

  test('getFilePatterns includes combined brace-glob as first entry', () => {
    const provider = new ShellTaskProvider();
    const patterns = provider.getFilePatterns();
    assert.ok(patterns.length > 0, 'getFilePatterns() should return at least one pattern');
    assert.ok(patterns[0].startsWith('**/*.{'), `First pattern should be the combined brace-glob, got: '${patterns[0]}'`);
  });

  test('getFilePatterns includes additional extension patterns when other is enabled', () => {
    (mockConfig as any).shellEnabledTaskTypes = { ...((mockConfig as any).shellEnabledTaskTypes), other: true };
    (mockConfig as any).shellAdditionalExtensions = { '.lua': 'lua', 'groovy': 'groovy' };
    const provider = new ShellTaskProvider();
    const patterns = provider.getFilePatterns();
    assert.ok(patterns.includes('**/*.lua'), 'Expected additional extension **/*.lua');
    assert.ok(patterns.includes('**/*.groovy'), 'Expected additional extension **/*.groovy');
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

  // ── Phase 2: Shebang cache ────────────────────────────────────────────────

  test('shebang cache hit: fs.promises.open called only once per file on second getTasks()', async () => {
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

    let openCallCount = 0;
    const originalOpen = fs.promises.open.bind(fs.promises);
    (fs.promises as any).open = async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) === withShebangUri.fsPath) {
        openCallCount++;
      }
      return originalOpen(...args);
    };

    try {
      await provider.getTasks(); // first call — populates cache
      const afterFirst = openCallCount;
      await provider.getTasks(); // second call — should hit cache, no extra open
      assert.strictEqual(openCallCount, afterFirst, 'fs.promises.open should not be called again when mtime is unchanged');
    } finally {
      (fs.promises as any).open = originalOpen;
    }
  });

  test('shebang cache is invalidated when file mtime changes', async () => {
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

    let statCallIndex = 0;
    let openCallCount = 0;
    const originalStat = fs.promises.stat.bind(fs.promises);
    const originalOpen = fs.promises.open.bind(fs.promises);

    (fs.promises as any).stat = async (filePath: string) => {
      const realStat = await originalStat(filePath);
      if (filePath === withShebangUri.fsPath) {
        statCallIndex++;
        // Return a different (incrementing) mtime each time to simulate modification
        return { ...realStat, mtimeMs: statCallIndex * 10000 };
      }
      return realStat;
    };
    (fs.promises as any).open = async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) === withShebangUri.fsPath) {
        openCallCount++;
      }
      return originalOpen(...args);
    };

    try {
      await provider.getTasks(); // first call — reads file, caches with mtime=10000
      const afterFirst = openCallCount;
      await provider.getTasks(); // second call — mtime differs (20000), cache miss
      assert.ok(openCallCount > afterFirst, 'fs.promises.open should be called again after mtime change');
    } finally {
      (fs.promises as any).stat = originalStat;
      (fs.promises as any).open = originalOpen;
    }
  });

  test('clearShebangCache() forces re-read on next getTasks()', async () => {
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

    let openCallCount = 0;
    const originalOpen = fs.promises.open.bind(fs.promises);
    (fs.promises as any).open = async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) === withShebangUri.fsPath) {
        openCallCount++;
      }
      return originalOpen(...args);
    };

    try {
      await provider.getTasks(); // first call — populates cache
      const afterFirst = openCallCount;
      provider.clearShebangCache(); // evict cache
      await provider.getTasks(); // second call — cache cleared, must re-read
      assert.ok(openCallCount > afterFirst, 'fs.promises.open should be called again after clearShebangCache()');
    } finally {
      (fs.promises as any).open = originalOpen;
    }
  });

  test('cross-type shebang cache sharing: sh hits cache populated by bash', async () => {
    const filesService = TaskFilesService.getInstance();
    const shUri = shellUri('with-shebang.sh');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.sh'))) {
        return [shUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });

    let openCallCount = 0;
    const originalOpen = fs.promises.open.bind(fs.promises);
    (fs.promises as any).open = async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) === shUri.fsPath) {
        openCallCount++;
      }
      return originalOpen(...args);
    };

    try {
      await provider.getTasks();
      // bash and sh both match *.sh; due to cache sharing the file should only need
      // one real read total — the second type hits the cache populated by the first
      assert.strictEqual(openCallCount, 1, 'The .sh file should only be opened once across all shell types (bash+sh share the cache)');
    } finally {
      (fs.promises as any).open = originalOpen;
    }
  });

  // ── Phase 2: Suppress 'other' log when shellAdditionalExtensions is empty ─

  test('other type info log is suppressed when shellAdditionalExtensions is empty', async () => {
    mockConfig.shellEnabledTaskTypes = {
      ...((mockConfig.shellEnabledTaskTypes as object) || {}),
      other: true,
    };
    mockConfig.shellAdditionalExtensions = {};

    const provider = new ShellTaskProvider();
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });

    const infoMessages: string[] = [];
    const logger = (provider as any).logger;
    const originalInfo = logger.info.bind(logger);
    logger.info = (msg: string, ...args: unknown[]) => {
      infoMessages.push(msg);
      originalInfo(msg, ...args);
    };

    await provider.getTasks();

    logger.info = originalInfo;

    const otherLog = infoMessages.find((m) => m.includes('[ShellTaskProvider] other:'));
    assert.ok(!otherLog, 'Should not produce an info log for "other" when shellAdditionalExtensions is empty');
  });

  // ── _processShellType: named method coverage ──────────────────────────────

  test('_processShellType returns empty batch for disabled type', async () => {
    const filesService = TaskFilesService.getInstance();
    const provider = new ShellTaskProvider();

    const pythonDef = { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python3', useShebang: true };
    const result = await (provider as any)._processShellType(
      'python',
      pythonDef,
      filesService,
      { python: false },
      {},
    );

    assert.strictEqual(result.type, 'python');
    assert.deepStrictEqual(result.items, []);
    assert.strictEqual(result.fileCount, 0);
  });

  test('_processShellType returns tasks for enabled type with files', async () => {
    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');

    filesService.findFiles = async (patterns: string[]) => {
      if (patterns.some((p) => p.includes('.py'))) {
        return [noShebangUri];
      }
      return [];
    };

    const provider = new ShellTaskProvider();
    const pythonDef = { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python3', useShebang: true };
    const result = await (provider as any)._processShellType(
      'python',
      pythonDef,
      filesService,
      { python: true },
      {},
    );

    assert.strictEqual(result.type, 'python');
    assert.strictEqual(result.fileCount, 1);
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.interpreter, 'python3');
  });

  test('_processShellType uses shellPaths interpreter override', async () => {
    const filesService = TaskFilesService.getInstance();
    const noShebangUri = shellUri('no-shebang.py');

    filesService.findFiles = async () => [noShebangUri];

    const provider = new ShellTaskProvider();
    const pythonDef = { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python3', useShebang: false };
    const result = await (provider as any)._processShellType(
      'python',
      pythonDef,
      filesService,
      { python: true },
      { python: '/usr/bin/python3.11' },
    );

    assert.strictEqual(result.interpreter, '/usr/bin/python3.11');
  });

  test('_processShellType tracks shebang reads vs cache hits', async () => {
    const filesService = TaskFilesService.getInstance();
    const withShebangUri = shellUri('with-shebang.py');

    filesService.findFiles = async () => [withShebangUri];

    const provider = new ShellTaskProvider();
    const pythonDef = { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python3', useShebang: true };

    const first = await (provider as any)._processShellType('python', pythonDef, filesService, { python: true }, {});
    assert.strictEqual(first.shebangReads, 1, 'First call should read the file');
    assert.strictEqual(first.cacheHits, 0, 'First call should have no cache hits');

    const second = await (provider as any)._processShellType('python', pythonDef, filesService, { python: true }, {});
    assert.strictEqual(second.shebangReads, 0, 'Second call should use cache (no reads)');
    assert.strictEqual(second.cacheHits, 1, 'Second call should hit cache');
  });

  test('_processShellType skips shebang check for type with neither requireShebang nor useShebang', async () => {
    const filesService = TaskFilesService.getInstance();
    const ps1Uri = shellUri('script.ps1');

    filesService.findFiles = async () => [ps1Uri];

    const provider = new ShellTaskProvider();
    const pwshDef = { extensions: ['ps1'], configKey: 'pwsh', defaultInterpreter: 'pwsh', requireShebang: false, useShebang: false };

    const result = await (provider as any)._processShellType('pwsh', pwshDef, filesService, { pwsh: true }, {});
    // shebangReads must be 0: skipping the shebang check should not count as a file read
    assert.strictEqual(result.shebangReads, 0, 'Should not count skipped shebang check as a read');
    assert.strictEqual(result.cacheHits, 0, 'Should not have any cache hits when shebang check is skipped');
    assert.strictEqual(result.items.length, 1, 'File should still be included even without shebang check');
    assert.strictEqual(result.items[0].hasShebang, false);
  });

  // ── checkForShebang: virtual filesystem path ──────────────────────────────
  // vscode.workspace.fs is sealed in the test environment; use Object.defineProperty
  // to replace the 'fs' property with a mock object (same pattern as ant.test.ts).

  test('checkForShebang returns hasShebang=true for virtual FS URI with shebang bytes', async () => {
    // Use a non-file:// URI so the virtual-FS branch is taken
    const virtualUri = vscode.Uri.parse('untitled:///test-shebang.py');
    const originalWsFs = vscode.workspace.fs;
    const mockFs: any = {
      ...originalWsFs,
      readFile: async (uri: vscode.Uri) => {
        if (uri.toString() === virtualUri.toString()) {
          return new Uint8Array([0x23, 0x21, 0x2f, 0x75, 0x73, 0x72]); // #! /usr
        }
        return originalWsFs.readFile(uri);
      },
    };
    Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

    try {
      const provider = new ShellTaskProvider();
      const result = await (provider as any).checkForShebang(virtualUri);
      assert.strictEqual(result.hasShebang, true, 'Should detect shebang in virtual FS file');
      assert.strictEqual(result.fromCache, false, 'Virtual FS results are never cached');
    } finally {
      Object.defineProperty(vscode.workspace, 'fs', { value: originalWsFs, writable: true, configurable: true });
    }
  });

  test('checkForShebang returns hasShebang=false for virtual FS URI without shebang', async () => {
    const virtualUri = vscode.Uri.parse('untitled:///test-no-shebang.py');
    const originalWsFs = vscode.workspace.fs;
    const mockFs: any = {
      ...originalWsFs,
      readFile: async (uri: vscode.Uri) => {
        if (uri.toString() === virtualUri.toString()) {
          return new Uint8Array([0x70, 0x72, 0x69, 0x6e]); // "prin" (no shebang)
        }
        return originalWsFs.readFile(uri);
      },
    };
    Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

    try {
      const provider = new ShellTaskProvider();
      const result = await (provider as any).checkForShebang(virtualUri);
      assert.strictEqual(result.hasShebang, false, 'Should return false when virtual FS file has no shebang');
      assert.strictEqual(result.fromCache, false);
    } finally {
      Object.defineProperty(vscode.workspace, 'fs', { value: originalWsFs, writable: true, configurable: true });
    }
  });

  test('checkForShebang returns hasShebang=false for virtual FS URI with fewer than 2 bytes', async () => {
    const virtualUri = vscode.Uri.parse('untitled:///test-tiny.py');
    const originalWsFs = vscode.workspace.fs;
    const mockFs: any = {
      ...originalWsFs,
      readFile: async (uri: vscode.Uri) => {
        if (uri.toString() === virtualUri.toString()) {
          return new Uint8Array([0x23]); // only 1 byte
        }
        return originalWsFs.readFile(uri);
      },
    };
    Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

    try {
      const provider = new ShellTaskProvider();
      const result = await (provider as any).checkForShebang(virtualUri);
      assert.strictEqual(result.hasShebang, false, 'Should return false for virtual FS file with fewer than 2 bytes');
      assert.strictEqual(result.fromCache, false);
    } finally {
      Object.defineProperty(vscode.workspace, 'fs', { value: originalWsFs, writable: true, configurable: true });
    }
  });
});
