import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Task Factory Taskfile Test Suite', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : path.join(__dirname, 'test-workspace');

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return { get: <T>(_key: string, def?: T): T => def as T };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

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

  test('alias child item runs alias name (not primary)', async () => {
    const taskfilePath = path.join(rootPath, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('bld', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = {
      isAlias: true,
      primaryTask: 'build',
    };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created!.task.name, 'bld');
    assert.ok(created!.command?.includes(' bld'), `Command should contain alias name but was: ${created!.command}`);
  });

  test('alias child cwd is same Taskfile directory', async () => {
    const subDir = path.join(rootPath, 'alias-project');
    const taskfilePath = path.join(subDir, 'Taskfile.yml');
    const uri = vscode.Uri.file(taskfilePath);

    const item = new TaskItem('b', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
    item.taskFileUri = uri;
    item.metadata = {
      isAlias: true,
      primaryTask: 'build',
    };

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a taskfile task');
    const expectedCwd = subDir.toLowerCase();
    assert.strictEqual(created!.cwd?.toLowerCase(), expectedCwd);

    const execution = created!.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    assert.strictEqual(execution.options?.cwd?.toLowerCase(), expectedCwd);
  });

  suite('--taskfile flag behavior', () => {
    test('--taskfile is always included when taskFileUri is set', async () => {
      const taskfilePath = path.join(rootPath, 'Taskfile.yml');
      const uri = vscode.Uri.file(taskfilePath);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
      item.taskFileUri = uri;

      const created = await createTaskForItem(item);
      assert.ok(created, 'Should create a task');
      assert.ok(created!.command?.includes('--taskfile'), `Command should include --taskfile but was: ${created!.command}`);
      assert.ok(created!.command?.includes(taskfilePath), `Command should include taskfile path but was: ${created!.command}`);
    });

    test('--taskfile is omitted when taskFileUri is not set', async () => {
      const uri = vscode.Uri.file(path.join(rootPath, 'Taskfile.yml'));
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
      item.taskFileUri = undefined;

      const created = await createTaskForItem(item);
      assert.ok(created, 'Should create a task');
      assert.ok(!created!.command?.includes('--taskfile'), `Command should not contain --taskfile but was: ${created!.command}`);
    });

    test('global task metadata prepends --taskfile regardless of setting', async () => {
      const taskfilePath = path.join(rootPath, 'Taskfile.yml');
      const uri = vscode.Uri.file(taskfilePath);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
      item.taskFileUri = uri;
      item.metadata = {
        isGlobalTask: true,
        globalTaskfilePath: '/home/test-user/Taskfile.yml',
      };

      const created = await createTaskForItem(item);
      assert.ok(created, 'Should create a task');

      const command = created!.command || '';
      const indexTaskfile = command.indexOf('--taskfile /home/test-user/Taskfile.yml');
      const indexTaskName = command.indexOf(' build');
      assert.ok(indexTaskfile >= 0, `Command should contain global --taskfile but was: ${command}`);
      assert.ok(indexTaskName > indexTaskfile, `Expected global --taskfile before task name but was: ${command}`);
    });

    test('global task keeps cwd based on item taskFileUri', async () => {
      const subDir = path.join(rootPath, 'global-cwd');
      const taskfilePath = path.join(subDir, 'Taskfile.yml');
      const uri = vscode.Uri.file(taskfilePath);
      const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'taskfile', uri);
      item.taskFileUri = uri;
      item.metadata = {
        isGlobalTask: true,
        globalTaskfilePath: '/home/test-user/Taskfile.yml',
      };

      const created = await createTaskForItem(item);
      assert.ok(created, 'Should create a task');

      const expectedCwd = subDir.toLowerCase();
      assert.strictEqual(created!.cwd?.toLowerCase(), expectedCwd);
      const execution = created!.task.execution as vscode.ShellExecution;
      assert.strictEqual(execution.options?.cwd?.toLowerCase(), expectedCwd);
    });
  });
});
