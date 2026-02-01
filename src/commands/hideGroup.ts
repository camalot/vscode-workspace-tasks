import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to hide a task group from the task tree view.
 *
 * This command allows users to hide entire task groups (like "npm", "vscode", etc.)
 * at runtime through the context menu. When a group is hidden:
 * - The group itself disappears from the tree
 * - All child tasks within that group are automatically hidden
 * - Hidden groups are persisted across VS Code sessions
 *
 * User Experience:
 * 1. User right-clicks on a group (workspace, type, or folder) in the tree view
 * 2. Selects "Hide Group" from the context menu
 * 3. Group and all its children are immediately removed from the view
 * 4. Group remains hidden across VS Code restarts until explicitly unhidden
 *
 * Implementation:
 * - Uses the same FilteredTaskService.hideTask() method as hideTask command
 * - The service automatically detects groups and handles them appropriately
 * - Triggers a local tree refresh to update the UI immediately
 *
 * @example
 * ```typescript
 * // Command is typically invoked from context menu
 * // but can also be called programmatically:
 * await vscode.commands.executeCommand('workspaceTasks.hideGroup', groupItem);
 * ```
 */
export class HideGroupCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new HideGroupCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('hideGroup', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the hide group command.
   *
   * This method:
   * 1. Calls FilteredTaskService to add the group to the filtered set
   * 2. Triggers a local refresh of the task tree to update the UI
   *
   * The group and all its children will be filtered out from the tree view
   * unless "Show Hidden Tasks" mode is currently active.
   *
   * @param item - The TaskItem group to hide from the tree view
   */
  async run(item: TaskItem): Promise<void> {
    FilteredTaskService.getInstance().hideTask(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
