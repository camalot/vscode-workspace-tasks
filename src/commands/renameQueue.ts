import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskTreeDataProvider } from "../taskTreeDataProvider";
import { QueueService } from "../services/queueService";
export class RenameQueueCommand extends BaseCommand {

  constructor(context: vscode.ExtensionContext) {
    super('renameQueue', context);

  }

  async run(item?: TaskItem): Promise<void> {
    const taskTreeDataProvider = TaskTreeDataProvider.getInstance();
    const target = item; // || treeView.selection[0];
    if (!target || target.contextValue !== 'queue') {
      return;
    }

    const currentName = target.label as string;
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the queue',
      value: currentName,
      placeHolder: 'Queue Name'
    });

    if (newName && newName.trim().length > 0) {
      QueueService.getInstance().renameQueue(currentName, newName.trim());
      taskTreeDataProvider.refreshLocal();
    }
  }
}
