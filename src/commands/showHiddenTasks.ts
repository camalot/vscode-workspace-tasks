import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to show all hidden tasks in the task tree view.
 *
 * This command switches from the normal filtered view to show-all mode,
 * revealing all tasks including those that were hidden. Hidden tasks may
 * be displayed with special styling or indicators.
 *
 * User Experience:
 * 1. User has hidden one or more tasks using "Hide Task"
 * 2. A "Show Hidden Tasks" button appears in the view title bar
 * 3. User clicks the button
 * 4. All tasks become visible, including hidden ones
 * 5. Hidden tasks show "Unhide Task" in their context menu
 * 6. Button changes to "Hide Hidden Tasks"
 *
 * This is one of two complementary commands (the other being hideHiddenTasks)
 * that provide clear, explicit actions instead of a toggle.
 *
 * @example
 * ```typescript
 * // Show all hidden tasks
 * await vscode.commands.executeCommand('workspaceTasks.showHiddenTasks');
 * ```
 */
export class ShowHiddenTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new ShowHiddenTasksCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('showHiddenTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the show hidden tasks command.
   *
   * This method:
   * 1. Checks current state to ensure we're not already in show mode
   * 2. Enables show hidden mode via FilteredTaskService
   * 3. Updates context keys through the service's change event
   * 4. Triggers a tree refresh to display all tasks
   * 5. Provides user feedback about the mode change
   *
   * After execution, all tasks including hidden ones will be visible in the tree.
   */
  async run(): Promise<void> {
    const service = FilteredTaskService.getInstance();

    // Only proceed if we're not already in show hidden mode
    if (!service.isShowHiddenMode()) {
      // Enable show hidden mode
      service.toggleShowHidden();

      // Refresh happens automatically via service change event,
      // but we call it explicitly for immediate feedback
      this.taskTreeDataProvider.refreshLocal();

      const count = service.getFilteredCount();
      vscode.window.showInformationMessage(
        `Showing all tasks including ${count} hidden task${count === 1 ? '' : 's'}`
      );
    }
  }
}
