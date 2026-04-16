import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { VscodeTaskProvider } from '../../providers/vscodeTaskProvider';

const getUserTasksPath = () => '/dummy/path';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskIconService } from '../../services/taskIconService';
import { FilteredTaskService } from '../../services/filteredTaskService';

suite('VscodeTaskProvider Test Suite', () => {
  let provider: VscodeTaskProvider;
  let originalFetchTasks: any;
  let originalFindFiles: any;
  let originalFsDescriptor: PropertyDescriptor | undefined;
  let originalOpenTextDocument: any;
  let originalAsRelativePath: any;
  let originalWorkspaceFolders: PropertyDescriptor | undefined;
  let originalTaskFilesFindFiles: any;

  const userTasksJson = JSON.stringify({
    version: '2.0.0',
    tasks: [
      { label: 'User Task One', type: 'shell', command: 'echo user1' },
      { label: 'User Task Two', type: 'shell', command: 'echo user2' },
    ],
  });

  const workspaceTasksJson = JSON.stringify({
    version: '2.0.0',
    tasks: [
      { label: 'Workspace Task One', type: 'shell', command: 'echo ws1' },
    ],
  });

  setup(() => {
    provider = new VscodeTaskProvider();

    // Ensure the provider is treated as enabled regardless of workspace settings.
    // The 'vscode' task type may be disabled in .vscode/settings.json, which would
    // cause every test that relies on getTasks/getSystemTasks to return an empty array.
    // Individual tests that verify disabled-state behaviour override this per-test.
    Object.defineProperty(provider, 'enabled', { get: () => true, configurable: true });

    originalFetchTasks = vscode.tasks.fetchTasks;
    originalFindFiles = vscode.workspace.findFiles;
    originalFsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'fs');
    originalOpenTextDocument = vscode.workspace.openTextDocument;
    originalAsRelativePath = vscode.workspace.asRelativePath;
    originalWorkspaceFolders = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');

    const taskFilesService = TaskFilesService.getInstance();
    originalTaskFilesFindFiles = taskFilesService.findFiles;

    // Default: no workspace tasks files
    taskFilesService.findFiles = async () => [];

    // Default: no workspace folders
    try {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    } catch { /* ignore if read-only in test env */ }

    // Default: fetchTasks returns empty
    (vscode.tasks as any).fetchTasks = async () => [];

    // Default: openTextDocument returns empty content
    (vscode.workspace as any).openTextDocument = async (_uri: any) => ({
      getText: () => '',
    });

    // Default: asRelativePath returns the fsPath
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri | string) => {
      if (typeof uri === 'string') { return uri; }
      return uri.fsPath;
    };

    // Default: fs.stat throws (file not found)
    const mockFs = {
      ...vscode.workspace.fs,
      stat: async (_uri: vscode.Uri) => { throw new Error('File not found'); },
      readFile: async (_uri: vscode.Uri) => new Uint8Array(),
    };
    Object.defineProperty(vscode.workspace, 'fs', {
      value: mockFs,
      writable: true,
      configurable: true,
    });
  });

  teardown(() => {
    (vscode.tasks as any).fetchTasks = originalFetchTasks;
    vscode.workspace.findFiles = originalFindFiles;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;

    if (originalFsDescriptor) {
      Object.defineProperty(vscode.workspace, 'fs', originalFsDescriptor);
    }
    if (originalWorkspaceFolders) {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', originalWorkspaceFolders);
    }

    const taskFilesService = TaskFilesService.getInstance();
    taskFilesService.findFiles = originalTaskFilesFindFiles;
  });

  // ─── getSystemTasks ─────────────────────────────────────────────────────────

  suite('getSystemTasks', () => {
    test('returns empty array when disabled', async () => {
      // Disable by stubbing enabled getter
      Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
      const tasks = await provider.getSystemTasks();
      assert.strictEqual(tasks.length, 0);
    });

    test('includes tasks with source Workspace', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const mockTask = {
        name: 'Workspace Task One',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'Workspace Task One'), 'Should include workspace task');
    });

    test('includes tasks with source User (user-level tasks.json)', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'User Task One'), 'User tasks should be included via the system API');
    });

    test('user-level system tasks have taskOrigin set to "user"', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user-level system task');
      assert.strictEqual(userTask!.taskOrigin, 'user', 'taskOrigin should be "user" for user-level system tasks');
    });

    test('user-level system tasks have undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
      assert.strictEqual(userTask!.description, 'User Tasks');
    });

    test('system tasks have item.task set to the native vscode.Task instance', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const mockTask = {
        name: 'Workspace Task One',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getSystemTasks();
      const wsTask = tasks.find(t => t.label === 'Workspace Task One');
      assert.ok(wsTask, 'Should find workspace task');
      assert.strictEqual(wsTask!.task, mockTask, 'item.task should be the native vscode.Task');
    });

    test('does NOT include tasks with source other than Workspace', async () => {
      const mockTask = {
        name: 'Extension Task',
        source: 'SomeExtension',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];

      const tasks = await provider.getSystemTasks();
      assert.strictEqual(tasks.length, 0, 'Should not include tasks from other sources');
    });

    test('workspace task fileUri points to workspace .vscode/tasks.json', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const mockTask = {
        name: 'Workspace Task One',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getSystemTasks();
      const wsTask = tasks.find(t => t.label === 'Workspace Task One');
      assert.ok(wsTask, 'Should find workspace task');
      const expectedPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json').fsPath;
      assert.strictEqual(wsTask!.taskFileUri?.fsPath, expectedPath, 'Workspace task should point to .vscode/tasks.json');
    });

    test('handles missing workspace tasks.json gracefully (does not throw)', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const mockTask = {
        name: 'Workspace Task One',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      // openTextDocument throws to simulate file not found
      (vscode.workspace as any).openTextDocument = async (_uri: any) => {
        throw new Error('File not found');
      };

      const tasks = await provider.getSystemTasks();
      const wsTask = tasks.find(t => t.label === 'Workspace Task One');
      assert.ok(wsTask, 'Should still create task item even when file cannot be opened');
      assert.strictEqual(wsTask!.startLine, undefined, 'startLine should be undefined when file is missing');
    });

    test('compound tasks include dependsOn tasks as children', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };

      const compound = {
        name: 'Build All',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      const lint = {
        name: 'Lint',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      const compile = {
        name: 'Compile',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [compound, lint, compile];
      const compoundJson = JSON.stringify({
        version: '2.0.0',
        tasks: [
          { label: 'Build All', dependsOn: ['Lint', 'Compile'] },
          { label: 'Lint', type: 'shell', command: 'npm run lint' },
          { label: 'Compile', type: 'shell', command: 'npm run compile' },
        ],
      });
      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => compoundJson });

      const tasks = await provider.getSystemTasks();
      const compoundItem = tasks.find(t => t.label === 'Build All');
      assert.ok(compoundItem, 'Should find compound task');
      assert.ok(compoundItem!.children.length >= 2, 'Compound task should have dependency children');

      const childLabels = new Set(compoundItem!.children.map(c => c.label));
      assert.strictEqual(childLabels.has('Lint'), true);
      assert.strictEqual(childLabels.has('Compile'), true);
    });

    // Real-world: VSCode returns user profile tasks with source='Workspace' and a numeric scope.
    // TaskScope.Global=1 and TaskScope.Workspace=2 are both numeric — neither is a WorkspaceFolder object.
    test('includes user profile tasks when source is Workspace but scope is TaskScope.Global (numeric)', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'User Task One'), 'Should include user task with numeric scope Global');
    });

    test('includes user profile tasks when source is Workspace but scope is TaskScope.Workspace (numeric)', async () => {
      // In real VSCode, user profile tasks may have scope=TaskScope.Workspace (=2) not Global (=1)
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      assert.ok(tasks.some(t => t.label === 'User Task One'), 'Should include user task with numeric scope Workspace');
    });

    test('user profile task with numeric scope has taskOrigin set to "user"', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user task');
      assert.strictEqual(userTask!.taskOrigin, 'user', 'taskOrigin should be "user" when scope is numeric (not a WorkspaceFolder)');
    });

    test('user profile task with scope TaskScope.Workspace (numeric) has taskOrigin set to "user"', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user task');
      assert.strictEqual(userTask!.taskOrigin, 'user', 'taskOrigin should be "user" when scope is TaskScope.Workspace (numeric)');
    });

    test('user profile task with scope Global has undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
    });
  });

  // ─── getTasks ───────────────────────────────────────────────────────────────

  suite('getTasks', () => {
    test('returns empty array when disabled', async () => {
      Object.defineProperty(provider, 'enabled', { get: () => false, configurable: true });
      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 0);
    });

    test('includes tasks from workspace .vscode/tasks.json', async () => {
      const workspaceTasksFile = vscode.Uri.file('/workspace/.vscode/tasks.json');
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [workspaceTasksFile];

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getTasks();
      assert.ok(tasks.some(t => t.label === 'Workspace Task One'), 'Should include workspace task from file');
    });

    test('does not show user tasks when user tasks.json does not exist', async () => {
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      // fs.stat always throws (file not found)
      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (_uri: vscode.Uri) => { throw new Error('File not found'); },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      const tasks = await provider.getTasks();
      assert.strictEqual(tasks.length, 0, 'Should return no tasks when no files exist');
    });

    test('workspace tasks do NOT have taskOrigin set to "user"', async () => {
      const workspaceTasksFile = vscode.Uri.file('/workspace/.vscode/tasks.json');
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [workspaceTasksFile];

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getTasks();
      const wsTask = tasks.find(t => t.label === 'Workspace Task One');
      assert.ok(wsTask, 'Should find workspace task');
      assert.notStrictEqual(wsTask!.taskOrigin, 'user', 'taskOrigin should NOT be "user" for workspace tasks');
    });

    // Regression: user profile tasks must not appear twice when VSCode returns them with
    // source='Workspace' and scope=TaskScope.Global (the real-world behavior).
    test('does not duplicate user tasks when system tasks return them with source Workspace and scope Global', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1);
    });

    // Regression: real VSCode may also use scope=TaskScope.Workspace (=2) for user profile tasks
    test('does not duplicate user tasks when system tasks return them with source Workspace and scope TaskScope.Workspace', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'Workspace',
        scope: vscode.TaskScope.Workspace,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // ensure workspace finds none so we only get the system one
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const tasks = await provider.getTasks();
      const userTasks = tasks.filter(t => t.label === 'User Task One');
      assert.strictEqual(userTasks.length, 1);
    });

    test('user task from system API has undefined fileUri', async () => {
      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;
      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // Workspace find returns nothing
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask);
      assert.strictEqual(userTask!.taskFileUri, undefined);
    });
  });

  // ─── Fix 5: parallel openTextDocument + pre-built line index ────────────────

  suite('Fix 5 — parallel file open and line-number pre-indexing', () => {
    test('openTextDocument is called at most once per unique file URI per getSystemTasks() run', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const tasksJson = JSON.stringify({
        version: '2.0.0',
        tasks: [
          { label: 'Task A', type: 'shell', command: 'echo a' },
          { label: 'Task B', type: 'shell', command: 'echo b' },
          { label: 'Task C', type: 'shell', command: 'echo c' },
        ],
      });

      // Three tasks all from the same file
      const makeTask = (name: string) => ({
        name,
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      }) as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [makeTask('Task A'), makeTask('Task B'), makeTask('Task C')];

      let openCallCount = 0;
      (vscode.workspace as any).openTextDocument = async (_uri: any) => {
        openCallCount++;
        return { getText: () => tasksJson };
      };

      const tasks = await provider.getSystemTasks();
      assert.strictEqual(openCallCount, 1, 'openTextDocument should be called exactly once for the shared file');
      assert.strictEqual(tasks.length, 3);
    });

    test('openTextDocument calls for different files are issued concurrently (Promise.all)', async () => {
      const folderA: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/workspace/a'), name: 'a', index: 0 };
      const folderB: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/workspace/b'), name: 'b', index: 1 };

      const makeTask = (name: string, folder: vscode.WorkspaceFolder) => ({
        name,
        source: 'Workspace',
        scope: folder,
        definition: { type: 'shell' },
      }) as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [makeTask('Task A', folderA), makeTask('Task B', folderB)];

      const openOrder: string[] = [];
      const pendingResolvers: Array<() => void> = [];

      (vscode.workspace as any).openTextDocument = async (uri: vscode.Uri) => {
        openOrder.push(uri.fsPath);
        // Simulate async delay — each call suspends until all are in-flight
        await new Promise<void>((resolve) => pendingResolvers.push(resolve));
        return { getText: () => '{}' };
      };

      // Start getSystemTasks() — with Promise.all it fires both opens before awaiting either
      const getTasksPromise = provider.getSystemTasks();

      // Allow microtasks to run so both openTextDocument calls are initiated
      await new Promise((resolve) => setImmediate(resolve));

      // Both opens must have been started before either resolves
      assert.strictEqual(openOrder.length, 2, 'Both openTextDocument calls should be in-flight simultaneously');

      // Unblock both pending resolvers
      for (const r of pendingResolvers) { r(); }
      await getTasksPromise;
    });

    test('line numbers are correctly resolved when multiple tasks share one file', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const tasksJson = [
        '{',
        '  "version": "2.0.0",',
        '  "tasks": [',
        '    { "label": "Alpha", "type": "shell", "command": "echo alpha" },',
        '    { "label": "Beta",  "type": "shell", "command": "echo beta"  },',
        '    { "label": "Gamma", "type": "shell", "command": "echo gamma" }',
        '  ]',
        '}',
      ].join('\n');

      const makeTask = (name: string) => ({
        name,
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      }) as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [makeTask('Alpha'), makeTask('Beta'), makeTask('Gamma')];
      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => tasksJson });

      const tasks = await provider.getSystemTasks();
      const alpha = tasks.find(t => t.label === 'Alpha');
      const beta  = tasks.find(t => t.label === 'Beta');
      const gamma = tasks.find(t => t.label === 'Gamma');

      assert.ok(alpha, 'Alpha should be found');
      assert.ok(beta,  'Beta should be found');
      assert.ok(gamma, 'Gamma should be found');
      // Line 3 = index 3 (0-based): '    { "label": "Alpha", ... }'
      assert.strictEqual(alpha!.startLine, 3, 'Alpha should be on line 3');
      assert.strictEqual(beta!.startLine,  4, 'Beta should be on line 4');
      assert.strictEqual(gamma!.startLine, 5, 'Gamma should be on line 5');
    });

    test('startLine is undefined when file cannot be opened', async () => {
      const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file('/workspace'),
        name: 'workspace',
        index: 0,
      };
      const mockTask = {
        name: 'Missing Task',
        source: 'Workspace',
        scope: workspaceFolder,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockTask];
      (vscode.workspace as any).openTextDocument = async (_uri: any) => { throw new Error('ENOENT'); };

      const tasks = await provider.getSystemTasks();
      const item = tasks.find(t => t.label === 'Missing Task');
      assert.ok(item, 'Task item should still be created when file open fails');
      assert.strictEqual(item!.startLine, undefined, 'startLine should be undefined when file is missing');
    });
  });
});
