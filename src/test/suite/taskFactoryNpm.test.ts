import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

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
