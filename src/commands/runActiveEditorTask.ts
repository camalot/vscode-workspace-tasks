import BaseCommand from '../common/baseCommand';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { getRunnableTasksForFile, pickTaskFromList } from '../libs/taskQuickPick';

export class RunActiveEditorTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('editor.runTask', context);
  }

  async run(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return;
    }

    const tasks = getRunnableTasksForFile(uri);
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

    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) {
      return;
    }

    await TaskRunner.getInstance().runTask(item, undefined, true);
  }

  /** Shows a QuickPick for selecting among multiple tasks. Protected for testing. */
  protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const fileName = uri ? path.basename(uri.fsPath) : '';
    return pickTaskFromList(tasks, { placeHolder: `Select a task to run from ${fileName}` });
  }
}
