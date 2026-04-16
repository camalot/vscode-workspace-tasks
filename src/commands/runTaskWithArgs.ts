import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';

export class RunTaskWithArgsCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('runTaskWithArgs', context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (!item) {
      return;
    }
    // Confirm guard BEFORE prompting for arguments
    const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
    if (!confirmed) { return; }
    const args = await vscode.window.showInputBox({
      prompt: `Enter arguments for task '${item.label}'`,
      placeHolder: 'Arguments',
    });
    if (args !== undefined) {
      await TaskRunner.getInstance().runTask(item, args, true);
    }
  }
}
