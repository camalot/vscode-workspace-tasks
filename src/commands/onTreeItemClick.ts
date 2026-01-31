import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskCacheService } from '../services/taskCacheService';
import { configuration } from '../libs/configuration';

export class OnTreeItemClickCommand extends BaseCommand {
  private clickTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(context: vscode.ExtensionContext) {
    super('onTreeItemClick', context);
  }

  async run(itemOrId: TaskItem | string | { id: string } | undefined): Promise<void> {
    // Resolve the real TaskItem from cache if possible, as 'itemOrId' might be a serialized copy
    let item: TaskItem | undefined;

    if (itemOrId instanceof TaskItem) {
      item = itemOrId;
    } else if (itemOrId && typeof itemOrId === 'string') {
      item = TaskCacheService.getInstance().getTask(itemOrId);
    } else if (itemOrId && typeof itemOrId === 'object' && 'id' in itemOrId) {
      item = TaskCacheService.getInstance().getTask(itemOrId.id);
    }

    if (!item) {
      // Fallback or item not found in cache (maybe dynamic item?)
      // If it's partial object but has commands, maybe we can still use it?
      // But the commands on partial object likely lack context.
      return;
    }

    // We use the ID to track clicks. If no ID, use random string.
    const id = item.id || Math.random().toString();

    if (this.clickTimers.has(id)) {
      // Double click
      clearTimeout(this.clickTimers.get(id));
      this.clickTimers.delete(id);

      const action = this.getClickAction(item, 'double');
      if (action) {
        vscode.commands.executeCommand(action.command, ...(action.arguments || []));
      }
    } else {
      // Single click - wait for potential double click
      const timeout = setTimeout(() => {
        this.clickTimers.delete(id);
        const action = this.getClickAction(item, 'single');
        if (action) {
          vscode.commands.executeCommand(action.command, ...(action.arguments || []));
        }
      }, 250);
      this.clickTimers.set(id, timeout);
    }
  }

  /**
   *
   * @param item The task item that triggered the action
   * @param clickType The type of action that occurred
   * @returns The command action to execute
   */
  private getClickAction(item: TaskItem, clickType: 'single' | 'double'): vscode.Command | undefined {
    const action =
      clickType === 'single'
        ? configuration.get<string>('task.singleClickAction', 'open')
        : configuration.get<string>('task.doubleClickAction', 'run');

    if (action === 'none') {
      return undefined;
    }

    if (action === 'open') {
      return item.onOpenActionCommand;
    } else if (action === 'run') {
      return item.onRunActionCommand;
    } else if (action === 'runWithArgs') {
      return item.onRunWithArgsActionCommand;
    }
    return undefined;
  }
}
