import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskCacheService } from '../services/taskCacheService';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import constants from '../libs/constants';

interface TaskQuickPickItem extends vscode.QuickPickItem {
  taskItem: TaskItem;
}

export class RunActiveEditorTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('editor.runTask', context);
  }

  async run(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return;
    }

    const allTasks = TaskCacheService.getInstance().getTasksForFile(uri);
    const tasks = allTasks.filter(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));
    if (tasks.length === 0) {
      return;
    }

    let item: TaskItem;
    if (tasks.length === 1) {
      item = tasks[0];
    } else {
      const picked = await this.pickTask(tasks);
      if (!picked) {
        return;
      }
      item = picked;
    }

    // Resolve the real cached instance so all properties (e.g. guardedByDefinition) are intact.
    if (item.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }

    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) {
      return;
    }

    await TaskRunner.getInstance().runTask(item, undefined, true);
  }

  /** Shows a QuickPick for selecting among multiple tasks. Protected for testing. */
  protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
    const picks: TaskQuickPickItem[] = tasks.map(t => ({
      label: (t.originalLabel ?? t.label ?? '') as string,
      description: t.taskType,
      detail: t.taskFileUri?.fsPath,
      taskItem: t,
    }));
    const selection = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select a task to run',
    });
    return selection?.taskItem;
  }
}
