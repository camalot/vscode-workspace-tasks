import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('Workspace Tasks Test Suite', () => {
  test('Resolves workspace-declared npm Install Dependencies to "npm install"', async function () {
    // Build path to sample package.json in workspace
    const pkgPath = path.resolve(__dirname, '../../../sample/npm-project/package.json');
    const uri = vscode.Uri.file(pkgPath);

    const item = new TaskItem('Install Dependencies', vscode.TreeItemCollapsibleState.None, 'npm', uri);
    // Mark the item as backed by workspace-defined tasks for provider 'npm'
    item.taskSource = 'npm';

    const created = await createTaskForItem(item);
    assert.ok(created, 'createTaskForItem should return a CreatedTask');
    assert.strictEqual(created?.command, 'npm install', 'Declared command should be exactly "npm install"');
  });
});
