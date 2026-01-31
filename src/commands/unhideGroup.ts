import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to unhide a previously hidden task group.
 *
 * This command removes a group from the filtered set, making it and all its
 * children visible again in the normal (non-show-hidden) view mode.
 *
 * User Experience:
 * 1. User toggles "Show Hidden Tasks" mode to see all groups including hidden ones
 * 2. Hidden groups are displayed (possibly with special indicators)
 * 3. User right-clicks on a hidden group
 * 4. Selects "Unhide Group" from the context menu
 * 5. Group is removed from the filtered set
 * 6. Group and its children will remain visible when user toggles back to normal view
 *
 * Context Menu Visibility:
 * - This command only appears in the context menu when:
 *   a) The group is currently in the filtered set (isFiltered returns true)
 *   b) The user is in "Show Hidden Tasks" mode
 * - The HideGroupCommand option is hidden when this option is shown
 *
 * Implementation:
 * - Uses the same FilteredTaskService.showTask() method as unhideTask command
 * - The service automatically detects groups and handles them appropriately
 * - Triggers a local tree refresh to update the UI
 *
 * @example
 * ```typescript
 * // Command is typically invoked from context menu
 * // but can also be called programmatically:
 * await vscode.commands.executeCommand('workspaceTasks.unhideGroup', groupItem);
 * ```
 */
export class UnhideGroupCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new UnhideGroupCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('unhideGroup', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the unhide group command.
   *
   * This method:
   * 1. Calls FilteredTaskService to remove the group from the filtered set
   * 2. Triggers a local refresh of the task tree to update the UI
   *
   * The group and its children will remain visible in both normal view mode
   * and show hidden mode.
   *
   * @param item - The TaskItem group to unhide (make visible in normal view)
   */
  async run(item: TaskItem): Promise<void> {
    FilteredTaskService.getInstance().showTask(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
