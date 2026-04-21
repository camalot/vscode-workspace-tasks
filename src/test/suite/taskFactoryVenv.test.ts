import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('TaskFactory Venv Tests', () => {
  function venvUri(filename: string): vscode.Uri {
    const rootPath =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : path.join(__dirname, 'test-workspace');
    return vscode.Uri.file(path.join(rootPath, filename));
  }

  test('preserves .py extension on a Python script whose name contains "activate"', async () => {
    const uri = venvUri('activate_env.py');
    const item = new TaskItem('activate_env.py', vscode.TreeItemCollapsibleState.None, 'venv', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.strictEqual(created?.native, false);
    // The command must reference the original .py path — not a stripped path
    assert.ok(
      created?.command?.includes('activate_env.py'),
      `Command should include 'activate_env.py' but was: ${created?.command}`,
    );
  });

  test('preserves .py extension on a Python script whose name contains "deactivate"', async () => {
    const uri = venvUri('deactivate_plugin.py');
    const item = new TaskItem('deactivate_plugin.py', vscode.TreeItemCollapsibleState.None, 'venv', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(
      created?.command?.includes('deactivate_plugin.py'),
      `Command should include 'deactivate_plugin.py' but was: ${created?.command}`,
    );
  });

  test('preserves .py extension on a script whose path contains "reactivate"', async () => {
    const uri = venvUri('reactivate.py');
    const item = new TaskItem('reactivate.py', vscode.TreeItemCollapsibleState.None, 'venv', uri);
    item.taskFileUri = uri;

    const created = await createTaskForItem(item);

    assert.ok(created, 'Should create a task');
    assert.ok(
      created?.command?.includes('reactivate.py'),
      `Command should include 'reactivate.py' but was: ${created?.command}`,
    );
  });

  test('returns undefined when no taskFileUri or resourceUri is set', async () => {
    const item = new TaskItem('activate', vscode.TreeItemCollapsibleState.None, 'venv', undefined);
    item.taskFileUri = undefined;
    item.resourceUri = undefined;

    const created = await createTaskForItem(item);

    assert.strictEqual(created, undefined, 'Should return undefined when no URI is available');
  });
});
