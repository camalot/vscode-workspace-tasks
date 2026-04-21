import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { NpmTaskProvider } from '../../providers/npmTaskProvider';

suite('Task Factory NPM Test Suite', () => {
  test('Uses correct CWD for NPM tasks in subdirectory', async function () {
    // Need a valid URI that looks like it is in a workspace
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const subDir = path.join(rootPath, 'subdir');
    const pkgPath = path.join(subDir, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('test-script', vscode.TreeItemCollapsibleState.None, 'npm', uri);
    item.taskFileUri = uri;
    // item.resourceUri = uri; // Constructor sets this too

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    // Check CWD. It should be the subdirectory.
    // Normalize paths for comparison (lowercase on Windows)
    const createdCwd = created?.cwd?.toLowerCase();
    const expectedCwd = subDir.toLowerCase();

    assert.strictEqual(createdCwd, expectedCwd, `CWD should be ${expectedCwd} but was ${createdCwd}`);

    // Check execution CWD
    const execution = created?.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    const execCwd = execution.options?.cwd?.toLowerCase();

    // Note: Visual Studio Code might normalize paths, so we handle that by just checking they match
    assert.strictEqual(execCwd, expectedCwd, `Execution CWD should be ${expectedCwd} but was ${execCwd}`);
  });
});

// ── NpmTaskProvider.createTask() direct tests ─────────────────────────────────

suite('NpmTaskProvider.createTask()', () => {
  let originalIsTrusted: boolean;

  setup(() => {
    originalIsTrusted = (vscode.workspace as any).isTrusted;
  });

  teardown(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });
  });

  function makeItem(scriptName: string): TaskItem {
    const rootPath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/workspace';
    const uri = vscode.Uri.file(path.join(rootPath, 'package.json'));
    const item = new TaskItem(scriptName, vscode.TreeItemCollapsibleState.None, 'npm', uri);
    item.taskFileUri = uri;
    return item;
  }

  test('still creates a task when workspace is not trusted (task creation does not spawn processes)', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => false,
      configurable: true,
    });
    const provider = new NpmTaskProvider();
    const item = makeItem('build');
    const result = await provider.createTask(item);
    assert.ok(result, 'Should still create a task — createTask does not spawn processes');
  });

  test('creates "npm run <script>" task for a regular script', async () => {
    const provider = new NpmTaskProvider();
    const item = makeItem('build');

    const result = await provider.createTask(item);

    assert.ok(result, 'Should return a CreatedTask');
    assert.strictEqual(result?.native, false);
    assert.ok(result?.command?.includes('npm'), 'Command should include npm');
    assert.ok(result?.command?.includes('run'), 'Command should include run');
    assert.ok(result?.command?.includes('build'), 'Command should include script name');

    const exec = result?.task.execution as vscode.ShellExecution;
    assert.ok(exec, 'Should have ShellExecution');
    const argStr = exec.args?.join(' ') ?? '';
    assert.ok(argStr.includes('run'), 'Args should include "run"');
    assert.ok(argStr.includes('build'), 'Args should include script name');
  });

  test('creates "npm install" task for "install" label', async () => {
    const provider = new NpmTaskProvider();
    const item = makeItem('install');

    const result = await provider.createTask(item);

    assert.ok(result, 'Should return a CreatedTask');
    const exec = result?.task.execution as vscode.ShellExecution;
    const argStr = exec.args?.join(' ') ?? '';
    assert.ok(argStr.includes('install'), 'Args should include "install"');
    assert.ok(!argStr.includes('run'), 'Args should NOT include "run" for install');
    assert.strictEqual(result?.task.definition.script, 'install');
  });

  test('creates "npm install" task for "install dependencies" label', async () => {
    const provider = new NpmTaskProvider();
    const item = makeItem('install dependencies');

    const result = await provider.createTask(item);

    assert.ok(result, 'Should return a CreatedTask');
    const exec = result?.task.execution as vscode.ShellExecution;
    const argStr = exec.args?.join(' ') ?? '';
    assert.ok(argStr.includes('install'), 'Args should include "install"');
    assert.ok(!argStr.includes('run'), 'Should not include "run"');
  });

  test('appends extra args to the command', async () => {
    const provider = new NpmTaskProvider();
    const item = makeItem('test');

    const result = await provider.createTask(item, '--watch --coverage');

    assert.ok(result, 'Should return a CreatedTask');
    const exec = result?.task.execution as vscode.ShellExecution;
    const argStr = exec.args?.join(' ') ?? '';
    assert.ok(argStr.includes('--watch'), 'Args should include --watch');
    assert.ok(argStr.includes('--coverage'), 'Args should include --coverage');
  });

  test('cwd is the package.json directory', async () => {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/workspace';
    const subDir = path.join(rootPath, 'packages', 'core');
    const uri = vscode.Uri.file(path.join(subDir, 'package.json'));
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'npm', uri);
    item.taskFileUri = uri;

    const provider = new NpmTaskProvider();
    const result = await provider.createTask(item);

    assert.ok(result, 'Should return a CreatedTask');
    assert.strictEqual(
      result?.cwd?.toLowerCase(),
      subDir.toLowerCase(),
      'cwd should be the package.json directory',
    );
    const exec = result?.task.execution as vscode.ShellExecution;
    assert.strictEqual(
      exec.options?.cwd?.toLowerCase(),
      subDir.toLowerCase(),
      'ShellExecution cwd should match',
    );
  });

  test('task definition has correct type and script', async () => {
    const provider = new NpmTaskProvider();
    const item = makeItem('lint');

    const result = await provider.createTask(item);

    assert.ok(result);
    assert.strictEqual(result?.task.definition.type, 'npm');
    assert.strictEqual((result?.task.definition as any).script, 'lint');
  });
});
