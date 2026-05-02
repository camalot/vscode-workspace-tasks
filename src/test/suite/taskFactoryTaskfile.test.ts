import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { TaskfileTaskProvider } from '../../providers/taskfileTaskProvider';

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

  // ── createTask resolvedLabel & hasCLIArgs tests ───────────────────────────

  test('T-CT1: createTask uses resolvedLabel when provided', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('start:*', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = { isWildcardTask: true, wildcardCount: 1 };

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, undefined, 'start:foo');

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.name, 'start:foo');
    assert.ok(created!.command?.includes('start:foo'), `Command should contain 'start:foo' but was: ${created!.command}`);
  });

  test('T-CT2: createTask falls back to originalLabel then label when resolvedLabel absent', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.originalLabel = 'build';

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created!.command?.includes('build'));
  });

  test('T-CT3: createTask inserts -- before args when hasCLIArgs=true and args non-empty', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('yarn', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = { hasCLIArgs: true };

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, 'install');

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    const dashDashIdx = args.indexOf('--');
    assert.ok(dashDashIdx !== -1, `Expected '--' in args but got: ${JSON.stringify(args)}`);
    assert.ok(args.indexOf('install') > dashDashIdx, `'install' should come after '--'`);
  });

  test('T-CT4: createTask does NOT insert -- when args is empty string', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('yarn', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = { hasCLIArgs: true };

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, '');

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    assert.ok(!args.includes('--'), `'--' should NOT appear when args is empty string`);
  });

  test('T-CT5: createTask does NOT insert -- when args is undefined', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('yarn', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = { hasCLIArgs: true };

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, undefined);

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    assert.ok(!args.includes('--'), `'--' should NOT appear when args is undefined`);
  });

  test('T-CT6: createTask does NOT insert -- when hasCLIArgs is false/unset', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = {};

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, '--force');

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    assert.ok(!args.includes('--'), `'--' should NOT appear when hasCLIArgs is unset`);
    assert.ok(args.includes('--force'));
  });

  test('createTask places varAssignments after task name and before extra args', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, '--verbose', undefined, ["ENV='prod'", "VERSION='1.2.3'"]);

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    const taskIdx = args.indexOf('deploy');
    const envIdx = args.indexOf("ENV='prod'");
    const versionIdx = args.indexOf("VERSION='1.2.3'");
    const verboseIdx = args.indexOf('--verbose');

    assert.ok(taskIdx !== -1);
    assert.ok(envIdx > taskIdx);
    assert.ok(versionIdx > envIdx);
    assert.ok(verboseIdx > versionIdx);
  });

  test('createTask with hasCLIArgs keeps varAssignments before -- separator', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('deploy', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = { hasCLIArgs: true };

    const provider = new TaskfileTaskProvider();
    const created = await provider.createTask(item, 'install', undefined, ["ENV='prod'"]);

    assert.ok(created, 'Should create a task');
    const exec = created!.task.execution as vscode.ShellExecution;
    const args = exec.args as string[];
    const envIdx = args.indexOf("ENV='prod'");
    const dashDashIdx = args.indexOf('--');
    const installIdx = args.indexOf('install');

    assert.ok(envIdx !== -1);
    assert.ok(dashDashIdx !== -1);
    assert.ok(envIdx < dashDashIdx);
    assert.ok(installIdx > dashDashIdx);
  });
});
