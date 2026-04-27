import BaseCommand from '../common/baseCommand';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { getRunnableTasksForFile, pickTaskFromList } from '../libs/taskQuickPick';
import { configuration } from '../libs/configuration';
import { tryGuidedInput } from '../libs/guidedArgInput';

export class RunActiveEditorTaskWithArgsCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('editor.runTaskWithArgs', context);
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

    // Confirm guard BEFORE prompting for arguments
    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) {
      return;
    }

    if (configuration.get<boolean>('task.guidedArgInput', false)) {
      const argArray = await tryGuidedInput(item);
      if (argArray !== undefined) {
        await TaskRunner.getInstance().runTask(item, argArray.join(' '), true);
        return;
      }
      // Fall through to free-text if guided input was skipped or unavailable.
    }

    const args = await vscode.window.showInputBox({
      prompt: `Enter arguments for task '${item.label}'`,
      placeHolder: 'Arguments',
    });
    if (args !== undefined) {
      await TaskRunner.getInstance().runTask(item, args, true);
    }
  }

  /** Shows a QuickPick for selecting among multiple tasks. Protected for testing. */
  protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const fileName = uri ? path.basename(uri.fsPath) : '';
    return pickTaskFromList(tasks, { placeHolder: `Select a task to run with arguments from ${fileName}` });
  }
}
