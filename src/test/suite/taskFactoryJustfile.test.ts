import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('TaskFactory Justfile Tests', () => {
  test('createTaskForItem builds just command with --justfile path and task name', async () => {
    const filePath = path.resolve(__dirname, '../task-files/just/justfile');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'justfile', uri);

    const created = await createTaskForItem(item);
    assert.ok(created, 'Created task should exist');
    assert.strictEqual(created?.native, false);
    assert.ok(created?.command?.includes('just'), 'Command should include just');
    assert.ok(created?.command?.includes('--justfile'), 'Command should include --justfile argument');
    assert.ok(created?.command?.includes(filePath), 'Command should include the full path to the justfile');
    assert.ok(created?.command?.includes('build'), 'Command should include the task name');
    assert.strictEqual(created?.cwd, path.dirname(filePath), 'cwd should be the justfile directory');

    const task = created?.task;
    assert.ok(task, 'Task should be returned');
    assert.strictEqual(task?.source, 'just');
  });

  test('createTaskForItem appends extra args for justfile tasks', async () => {
    const filePath = path.resolve(__dirname, '../task-files/just/justfile');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('test', vscode.TreeItemCollapsibleState.None, 'justfile', uri);

    const created = await createTaskForItem(item, '--dry-run');
    assert.ok(created, 'Created task should exist');
    assert.ok(created?.command?.includes('--justfile'), 'Command should include --justfile argument');
    assert.ok(created?.command?.includes(filePath), 'Command should include the full path to the justfile');
    assert.ok(created?.command?.includes('test'), 'Command should include the task name');
    assert.ok(created?.command?.includes('--dry-run'), 'Command should include extra args');
  });

  test('createTaskForItem returns undefined when justfile task has no taskFileUri', async () => {
    const item = new TaskItem('build', vscode.TreeItemCollapsibleState.None, 'justfile', undefined);

    const created = await createTaskForItem(item);
    assert.strictEqual(created, undefined);
  });
});
