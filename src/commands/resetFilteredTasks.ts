import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';
import { TaskCacheService } from '../services/taskCacheService';

/**
 * Command to clear all hidden tasks, making them visible again.
 *
 * This command provides a quick way to unhide all tasks at once, rather than
 * unhiding them one by one. It's typically invoked from a button in the view
 * title bar that appears when tasks are hidden.
 *
 * User Experience:
 * 1. User has hidden one or more tasks using "Hide Task" context menu
 * 2. A "Clear Hidden Tasks" button appears in the view title bar
 * 3. Clicking the button removes all tasks from the filtered set
 * 4. All previously hidden tasks immediately reappear in the tree view
 * 5. The "Clear Hidden Tasks" and "Show Hidden Tasks" buttons disappear (no tasks are hidden)
 *
 * Use Cases:
 * - User wants to reset their task filtering and start fresh
 * - User accidentally hid important tasks and wants to restore all at once
 * - User finished a specific workflow and wants to see all tasks again
 * - During development/testing when quickly toggling between filtered states
 *
 * Implementation:
 * - Delegates clearing logic to FilteredTaskService
 * - The service empties the filtered set and persists the change
 * - Triggers a local tree refresh to update the UI immediately
 * - Shows a confirmation message to the user
 *
 * @example
 * ```typescript
 * // Clear all hidden tasks
 * await vscode.commands.executeCommand('workspaceTasks.resetFilteredTasks');
 * ```
 */
export class ResetFilteredTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new ResetFilteredTasksCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('resetFilteredTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the clear filtered tasks command.
   *
   * This method:
   * 1. Gets the count of currently filtered tasks (for user feedback)
   * 2. Calls FilteredTaskService to clear all hidden tasks
   * 3. Triggers a local refresh of the task tree
   * 4. Shows an informational message confirming the action
   *
   * After execution:
   * - All previously hidden tasks reappear in the tree view
   * - The filtered tasks set is empty
   * - The "Clear Hidden Tasks" button disappears from the title bar
   * - The "Show Hidden Tasks" toggle button also disappears
   *
   * Note: If no tasks are currently hidden, this command is typically disabled
   * via the "when" clause in package.json, but we handle that gracefully here.
   */
  async run(): Promise<void> {
    const service = FilteredTaskService.getInstance();
    const count = service.getFilteredCount();

    // Clear all filtered tasks
    service.clearFiltered();

    // force a refresh of the tasks so that the tasks are re-evaluated
    await vscode.commands.executeCommand('workspaceTasks.refresh');


    // Show confirmation message
    if (count > 0) {
      vscode.window.showInformationMessage(`Reset ${count} hidden task(s).`);
    } else {
        vscode.window.showInformationMessage('Hidden tasks reset.');
    }
  }
}
