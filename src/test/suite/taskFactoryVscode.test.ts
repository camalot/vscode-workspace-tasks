import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory Vscode Test Suite', () => {
  let originalFetchTasks: any;

  setup(() => {
    originalFetchTasks = (vscode.tasks as any).fetchTasks;
  });

  teardown(() => {
    (vscode.tasks as any).fetchTasks = originalFetchTasks;
  });

  test('returns undefined when item.task is a raw JSON object (not a vscode.Task instance)', async () => {
    const uri = vscode.Uri.file('/workspace/.vscode/tasks.json');
    const item = new TaskItem('My Task', vscode.TreeItemCollapsibleState.None, 'vscode', uri);
    item.taskFileUri = uri;

    // Simulate what getTasks() used to do: assign raw JSON to item.task
    (item as any).task = { label: 'My Task', type: 'shell', command: 'echo hello' };

    // fetchTasks returns nothing (task not registered in system)
    (vscode.tasks as any).fetchTasks = async () => [];

    const created = await createTaskForItem(item);
    // Should not find a task since the raw JSON is ignored and no system task is registered
    assert.strictEqual(created, undefined, 'Should return undefined when item.task is raw JSON and no system task found');
  });

  test('returns native task when item.task is a proper vscode.Task instance', async () => {
    const uri = vscode.Uri.file('/workspace/.vscode/tasks.json');
    const item = new TaskItem('My Task', vscode.TreeItemCollapsibleState.None, 'vscode', uri);
    item.taskFileUri = uri;

    const nativeTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      'My Task',
      'vscode',
      new vscode.ShellExecution('echo hello'),
    );
    item.task = nativeTask;

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should return a created task');
    assert.strictEqual(created!.task, nativeTask, 'Should return the native vscode.Task instance');
    assert.strictEqual(created!.native, true, 'Should be marked as native');
  });

  test('resolves task via fetchTasks when item.task is not set (case vscode: handler)', async () => {
    const workspaceFolder: vscode.WorkspaceFolder = {
      uri: vscode.Uri.file('/workspace'),
      name: 'workspace',
      index: 0,
    };
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json');
    const item = new TaskItem('My Task', vscode.TreeItemCollapsibleState.None, 'vscode', uri);
    item.taskFileUri = uri;

    const registeredTask = new vscode.Task(
      { type: 'shell' },
      workspaceFolder,
      'My Task',
      'Workspace',
      new vscode.ShellExecution('echo hello'),
    );
    // Reflect the task's source as 'Workspace' (fetchTasks returns it)
    Object.defineProperty(registeredTask, 'source', { value: 'Workspace', configurable: true });

    // Mock getWorkspaceFolder to return our folder
    const originalGetWorkspaceFolder = (vscode.workspace as any).getWorkspaceFolder;
    (vscode.workspace as any).getWorkspaceFolder = (_uri: vscode.Uri) => workspaceFolder;

    (vscode.tasks as any).fetchTasks = async () => [registeredTask];

    try {
      const created = await createTaskForItem(item);
      assert.ok(created, 'Should resolve task via fetchTasks');
      assert.strictEqual(created!.task, registeredTask, 'Should return the registered task');
      assert.strictEqual(created!.native, true, 'Should be marked as native');
    } finally {
      (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    }
  });

  test('resolves user-level task (source User) via fetchTasks', async () => {
    const uri = vscode.Uri.file('/home/user/.config/Code/User/tasks.json');
    const item = new TaskItem('User Task', vscode.TreeItemCollapsibleState.None, 'vscode', uri);
    item.taskFileUri = uri;
    item.taskSource = 'user';

    const userTask = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Global,
      'User Task',
      'User',
      new vscode.ShellExecution('echo user task'),
    );
    Object.defineProperty(userTask, 'source', { value: 'User', configurable: true });

    // Mock getWorkspaceFolder to return undefined (user task has no workspace folder)
    const originalGetWorkspaceFolder = (vscode.workspace as any).getWorkspaceFolder;
    (vscode.workspace as any).getWorkspaceFolder = (_uri: vscode.Uri) => undefined;

    (vscode.tasks as any).fetchTasks = async () => [userTask];

    try {
      const created = await createTaskForItem(item);
      assert.ok(created, 'Should resolve user-level task via fetchTasks');
      assert.strictEqual(created!.task, userTask, 'Should return the user-level registered task');
    } finally {
      (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
    }
  });
});
