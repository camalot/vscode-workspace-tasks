import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { TaskProviderRegistry } from '../../taskProviderRegistry';
import { PnpmTaskProvider } from '../../providers/npmTaskProvider';

suite('Task Factory Pnpm Test Suite', () => {
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
    registry.register('pnpm', new PnpmTaskProvider());
  });

  teardown(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      get: () => originalIsTrusted,
      configurable: true,
    });

    TaskProviderRegistry.getInstance().restore(registrySnapshot);
  });

  test('uses package.json directory as cwd, not workspace root', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const subDir = path.join(rootPath, 'subdir');
    const pkgPath = path.join(subDir, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('test-script', vscode.TreeItemCollapsibleState.None, 'pnpm', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');

    // cwd must be the sub-package directory, not the workspace root
    const createdCwd = created?.cwd?.toLowerCase();
    const expectedCwd = subDir.toLowerCase();
    assert.strictEqual(createdCwd, expectedCwd, `CWD should be ${expectedCwd} but was ${createdCwd}`);

    const execution = created?.task.execution as vscode.ShellExecution;
    assert.ok(execution, 'Task should have ShellExecution');
    const execCwd = execution.options?.cwd?.toLowerCase();
    assert.strictEqual(execCwd, expectedCwd, `Execution CWD should be ${expectedCwd} but was ${execCwd}`);
  });

  test('constructs correct pnpm run command', async function () {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');

    const pkgPath = path.join(rootPath, 'package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'pnpm', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(created?.command?.includes('pnpm'), `Command should contain 'pnpm' but was: ${created?.command}`);
    assert.ok(created?.command?.includes('build'), `Command should contain task label but was: ${created?.command}`);
  });
});
