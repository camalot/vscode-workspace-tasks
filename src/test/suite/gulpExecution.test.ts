import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { GulpTaskProvider } from '../../providers/gulpTaskProvider';
import { TaskFilesService } from '../../services/taskFilesService';
import { TaskRunner } from '../../taskRunner';
import { TaskStateManager } from '../../taskStateManager';

suite('Gulp Execution Test Suite', () => {
  test('Running a gulp task uses vscode.tasks.executeTask and sets running state', async () => {
    const filesService = TaskFilesService.getInstance();
    const originalFindFiles = filesService.findFiles;
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const gulpfileMjs = path.join(workspaceRoot, 'src/test/task-files/gulp/gulpfile.mjs');
    const gulpfileJs = path.join(workspaceRoot, 'src/test/task-files/gulp/gulpfile.js');

    filesService.findFiles = async () => [
      vscode.Uri.file(gulpfileMjs),
      vscode.Uri.file(gulpfileJs),
    ];

    const provider = new GulpTaskProvider();
    const tasks = await provider.getTasks();
    const names = tasks.map((t) => t.label);
    assert.ok(names.length > 0, 'Expected to find at least one gulp task');

    const taskItem = tasks[0];

    // Mock executeTask
    const original = (vscode.tasks as any).executeTask;
    let executedTask: any = undefined;
    (vscode.tasks as any).executeTask = async (task: vscode.Task) => {
      executedTask = task;
      return { fakeExecution: true } as any;
    };

    try {
      const idBefore = TaskStateManager.getInstance().getTaskId(taskItem);
      await TaskRunner.getInstance().runTask(taskItem);

      const id = TaskStateManager.getInstance().getTaskId(taskItem);
      assert.strictEqual(id, idBefore, 'Task id should be consistent');

      const exec = TaskStateManager.getInstance().getExecution(id);
      assert.ok(exec && (exec as any).fakeExecution === true, 'Execution should be stored in state manager');

      const status = TaskStateManager.getInstance().getStatus(id);
      assert.strictEqual(status, 'running');

      assert.ok(executedTask, 'vscode.tasks.executeTask should have been called');
    } finally {
      (vscode.tasks as any).executeTask = original;
      filesService.findFiles = originalFindFiles;
    }
  });
});
