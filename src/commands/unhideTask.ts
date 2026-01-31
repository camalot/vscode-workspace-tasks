import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to unhide a previously hidden task, making it visible in the normal view.
 *
 * This command is the opposite of HideTaskCommand. It removes a task from the filtered
 * set, making it visible again in the normal (non-show-hidden) view mode.
 *
 * User Experience:
 * 1. User toggles "Show Hidden Tasks" mode to see all tasks including hidden ones
 * 2. Hidden tasks are displayed (possibly with special indicators)
 * 3. User right-clicks on a hidden task
 * 4. Selects "Unhide Task" from the context menu
 * 5. Task is removed from the filtered set
 * 6. Task will remain visible even when user toggles back to normal view mode
 *
 * Context Menu Visibility:
 * - This command only appears in the context menu when:
 *   a) The task is currently in the filtered set (isFiltered returns true)
 *   b) The user is in "Show Hidden Tasks" mode
 * - The HideTaskCommand option is hidden when this option is shown
 *
 * Implementation:
 * - Delegates the unhiding logic to FilteredTaskService
 * - Triggers a local tree refresh to update the UI
 * - The change is automatically persisted by the service
 *
 * @example
 * ```typescript
 * // Command is typically invoked from context menu
 * // but can also be called programmatically:
 * await vscode.commands.executeCommand('workspaceTasks.unhideTask', taskItem);
 * ```
 */
export class UnhideTaskCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new UnhideTaskCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('unhideTask', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the unhide task command.
   *
   * This method:
   * 1. Calls FilteredTaskService to remove the task from the filtered set
   * 2. Triggers a local refresh of the task tree to update the UI
   *
   * The task will remain visible in both normal view mode and show hidden mode.
   * The task's context value will be updated to show "Hide Task" option instead
   * of "Unhide Task".
   *
   * @param item - The TaskItem to unhide (make visible in normal view)
   */
  async run(item: TaskItem): Promise<void> {
    FilteredTaskService.getInstance().showTask(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
