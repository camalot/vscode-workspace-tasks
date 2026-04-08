import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { TaskItem } from '../taskItem';
import { CompoundTaskService } from '../services/compoundTaskService';

export class ClearCompoundTaskCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('clearCompoundTask', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (item && item.contextValue === 'compoundTask') {
      CompoundTaskService.getInstance().clearCompoundTask(item.label as string);
      this.taskTreeDataProvider.refreshLocal();
      return;
    }

    const compoundTasks = CompoundTaskService.getInstance().getCompoundTaskNames();
    if (compoundTasks.length === 0) {
      return;
    }

    const selected = await vscode.window.showQuickPick(compoundTasks, { placeHolder: 'Select compound task to clear' });
    if (selected) {
      CompoundTaskService.getInstance().clearCompoundTask(selected);
      this.taskTreeDataProvider.refreshLocal();
    }
  }
}
