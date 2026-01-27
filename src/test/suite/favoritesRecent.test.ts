import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../../taskItem';
import { createTaskForItem } from '../../taskFactory';
import { WorkspaceTasksService } from '../../services/workspaceTasksService';

suite('Favorites/Recent Runnable Tests', () => {
  test('Favorite clone preserves taskSource and remains runnable', async () => {
    const ws = WorkspaceTasksService.getInstance();
    // Monkeypatch resolveTaskCommand
    const orig = (ws as any).resolveTaskCommand;
    (ws as any).resolveTaskCommand = async () => 'echo favorite-run';

    try {
      const file = vscode.Uri.file(path.resolve(__dirname, '../../../sample/npm-project/package.json'));
      const src = new TaskItem('Example Workspace Task', vscode.TreeItemCollapsibleState.None, 'workspace-task', file);
      src.taskFileUri = file;
      src.taskSource = 'npm';

      // Simulate favorite clone behavior: ensure taskFileUri and taskSource are preserved
      const fav = new TaskItem(src.label, src.collapsibleState, src.taskType, src.resourceUri, src.command, src.defaultIconPath);
      fav.taskFileUri = src.taskFileUri;
      fav.taskSource = src.taskSource;

      const created = await createTaskForItem(fav);
      assert.ok(created, 'createTaskForItem should return a CreatedTask for favorites');
      assert.strictEqual(created?.command, 'echo favorite-run');
    } finally {
      (ws as any).resolveTaskCommand = orig;
    }
  });

  test('Recent clone preserves taskSource and remains runnable', async () => {
    const ws = WorkspaceTasksService.getInstance();
    const orig = (ws as any).resolveTaskCommand;
    (ws as any).resolveTaskCommand = async () => 'echo recent-run';

    try {
      const file = vscode.Uri.file(path.resolve(__dirname, '../../../sample/npm-project/package.json'));
      const src = new TaskItem('Example Workspace Task', vscode.TreeItemCollapsibleState.None, 'workspace-task', file);
      src.taskFileUri = file;
      src.taskSource = 'npm';

      const recent = new TaskItem(src.label, src.collapsibleState, src.taskType, src.resourceUri, src.command, src.defaultIconPath);
      recent.taskFileUri = src.taskFileUri;
      recent.taskSource = src.taskSource;

      const created = await createTaskForItem(recent);
      assert.ok(created, 'createTaskForItem should return a CreatedTask for recent items');
      assert.strictEqual(created?.command, 'echo recent-run');
    } finally {
      (ws as any).resolveTaskCommand = orig;
    }
  });
});
