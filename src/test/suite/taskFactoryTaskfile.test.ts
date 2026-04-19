import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory Taskfile Test Suite', () => {
  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : path.join(__dirname, 'test-workspace');

  test('creates task with correct definition type', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.definition.type, 'taskfile');
  });

  test('creates task with correct label', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.name, 'deploy');
  });

  test('creates task with cwd set to Taskfile directory', async () => {
    const subDir = path.join(rootPath, 'myproject');
    const taskfilePath = path.join(subDir, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a taskfile task');
    const expectedCwd = subDir.toLowerCase();
    assert.strictEqual(created!.cwd?.toLowerCase(), expectedCwd);

    const execution = created!.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    assert.strictEqual(execution.options?.cwd?.toLowerCase(), expectedCwd);
  });

  test('appends extra args to task command', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item, '--force');

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('--force'), `Command should contain --force but was: ${created!.command}`);
  });

  test('command string includes task label', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('lint'), `Command should contain 'lint' but was: ${created!.command}`);
  });
});
