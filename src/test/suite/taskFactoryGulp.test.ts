import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('TaskFactory Gulp Tests', () => {
  test('createTaskForItem sets cwd to workspace root when gulpfile is in subfolder', async () => {
    const filePath = path.resolve(__dirname, '../../../sample/npm-project/gulp/gulpfile.mjs');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('group-test2-build-ui-one', vscode.TreeItemCollapsibleState.None, 'gulp', uri);

    const created = await createTaskForItem(item);
    assert.ok(created, 'Created task should exist');
    // Expect cwd to be the workspace folder (sample/npm-project)
    const expectedRoot = path.resolve(__dirname, '../../../sample/npm-project');
    assert.strictEqual(created?.cwd.replace(/\\/g, '/'), expectedRoot.replace(/\\/g, '/'));

    // Since the gulpfile lives in a subfolder, the command should include --gulpfile with its path
    assert.ok(created?.command && created.command.includes('--gulpfile'), 'Gulp task command should include --gulpfile when gulpfile is in a subfolder');
    assert.ok(created?.command && created.command.includes('/gulp/gulpfile.mjs'), 'Gulp task command should include the gulpfile path');
  });
});
