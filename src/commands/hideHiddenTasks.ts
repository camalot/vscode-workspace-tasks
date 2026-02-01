import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { FilteredTaskService } from '../services/filteredTaskService';

/**
 * Command to hide filtered tasks from the task tree view.
 *
 * This command switches from show-all mode back to the normal filtered view,
 * removing hidden tasks from the display. This is the default mode where only
 * active (non-filtered) tasks are shown.
 *
 * User Experience:
 * 1. User is in "Show Hidden Tasks" mode (all tasks visible)
 * 2. A "Hide Hidden Tasks" button is displayed in the title bar
 * 3. User clicks the button
 * 4. Filtered tasks are removed from the tree view
 * 5. Only active tasks remain visible
 * 6. Button changes back to "Show Hidden Tasks"
 *
 * This is one of two complementary commands (the other being showHiddenTasks)
 * that provide clear, explicit actions instead of a toggle.
 *
 * @example
 * ```typescript
 * // Return to filtered view
 * await vscode.commands.executeCommand('workspaceTasks.hideHiddenTasks');
 * ```
 */
export class HideHiddenTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  /**
   * Creates a new HideHiddenTasksCommand instance.
   *
   * @param context - The VSCode extension context
   */
  constructor(context: vscode.ExtensionContext) {
    super('hideHiddenTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);
  }

  /**
   * Executes the hide hidden tasks command.
   *
   * This method:
   * 1. Checks current state to ensure we're currently in show mode
   * 2. Disables show hidden mode via FilteredTaskService
   * 3. Updates context keys through the service's change event
   * 4. Triggers a tree refresh to filter out hidden tasks
   * 5. Provides user feedback about the mode change
   *
   * After execution, only active (non-filtered) tasks will be visible in the tree.
   */
  async run(): Promise<void> {
    const service = FilteredTaskService.getInstance();

    // Only proceed if we're currently in show hidden mode
    if (service.isShowHiddenMode()) {
      // Disable show hidden mode
      service.toggleShowHidden();

      // Refresh happens automatically via service change event,
      // but we call it explicitly for immediate feedback
      this.taskTreeDataProvider.refreshLocal();

      const count = service.getFilteredCount();
    }
  }
}
