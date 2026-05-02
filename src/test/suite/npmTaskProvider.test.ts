import * as assert from 'assert';
import * as vscode from 'vscode';
import { NpmTaskProvider, BunTaskProvider } from '../../providers/npmTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';

suite('NpmTaskProvider Test Suite', () => {
  let provider: NpmTaskProvider;
  let originalFetchTasks: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalShouldIgnore: any;

  const workspaceFolder: vscode.WorkspaceFolder = {
    uri: vscode.Uri.file('/workspace'),
    name: 'workspace',
    index: 0,
  };

  setup(() => {
    provider = new NpmTaskProvider();

    originalFetchTasks = vscode.tasks.fetchTasks;
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;

    const filesService = TaskFilesService.getInstance();
    originalShouldIgnore = filesService.shouldIgnore.bind(filesService);

    // Default: fetchTasks returns empty
    (vscode.tasks as any).fetchTasks = async () => [];

    // Default: openTextDocument returns empty package.json
    (vscode.workspace as any).openTextDocument = async (_uri: any) => ({
      getText: () => JSON.stringify({ name: 'test', scripts: { build: 'tsc' } }),
    });

    // Default: asRelativePath returns the fsPath
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };

    // Default: shouldIgnore returns false
    filesService.shouldIgnore = (_uri: vscode.Uri) => false;
  });

  teardown(() => {
    (vscode.tasks as any).fetchTasks = originalFetchTasks;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    const filesService = TaskFilesService.getInstance();
    filesService.shouldIgnore = originalShouldIgnore;
  });

  suite('getSystemTasks', () => {
    test('returns npm tasks from fetchTasks', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'build'), 'Should include the npm task');
    });

    test('returns empty array when no npm tasks are found', async () => {
      (vscode.tasks as any).fetchTasks = async () => [];

      const tasks = await provider.getSystemTasks();
      assert.strictEqual(tasks.length, 0, 'Should return empty array when no tasks found');
    });

    test('filters out tasks from files excluded by .tasksignore', async () => {
      const ignoredPackageJson = vscode.Uri.joinPath(workspaceFolder.uri, 'sample', 'package.json');
      const allowedPackageJson = vscode.Uri.joinPath(workspaceFolder.uri, 'package.json');

      const ignoredTask = {
        name: 'test - sample',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      const allowedTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [ignoredTask, allowedTask];

      const filesService = TaskFilesService.getInstance();
      filesService.shouldIgnore = (uri: vscode.Uri) => {
        return uri.fsPath === ignoredPackageJson.fsPath;
      };

      const tasks = await provider.getSystemTasks();
      assert.ok(!tasks.some(t => t.label === 'test'), 'Should NOT include task from ignored file');
      assert.ok(tasks.some(t => t.label === 'build'), 'Should include task from allowed file');
    });

    test('filters out all tasks when entire directory is in .tasksignore', async () => {
      const sampleTask1 = {
        name: 'build - sample/app1',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      const sampleTask2 = {
        name: 'test - sample/app2',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [sampleTask1, sampleTask2];

      const filesService = TaskFilesService.getInstance();
      filesService.shouldIgnore = (uri: vscode.Uri) => {
        return uri.fsPath.includes('/workspace/sample/') || uri.fsPath.includes('\\workspace\\sample\\') || uri.fsPath.includes('\\sample\\');
      };

      const tasks = await provider.getSystemTasks();
      assert.strictEqual(tasks.length, 0, 'Should return no tasks when all task files are ignored');
    });

    test('handles fetchTasks error gracefully', async () => {
      (vscode.tasks as any).fetchTasks = async () => { throw new Error('fetchTasks failed'); };

      const tasks = await provider.getSystemTasks();
      assert.deepStrictEqual(tasks, [], 'Should return empty array on fetchTasks error');
    });

    test('task file URI for subdirectory task points to correct package.json', async () => {
      const mockTask = {
        name: 'start - apps/frontend',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'start');
      assert.ok(task, 'Should find the task');
      const expectedPath = vscode.Uri.joinPath(workspaceFolder.uri, 'apps/frontend', 'package.json').fsPath;
      assert.strictEqual(task!.taskFileUri?.fsPath, expectedPath, 'taskFileUri should point to the correct package.json');
    });

    // ──────────────────────────────────────────────────────────────
    // N01-N03: startLine sentinel fix — await parseContent so that
    // json is the actual parsed object, not a Promise, enabling
    // correct line-number detection for CodeLens.
    // ──────────────────────────────────────────────────────────────

    test('N01 - Npm task has startLine set when script is found in package.json', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => JSON.stringify({ scripts: { build: 'tsc' } }),
      });

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'build');
      assert.ok(task, 'Should find task');
      assert.notStrictEqual(task!.startLine, undefined, 'startLine should be set when script found in package.json');
    });

    test('N02 - Npm task has undefined startLine when package.json content cannot be fetched', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => { throw new Error('no file'); };

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'build');
      assert.ok(task, 'Should still create a task item even if file read fails');
      assert.strictEqual(task!.startLine, undefined, 'startLine should be undefined when file cannot be read');
    });

    test('N03 - Npm task has undefined startLine when script not in package.json scripts block', async () => {
      const mockTask = {
        name: 'lint',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'npm' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => JSON.stringify({ scripts: { build: 'tsc' } }),
      });

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'lint');
      assert.ok(task, 'Should create task item even when script is not in JSON scripts');
      assert.strictEqual(task!.startLine, undefined, 'startLine should be undefined when script not found in scripts block');
    });
  });
});

suite('BunTaskProvider Test Suite', () => {
  let provider: BunTaskProvider;
  let originalFetchTasks: any;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalShouldIgnore: any;

  const workspaceFolder: vscode.WorkspaceFolder = {
    uri: vscode.Uri.file('/workspace'),
    name: 'workspace',
    index: 0,
  };

  setup(() => {
    provider = new BunTaskProvider();
    Object.defineProperty(provider, 'enabled', { value: true, configurable: true });

    originalFetchTasks = vscode.tasks.fetchTasks;
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;

    const filesService = TaskFilesService.getInstance();
    originalShouldIgnore = filesService.shouldIgnore.bind(filesService);

    // Default: fetchTasks returns empty
    (vscode.tasks as any).fetchTasks = async () => [];

    // Default: openTextDocument returns empty package.json
    (vscode.workspace as any).openTextDocument = async (_uri: any) => ({
      getText: () => JSON.stringify({ name: 'test', scripts: { build: 'bun build' } }),
    });

    // Default: asRelativePath returns the fsPath
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };

    // Default: shouldIgnore returns false
    filesService.shouldIgnore = (_uri: vscode.Uri) => false;
  });

  teardown(() => {
    (vscode.tasks as any).fetchTasks = originalFetchTasks;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    const filesService = TaskFilesService.getInstance();
    filesService.shouldIgnore = originalShouldIgnore;
  });

  suite('getSystemTasks', () => {
    test('returns bun tasks from fetchTasks', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'build'), 'Should include the bun task');
    });

    test('filters out tasks from files excluded by .tasksignore', async () => {
      const ignoredPackageJson = vscode.Uri.joinPath(workspaceFolder.uri, 'sample', 'package.json');

      const ignoredTask = {
        name: 'test - sample',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      const allowedTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [ignoredTask, allowedTask];

      const filesService = TaskFilesService.getInstance();
      filesService.shouldIgnore = (uri: vscode.Uri) => {
        return uri.fsPath === ignoredPackageJson.fsPath;
      };

      const tasks = await provider.getSystemTasks();
      assert.ok(!tasks.some(t => t.label === 'test'), 'Should NOT include task from ignored file');
      assert.ok(tasks.some(t => t.label === 'build'), 'Should include task from allowed file');
    });

    test('handles fetchTasks error gracefully', async () => {
      (vscode.tasks as any).fetchTasks = async () => { throw new Error('fetchTasks failed'); };

      const tasks = await provider.getSystemTasks();
      assert.deepStrictEqual(tasks, [], 'Should return empty array on fetchTasks error');
    });

    // ──────────────────────────────────────────────────────────────
    // N01-N03: startLine sentinel fix — undefined instead of 0
    // ──────────────────────────────────────────────────────────────

    test('N01 - Bun task has startLine set when script is found in package.json', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => JSON.stringify({ scripts: { build: 'bun build' } }),
      });

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'build');
      assert.ok(task, 'Should find task');
      assert.notStrictEqual(task!.startLine, undefined, 'startLine should be set when script found');
    });

    test('N02 - Bun task has undefined startLine when package.json content cannot be fetched', async () => {
      const mockTask = {
        name: 'build',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => { throw new Error('no file'); };

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'build');
      assert.ok(task, 'Should still create a task item even if file read fails');
      assert.strictEqual(task!.startLine, undefined, 'startLine should be undefined, not 0');
    });

    test('N03 - Bun task has undefined startLine when script not in package.json scripts block', async () => {
      const mockTask = {
        name: 'lint',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'bun' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async () => ({
        getText: () => JSON.stringify({ scripts: { build: 'bun build' } }),
      });

      const tasks = await provider.getSystemTasks();
      const task = tasks.find(t => t.label === 'lint');
      assert.ok(task, 'Should create task item even when script is not in JSON scripts');
      assert.strictEqual(task!.startLine, undefined, 'startLine should be undefined (not 0) when script not found in file');
    });
  });
});
