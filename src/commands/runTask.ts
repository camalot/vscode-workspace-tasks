import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';

export class RunTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('runTask', context);

  }

  async run(item: TaskItem): Promise<void> {
    if (!item || !item.contextValue) {
      // If run from command palette or keybinding without context, or invalid item
      // We could potentially show a quick pick here, but for now just return/log
      this.logger.warn('RunTaskCommand: No valid task item provided', item);
      return;
    }

    if (item.contextValue === 'queuedTask') {
      const compoundTaskName = item.parent?.label as string;
      await TaskRunner.getInstance().runCompoundTask(compoundTaskName, item);
    } else {
      await TaskRunner.getInstance().runTask(item);
    }
  }
}
