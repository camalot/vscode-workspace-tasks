import * as assert from 'assert';
import * as vscode from 'vscode';
import { createTaskForItem } from '../../taskFactory';
import { WorkspaceTasksService } from '../../services/workspaceTasksService';
import { TaskItem } from '../../taskItem';

suite('Task Factory Workspace Task Test Suite', () => {
  let originalResolveTaskCommand: WorkspaceTasksService['resolveTaskCommand'];
  let resolveCalls: Array<{ label: string; languageId: string; path: string }>;

  setup(() => {
    originalResolveTaskCommand = WorkspaceTasksService.getInstance().resolveTaskCommand;
    resolveCalls = [];
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

  test('returns undefined when workspace-sourced command resolution is cancelled', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async (label: string, languageId: string, uri: vscode.Uri) => {
      resolveCalls.push({ label, languageId, path: uri.fsPath });
      return undefined;
    };

    const uri = vscode.Uri.file('/workspace/docker/Dockerfile');
    const item = new TaskItem('dockerfile:build', vscode.TreeItemCollapsibleState.None, 'dockerfile', uri);
    item.taskSource = 'dockerfile';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined, 'Cancelled workspace-sourced task should not produce a runnable task');
    assert.strictEqual(resolveCalls.length, 1, 'Should only attempt workspace-sourced resolution once');
    assert.strictEqual(resolveCalls[0].languageId, 'dockerfile');
  });

  test('does not fall through to special-case dockerfile resolution after workspace-source cancel', async () => {
    WorkspaceTasksService.getInstance().resolveTaskCommand = async (label: string, languageId: string, uri: vscode.Uri) => {
      resolveCalls.push({ label, languageId, path: uri.fsPath });
      if (languageId === 'DockerFile') {
        throw new Error('Special-case DockerFile fallback should not be called for workspace-sourced items');
      }
      return undefined;
    };

    const uri = vscode.Uri.file('/workspace/docker/Dockerfile');
    const item = new TaskItem('dockerfile:build', vscode.TreeItemCollapsibleState.None, 'dockerfile', uri);
    item.taskSource = 'dockerfile';
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
    assert.deepStrictEqual(resolveCalls.map((c) => c.languageId), ['dockerfile']);
  });
});
