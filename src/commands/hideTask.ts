import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to hide a task from the task tree view.
 *
 * This command allows users to hide individual tasks at runtime through the context menu.
 * Hidden tasks are persisted across VS Code sessions and can be revealed later by toggling
 * the "Show Hidden Tasks" mode or by clearing all hidden tasks.
 *
 * User Experience:
 * 1. User right-clicks on a task in the tree view
 * 2. Selects "Hide Task" from the context menu
 * 3. Task is immediately removed from the view (unless "Show Hidden Tasks" mode is active)
 * 4. Task remains hidden across VS Code restarts until explicitly unhidden
 *
 * Implementation:
 * - Delegates the hiding logic to FilteredTaskService
 * - Triggers a local tree refresh to update the UI immediately
 * - The filtered state is automatically persisted by the service
 *
 * @example
 * ```typescript
 * // Command is typically invoked from context menu
 * // but can also be called programmatically:
 * await vscode.commands.executeCommand('workspaceTasks.hideTask', taskItem);
 * ```
 */
export class HideTaskCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new HideTaskCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('hideTask', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the hide task command.
   *
   * This method:
   * 1. Calls FilteredTaskService to add the task to the filtered set
   * 2. Triggers a local refresh of the task tree to update the UI
   *
   * The task will be filtered out from the tree view unless "Show Hidden Tasks" mode
   * is currently active. If show hidden mode is active, the task will remain visible
   * but its context value will be updated to show "Unhide Task" option.
   *
   * @param item - The TaskItem to hide from the tree view
   */
  async run(item: TaskItem): Promise<void> {
    FilteredTaskService.getInstance().hideTask(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
