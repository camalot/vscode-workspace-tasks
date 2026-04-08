import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { TaskItem } from '../taskItem';
import { CompoundTaskService } from '../services/compoundTaskService';

export class RemoveFromCompoundTaskCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('removeFromCompoundTask', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item: TaskItem): Promise<void> {
    let compoundTaskName: string | undefined;
    if (item.parent && item.parent.contextValue === 'compoundTask') {
      compoundTaskName = item.parent.label as string;
    }
    CompoundTaskService.getInstance().removeFromCompoundTask(item, compoundTaskName);
    this.taskTreeDataProvider.refreshLocal();
  }
}
