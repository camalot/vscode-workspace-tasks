import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { CompoundTaskService } from '../services/compoundTaskService';
export class RenameCompoundTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('renameCompoundTask', context);
  }

  async run(item?: TaskItem): Promise<void> {
    const taskTreeDataProvider = TaskTreeDataProvider.getInstance();
    const target = item; // || treeView.selection[0];
    if (!target || target.contextValue !== 'compoundTask') {
      return;
    }

    const currentName = target.label as string;
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the compound task',
      value: currentName,
      placeHolder: 'Compound Task Name',
    });

    if (newName && newName.trim().length > 0) {
      CompoundTaskService.getInstance().renameCompoundTask(currentName, newName.trim());
      taskTreeDataProvider.refreshLocal();
    }
  }
}
