import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskCacheService } from "../services/taskCacheService";

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

      if (item.onDoubleClickCommand) {
        vscode.commands.executeCommand(item.onDoubleClickCommand.command, ...(item.onDoubleClickCommand.arguments || []));
      }
    } else {
      // Single click - wait for potential double click
      const timeout = setTimeout(() => {
        this.clickTimers.delete(id);
        if (item!.onSingleClickCommand) {
          vscode.commands.executeCommand(item!.onSingleClickCommand.command, ...(item!.onSingleClickCommand.arguments || []));
        }
      }, 250);
      this.clickTimers.set(id, timeout);
    }
  }
}
