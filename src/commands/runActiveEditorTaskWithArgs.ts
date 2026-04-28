import BaseCommand from '../common/baseCommand';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { getRunnableTasksForFile, pickTaskFromList } from '../libs/taskQuickPick';
import { configuration } from '../libs/configuration';
import { collectAdditionalArgs, tryGuidedInputWithStatus } from '../libs/guidedArgInput';

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

    if (configuration.get<boolean>('task.guidedArgInput', true)) {
      const guidedResult = await tryGuidedInputWithStatus(item);
      if (guidedResult.status === 'cancelled') {
        return;
      }

      if (guidedResult.status === 'collected') {
        const extraArgs = await collectAdditionalArgs(item.label as string);
        if (extraArgs === undefined) {
          return;
        }

        const mergedArgs = [...guidedResult.args, ...extraArgs];
        await TaskRunner.getInstance().runTask(item, mergedArgs.join(' '), true);
        return;
      }
      // Fall through to free-form if guided input was unavailable.
    }

    const extraArgs = await collectAdditionalArgs(item.label as string);
    if (extraArgs !== undefined) {
      await TaskRunner.getInstance().runTask(item, extraArgs.join(' '), true);
    }
  }

  /** Shows a QuickPick for selecting among multiple tasks. Protected for testing. */
  protected async pickTask(tasks: TaskItem[]): Promise<TaskItem | undefined> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const fileName = uri ? path.basename(uri.fsPath) : '';
    return pickTaskFromList(tasks, { placeHolder: `Select a task to run with arguments from ${fileName}` });
  }
}
