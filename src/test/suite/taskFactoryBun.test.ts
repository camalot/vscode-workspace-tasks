import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { TaskProviderRegistry } from '../../taskProviderRegistry';
import { BunTaskProvider } from '../../providers/npmTaskProvider';

suite('Task Factory Bun Test Suite', () => {
  let originalIsTrusted: boolean;
  let registrySnapshot: Map<string, any>;

  setup(() => {
    originalIsTrusted = (vscode.workspace as any).isTrusted;
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => true,
      configurable: true,
    });

    const registry = TaskProviderRegistry.getInstance();
    registrySnapshot = registry.snapshot();
    registry.register('bun', new BunTaskProvider());
  });

  teardown(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });

    TaskProviderRegistry.getInstance().restore(registrySnapshot);
  });

  test('Uses correct CWD for Bun tasks in subdirectory', async function () {
    // Need a valid URI that looks like it is in a workspace
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const subDir = path.join(rootPath, 'subdir');
    const pkgPath = path.join(subDir, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('test-script', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    // Check CWD. It should be the subdirectory where package.json is located.
    // Normalize paths for comparison (lowercase on Windows)
    const createdCwd = created?.cwd?.toLowerCase();
    const expectedCwd = subDir.toLowerCase();

    assert.strictEqual(createdCwd, expectedCwd, `CWD should be ${expectedCwd} but was ${createdCwd}`);

    // Check execution CWD
    const execution = created?.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    const execCwd = execution.options?.cwd?.toLowerCase();

    assert.strictEqual(execCwd, expectedCwd, `Execution CWD should be ${expectedCwd} but was ${execCwd}`);
  });

  test('Constructs correct command for Bun run script', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created?.command, 'Should have a command string');

    // Command should be: bun run build (or with full path to bun)
    assert.ok(
      created.command.includes('bun'),
      `Command should contain 'bun' but was: ${created.command}`,
    );
    assert.ok(
      created.command.includes('run'),
      `Command should contain 'run' but was: ${created.command}`,
    );
    assert.ok(
      created.command.includes('build'),
      `Command should contain 'build' but was: ${created.command}`,
    );
  });

  test('Appends additional arguments correctly for Bun tasks', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const additionalArgs = '--watch --verbose';
    const created = await createTaskForItem(item, additionalArgs);

    assert.ok(created, 'Should create a task');
    assert.ok(created?.command, 'Should have a command string');

    // Command should include the additional arguments
    assert.ok(
      created.command.includes('--watch'),
      `Command should contain '--watch' but was: ${created.command}`,
    );
    assert.ok(
      created.command.includes('--verbose'),
      `Command should contain '--verbose' but was: ${created.command}`,
    );

    // Should still have proper order: bun run test --watch --verbose
    const commandParts = created.command.split(/\s+/);
    const runIndex = commandParts.findIndex((part) => part === 'run');
    const testIndex = commandParts.findIndex((part) => part === 'test');
    const watchIndex = commandParts.findIndex((part) => part === '--watch');

    assert.ok(runIndex >= 0, 'Should have "run" in command');
    assert.ok(testIndex > runIndex, 'Script name should come after "run"');
    assert.ok(watchIndex > testIndex, 'Additional args should come after script name');
  });

  test('Creates task with correct task definition for Bun', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('dev', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created?.task, 'Should have a task object');

    // Check task definition
    const taskDef = created.task.definition;
    assert.strictEqual(taskDef.type, 'bun', 'Task definition type should be "bun"');
    assert.strictEqual(taskDef.script, 'dev', 'Task definition script should be "dev"');
    assert.strictEqual(taskDef.path, pkgPath, 'Task definition path should match package.json path');

    // Check task properties
    assert.strictEqual(created.task.name, 'dev', 'Task name should be "dev"');
    assert.strictEqual(created.task.source, 'bun', 'Task source should be "bun"');
  });

  test('Returns non-native task for Bun execution', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('start', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created.native, false, 'Bun tasks should not be marked as native');
  });

  test('Uses ShellExecution for Bun tasks', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('lint', vscode.TreeItemCollapsibleState.None, 'bun', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created?.task.execution, 'Task should have execution');
    assert.ok(
      created.task.execution instanceof vscode.ShellExecution,
      'Task execution should be ShellExecution',
    );

    const shellExec = created.task.execution as vscode.ShellExecution;
    // ShellExecution should have command and args or commandLine
    assert.ok(
      shellExec.command || shellExec.commandLine,
      'ShellExecution should have command or commandLine',
    );
  });
});
