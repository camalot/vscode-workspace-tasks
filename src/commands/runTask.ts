import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunner } from '../taskRunner';
import { TaskCacheService } from '../services/taskCacheService';

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

    // VS Code serializes command arguments via TaskItem.toJSON() when invoking commands
    // from action bar buttons, which strips properties like guardedByDefinition.
    // Resolve the real cached instance so all properties are intact.
    if (item.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }

    if (item.contextValue === 'queuedTask') {
      const compoundTaskName = item.parent?.label as string;
      await TaskRunner.getInstance().runCompoundTask(compoundTaskName, item);
    } else {
      await TaskRunner.getInstance().runTask(item);
    }
  }
}
