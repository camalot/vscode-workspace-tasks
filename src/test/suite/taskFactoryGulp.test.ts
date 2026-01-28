import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';

suite('TaskFactory Gulp Tests', () => {
  test('createTaskForItem sets cwd to workspace root when gulpfile is in subfolder', async () => {
    const filePath = path.resolve(__dirname, '../task-files/gulp/gulpfile.mjs');
    const uri = vscode.Uri.file(filePath);
    const item = new TaskItem('group-test2-build-ui-one', vscode.TreeItemCollapsibleState.None, 'gulp', uri);

    const created = await createTaskForItem(item);
    assert.ok(created, 'Created task should exist');

    // In the test environment, the workspace root is the extension root
    // And TaskFactory Gulp logic explicitly prefers workspace root as CWD
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    assert.strictEqual(created?.cwd.toLowerCase(), workspaceRoot.toLowerCase());

    // Since the gulpfile lives in a subfolder, the command should include --gulpfile with its path
    assert.ok(created?.command && created.command.includes('--gulpfile'), 'Gulp task command should include --gulpfile when gulpfile is in a subfolder');
    // Normalize string to check path regardless of separator
    const normalizedCommand = created?.command ? created.command.replace(/\\/g, '/') : '';
    assert.ok(normalizedCommand.includes('/gulp/gulpfile.mjs'), 'Gulp task command should include the gulpfile path');
  });
});
