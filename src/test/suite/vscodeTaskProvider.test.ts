import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { getUserTasksPath, VscodeTaskProvider } from '../../providers/vscodeTaskProvider';
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

  // ─── getUserTasksPath ───────────────────────────────────────────────────────

  suite('getUserTasksPath', () => {
    let originalPlatform: PropertyDescriptor | undefined;
    let originalAppData: string | undefined;

    setup(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      originalAppData = process.env.APPDATA;
    });

    teardown(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
      if (originalAppData !== undefined) {
        process.env.APPDATA = originalAppData;
      } else {
        delete process.env.APPDATA;
      }
    });

    test('returns Windows path using APPDATA env variable', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      const result = getUserTasksPath();
      assert.strictEqual(result, path.join('C:\\Users\\TestUser\\AppData\\Roaming', 'Code', 'User', 'tasks.json'));
    });

    test('returns Windows path using homedir fallback when APPDATA is not set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      delete process.env.APPDATA;
      const result = getUserTasksPath();
      const expected = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'tasks.json');
      assert.strictEqual(result, expected);
    });

    test('returns macOS path', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      const result = getUserTasksPath();
      const expected = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'tasks.json');
      assert.strictEqual(result, expected);
    });

    test('returns Linux path', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const result = getUserTasksPath();
      const expected = path.join(os.homedir(), '.config', 'Code', 'User', 'tasks.json');
      assert.strictEqual(result, expected);
    });
  });

  // ─── getUserTasksUri ────────────────────────────────────────────────────────

  suite('getUserTasksUri', () => {
    test('returns undefined when user tasks.json does not exist', async () => {
      const result = await provider.getUserTasksUri();
      assert.strictEqual(result, undefined);
    });

    test('returns a Uri when user tasks.json exists', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      const result = await provider.getUserTasksUri();
      assert.ok(result, 'Should return a Uri');
      assert.strictEqual(result!.fsPath, userTasksUri.fsPath);
    });
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

    test('user-level system tasks have taskSource set to "user"', async () => {
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
      assert.strictEqual(userTask!.taskSource, 'user', 'taskSource should be "user" for user-level system tasks');
    });

    test('user-level system tasks point to the user tasks.json path', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];

      // fs.stat succeeds for user tasks.json
      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user-level system task');
      assert.strictEqual(
        userTask!.taskFileUri?.fsPath,
        userTasksUri.fsPath,
        'taskFileUri should point to user tasks.json',
      );
    });

    test('user-level system task falls back to getUserTasksPath when user tasks.json not found on disk', async () => {
      const userTasksPath = getUserTasksPath();

      const mockUserTask = {
        name: 'User Task One',
        source: 'User',
        scope: vscode.TaskScope.Global,
        definition: { type: 'shell' },
      } as unknown as vscode.Task;

      (vscode.tasks as any).fetchTasks = async () => [mockUserTask];
      // fs.stat always throws (file not on disk)

      const tasks = await provider.getSystemTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should include user-level task even when file not found on disk');
      assert.strictEqual(
        userTask!.taskFileUri?.fsPath,
        vscode.Uri.file(userTasksPath).fsPath,
        'Should fall back to computed user tasks path',
      );
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

    test('includes user tasks when user tasks.json exists and no .vscode/tasks.json', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      // Workspace find returns nothing (no .vscode/tasks.json)
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      // fs.stat succeeds for user tasks
      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => userTasksJson });

      const tasks = await provider.getTasks();
      assert.ok(tasks.some(t => t.label === 'User Task One'), 'Should include User Task One');
      assert.ok(tasks.some(t => t.label === 'User Task Two'), 'Should include User Task Two');
    });

    test('user tasks taskFileUri points to user tasks.json', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => userTasksJson });

      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user task');
      assert.strictEqual(
        userTask!.taskFileUri?.fsPath,
        userTasksUri.fsPath,
        'taskFileUri should point to user tasks.json',
      );
    });

    test('does not duplicate user tasks when user tasks.json is already in workspace files', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      // Workspace search also finds the user tasks file (edge case)
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [userTasksUri];

      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => userTasksJson });

      const tasks = await provider.getTasks();
      const userTaskOneCount = tasks.filter(t => t.label === 'User Task One').length;
      assert.strictEqual(userTaskOneCount, 1, 'User Task One should appear exactly once');
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

    test('user tasks have taskSource set to "user"', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => userTasksJson });

      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user task');
      assert.strictEqual(userTask!.taskSource, 'user', 'taskSource should be "user" for user tasks');
    });

    test('workspace tasks do NOT have taskSource set to "user"', async () => {
      const workspaceTasksFile = vscode.Uri.file('/workspace/.vscode/tasks.json');
      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [workspaceTasksFile];

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => workspaceTasksJson });

      const tasks = await provider.getTasks();
      const wsTask = tasks.find(t => t.label === 'Workspace Task One');
      assert.ok(wsTask, 'Should find workspace task');
      assert.notStrictEqual(wsTask!.taskSource, 'user', 'taskSource should NOT be "user" for workspace tasks');
    });

    test('user task onOpenActionCommand references user tasks.json', async () => {
      const userTasksPath = getUserTasksPath();
      const userTasksUri = vscode.Uri.file(userTasksPath);

      const taskFilesService = TaskFilesService.getInstance();
      taskFilesService.findFiles = async () => [];

      const mockFs = {
        ...vscode.workspace.fs,
        stat: async (uri: vscode.Uri) => {
          if (uri.fsPath === userTasksUri.fsPath) {
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 100 };
          }
          throw new Error('File not found');
        },
        readFile: async (_uri: vscode.Uri) => new Uint8Array(),
      };
      Object.defineProperty(vscode.workspace, 'fs', { value: mockFs, writable: true, configurable: true });

      (vscode.workspace as any).openTextDocument = async (_uri: any) => ({ getText: () => userTasksJson });

      const tasks = await provider.getTasks();
      const userTask = tasks.find(t => t.label === 'User Task One');
      assert.ok(userTask, 'Should find user task');

      const cmd = userTask!.onOpenActionCommand;
      assert.ok(cmd, 'Should have onOpenActionCommand');
      const fileArg = cmd!.arguments?.[0] as vscode.Uri;
      assert.strictEqual(
        fileArg.fsPath,
        userTasksUri.fsPath,
        'onOpenActionCommand should reference user tasks.json',
      );
    });
  });
});
