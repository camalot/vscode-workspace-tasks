import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskCacheService } from "../services/taskCacheService";
import { configuration } from '../libs/configuration';

export class OnTreeItemClickCommand extends BaseCommand {
  private clickTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(context: vscode.ExtensionContext) {
    super('onTreeItemClick', context);
  }

  async run(itemOrId: TaskItem | string | undefined): Promise<void> {
    // Resolve the real TaskItem from cache if possible, as 'itemOrId' might be a serialized copy
    let item: TaskItem | undefined;

    if (itemOrId instanceof TaskItem) {
      item = itemOrId;
    } else if (itemOrId && typeof itemOrId === 'string') {
      item = TaskCacheService.getInstance().getTask(itemOrId);
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

  private getClickAction(item: TaskItem, clickType: 'single' | 'double'): vscode.Command | undefined {
    const action = clickType === 'single' ? configuration.get<string>('task.singleClickAction', 'open') : configuration.get<string>('task.doubleClickAction', 'run');

    if (action === 'none') {
      return undefined;
    }

    if (action === 'open') {
      return item.onOpenActionCommand;
    } else if (action === 'run') {
      return item.onRunActionCommand;
    }
    return undefined;
  }
}
