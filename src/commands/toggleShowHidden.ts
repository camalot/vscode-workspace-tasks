import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to toggle the visibility of hidden tasks in the task tree view.
 *
 * This command provides a toggle button (typically in the view title bar) that switches
 * between two modes:
 *
 * Mode 1 - Hide Filtered Tasks (default):
 * - Hidden tasks are completely removed from the tree view
 * - Button shows "Show Hidden Tasks" text with ellipsis icon (...)
 * - This is the normal working mode where users see only active tasks
 *
 * Mode 2 - Show Hidden Tasks:
 * - All tasks are visible, including those that were hidden
 * - Hidden tasks may be marked with special styling or indicators
 * - Context menu shows "Unhide Task" for filtered tasks
 * - Button shows "Hide Hidden Tasks" text with filter-filled icon
 *
 * User Experience:
 * 1. User hides one or more tasks using "Hide Task" context menu
 * 2. A toggle button appears in the view title bar (when tasks are hidden)
 * 3. Clicking the button reveals all tasks, marking hidden ones
 * 4. Clicking again returns to filtered view (hidden tasks disappear)
 *
 * Implementation:
 * - Delegates toggle logic to FilteredTaskService
 * - The service manages the mode state and fires change events
 * - TaskTreeDataProvider listens to these events and refreshes accordingly
 * - The button's visibility is controlled by "when" clause checking hasFilteredTasks
 *
 * @example
 * ```typescript
 * // Toggle show hidden mode
 * await vscode.commands.executeCommand('workspaceTasks.toggleShowHidden');
 * ```
 */
export class ToggleShowHiddenCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new ToggleShowHiddenCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('toggleShowHidden', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the toggle show hidden command.
   *
   * This method:
   * 1. Calls FilteredTaskService to toggle between show/hide modes
   * 2. Gets the new state after toggle
   * 3. Triggers a local refresh of the task tree
   * 4. Shows an informational message to the user about the current mode
   *
   * The tree view will automatically update to either show or hide filtered tasks
   * based on the new mode. The FilteredTaskService fires a change event that the
   * TaskTreeDataProvider listens to, ensuring the UI stays in sync.
   *
   * Note: The command itself doesn't need to explicitly refresh since the service's
   * change event triggers the refresh, but we call refreshLocal to ensure immediate
   * UI update.
   */
  async run(): Promise<void> {
    const newMode = FilteredTaskService.getInstance().toggleShowHidden();

    // The FilteredTaskService will fire its change event, which the TaskTreeDataProvider
    // listens to. We call refreshLocal here to ensure immediate UI update.
    this.taskTreeDataProvider.refreshLocal();

    // Provide user feedback about the current mode
    const message = newMode
      ? 'Showing all tasks including hidden ones'
      : 'Hiding filtered tasks from view';
    vscode.window.showInformationMessage(message);
  }
}
