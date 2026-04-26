import * as assert from 'assert';
import * as vscode from 'vscode';
import { createTaskForItem } from '../../taskFactory';
import { WorkspaceTasksService } from '../../services/workspaceTasksService';
import { TaskItem } from '../../taskItem';

suite('Task Factory Workspace Task Test Suite', () => {
  let originalResolveTaskCommand: WorkspaceTasksService['resolveTaskCommand'];

  setup(() => {
    originalResolveTaskCommand = WorkspaceTasksService.getInstance().resolveTaskCommand;
  });

  teardown(() => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = originalResolveTaskCommand;
  });

  test('replaces ${args} placeholder for workspace-task source tasks', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async () => 'docker run ${args} alpine:latest';

    const uri = vscode.Uri.file('/workspace/.workspace-tasks.json');
    const item = new TaskItem('Run Docker', vscode.TreeItemCollapsibleState.None, 'workspace-task', uri);
    item.taskSource = 'shell';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item, '--rm');
    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.command, 'docker run --rm alpine:latest');
  });

  test('appends args when ${args} placeholder is absent', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async () => 'echo hello';

    const uri = vscode.Uri.file('/workspace/.workspace-tasks.json');
    const item = new TaskItem('Echo', vscode.TreeItemCollapsibleState.None, 'workspace-task', uri);
    item.taskSource = 'shell';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item, 'world');
    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.command, 'echo hello world');
  });

  test('keeps command unchanged when args are not provided', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async () => 'echo hello';

    const uri = vscode.Uri.file('/workspace/.workspace-tasks.json');
    const item = new TaskItem('Echo', vscode.TreeItemCollapsibleState.None, 'workspace-task', uri);
    item.taskSource = 'shell';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);
    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.command, 'echo hello');
  });

  test('workspace-task uses array-form ShellExecution (no injection)', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async () => 'docker run ${args} alpine:latest';

    const uri = vscode.Uri.file('/workspace/.workspace-tasks.json');
    const item = new TaskItem('Run Docker', vscode.TreeItemCollapsibleState.None, 'workspace-task', uri);
    item.taskSource = 'shell';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item, '; rm -rf /');
    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    // Must be array form — commandLine must be undefined
    assert.strictEqual(exec.commandLine, undefined, 'Must not use string-form ShellExecution');
    assert.strictEqual(exec.command, 'docker', 'Executable must be docker');
    // Injection attempt must be a literal arg, not shell code
    assert.ok(
      Array.isArray(exec.args) && exec.args.some((a) => typeof a === 'string' && (a as string) === ';'),
      'Semicolon must appear as a literal array element, not shell operator',
    );
  });
});
