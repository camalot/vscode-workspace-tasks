import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('TaskFactory Cake Tests', () => {
  test('createTaskForItem builds dotnet cake command with --target', async () => {
    const filePath = path.resolve(__dirname, '../task-files/cake/build.cake');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('Build', vscode.TreeItemCollapsibleState.None, 'cake', uri);

    const created = await createTaskForItem(item);
    assert.ok(created, 'Created task should exist');
    assert.strictEqual(created?.native, false);
    assert.ok(created?.command?.startsWith('dotnet cake '), 'Command should start with dotnet cake');
    assert.ok(created?.command?.includes('--target=Build'), 'Command should include --target argument');
    assert.ok(created?.command?.includes(filePath), 'Command should include cake script path');

    const task = created?.task;
    assert.ok(task, 'Task should be returned');
    assert.strictEqual(task?.source, 'cake');
  });

  test('createTaskForItem appends extra args for cake tasks', async () => {
    const filePath = path.resolve(__dirname, '../task-files/cake/build.cake');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('Test', vscode.TreeItemCollapsibleState.None, 'cake', uri);

    const created = await createTaskForItem(item, '--verbosity diagnostic');
    assert.ok(created, 'Created task should exist');
    assert.ok(created?.command?.includes('--target=Test'), 'Command should include selected target');
    assert.ok(created?.command?.includes('--verbosity diagnostic'), 'Command should include extra args');
  });
});
