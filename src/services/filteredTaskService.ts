import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

/**
 * FilteredTaskService manages runtime task filtering (hiding) functionality.
 *
 * This service allows users to hide individual tasks and task groups from the task tree view at runtime.
 * Hidden items are persisted across VS Code sessions using globalState storage.
 *
 * Key Features:
 * - Hide individual tasks or entire task groups through context menu actions
 * - When a group is hidden, all its child tasks are automatically hidden
 * - Groups with all children hidden are automatically hidden
 * - Toggle visibility of hidden tasks (show all tasks vs. filtered view)
 * - Clear all hidden tasks at once
 * - Persistent storage of hidden task/group IDs across sessions
 *
 * UX Flow:
 * 1. User right-clicks a task/group and selects "Hide Task" or "Hide Group" from context menu
 * 2. Task/group is added to the filtered set and removed from the tree view
 * 3. If any tasks are hidden, a "Show Hidden Tasks" button appears in the title bar
 * 4. User can toggle to see all tasks including hidden ones (marked with special icon/label)
 * 5. User can "Clear Hidden Tasks" to remove all filters at once
 *
 * @example
 * ```typescript
 * const service = FilteredTaskService.getInstance();
 * service.initialize(context);
 *
 * // Hide a task or group
 * service.hideTask(taskItem);
 *
 * // Check if a task is hidden
 * if (service.isFiltered(taskId)) {
 *   // Task is currently hidden
 * }
 *
 * // Check if item or any parent is filtered
 * if (service.isFilteredOrHasFilteredParent(taskItem)) {
 *   // Should be hidden
 * }
 *
 * // Toggle show/hide mode
 * service.toggleShowHidden();
 *
 * // Clear all filters
 * service.clearFiltered();
 * ```
 */
export class FilteredTaskService {
  private static instance: FilteredTaskService;

  /**
   * Set of task IDs that are currently hidden from the task tree.
   * Task IDs are determined by the TaskStateManager's getTaskId method.
   */
  private filteredTasks: Set<string> = new Set();

  /**
   * Set of task IDs that are explicitly unhidden (visible) by the user.
   * This overrides default 'hidden: true' configuration.
   */
  private unhiddenTasks: Set<string> = new Set();

  /**
   * VSCode extension context for accessing persistent storage
   */
  private context?: vscode.ExtensionContext;

  /**
   * Key used to store filtered task IDs in VSCode's globalState
   */
  private readonly STORAGE_KEY = 'filteredTasks';

  /**
   * Key used to store unhidden task IDs in VSCode's globalState
   */
  private readonly UNHIDDEN_STORAGE_KEY = 'unhiddenTasks';

  /**
   * Key used to store the show hidden mode state in VSCode's globalState
   */
  private readonly SHOW_HIDDEN_KEY = 'showHiddenTasks';

  /**
   * Flag indicating whether hidden tasks should be shown in the tree view.
   * When true, all tasks are displayed (including hidden ones, which may be marked differently).
   * When false, hidden tasks are filtered out from the view.
   */
  private showHiddenMode: boolean = false;

  /**
   * Event emitter that fires when the filtered tasks set or show hidden mode changes.
   * Listeners can subscribe to be notified when they need to refresh the task tree.
   */
  private _onDidChange: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

  /**
   * Event that fires when the filtered state changes.
   * Use this to trigger tree view refreshes when tasks are hidden/shown.
   */
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  private constructor() {}

  /**
   * Gets the singleton instance of FilteredTaskService.
   *
   * @returns The FilteredTaskService singleton instance
   */
  public static getInstance(): FilteredTaskService {
    if (!FilteredTaskService.instance) {
      FilteredTaskService.instance = new FilteredTaskService();
    }
    return FilteredTaskService.instance;
  }

  /**
   * Initializes the service with the extension context and loads persisted state.
   * This method should be called during extension activation.
   *
   * Loads:
   * - Previously hidden task IDs from globalState
   * - The last known show hidden mode state
   *
   * @param context - The VSCode extension context for accessing storage
   */
  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;

    // Load previously filtered tasks from storage
    const savedFilteredTasks = context.globalState.get<string[]>(this.STORAGE_KEY, []);
    this.filteredTasks = new Set(savedFilteredTasks);

    // Load unhidden tasks
    const savedUnhiddenTasks = context.globalState.get<string[]>(this.UNHIDDEN_STORAGE_KEY, []);
    this.unhiddenTasks = new Set(savedUnhiddenTasks);

    // Load show hidden mode state
    this.showHiddenMode = context.globalState.get<boolean>(this.SHOW_HIDDEN_KEY, false);
  }

  /**
   * Checks if a task with the given ID is currently filtered (hidden).
   *
   * @param id - The unique task identifier
   * @returns true if the task is in the filtered set, false otherwise
   */
  public isFiltered(id: string): boolean {
    return this.filteredTasks.has(id);
  }

  /**
   * Checks if a task with the given ID is explicitly unhidden.
   *
   * @param id - The unique task identifier
   * @returns true if the task is in the unhidden set, false otherwise
   */
  public isUnhidden(id: string): boolean {
    return this.unhiddenTasks.has(id);
  }

  /**
   * Checks if a task item or any of its parent groups are filtered.
   *
   * This method traverses up the parent chain to determine if the item
   * should be hidden due to a parent group being filtered.
   *
   * Use case: When hiding a group (like "npm"), all child tasks should
   * also be hidden even if they weren't explicitly filtered.
   *
   * @param item - The TaskItem to check
   * @returns true if the item or any parent is filtered, false otherwise
   */
  public isFilteredOrHasFilteredParent(item: TaskItem): boolean {
    // Check the item itself, also stripping any dedupe suffix so compound task
    // children inherit the filtered state of the original standalone task.
    const itemId = item.id;
    const canonicalItemId = itemId ? itemId.replace(/\|\d+$/, '') : itemId;
    if ((itemId && this.filteredTasks.has(itemId)) || (canonicalItemId && this.filteredTasks.has(canonicalItemId))) {
      return true;
    }

    // Traverse up the parent chain
    let current = item.parent;
    while (current) {
      if (current.id && this.filteredTasks.has(current.id)) {
        return true;
      }
      current = current.parent;
    }

    return false;
  }

  /**
   * Checks if the service is currently in "show hidden" mode.
   *
   * When in show hidden mode:
   * - All tasks are displayed, including filtered ones
   * - Filtered tasks may be marked with special icons or indicators
   * - The toggle button shows "Hide Hidden Tasks" text
   *
   * When not in show hidden mode (default):
   * - Filtered tasks are removed from the tree view
   * - Only non-filtered tasks are visible
   * - The toggle button shows "Show Hidden Tasks" text
   *
   * @returns true if hidden tasks should be shown, false if they should be filtered out
   */
  public isShowHiddenMode(): boolean {
    return this.showHiddenMode;
  }

  /**
   * Adds a task or group to the filtered (hidden) set.
   *
   * This method works for both individual tasks and task groups:
   * - For tasks: Uses TaskStateManager.getTaskId() to get the canonical ID
   * - For groups: Uses the item's ID directly
   *
   * When a group is hidden:
   * - The group itself is added to the filtered set
   * - All child tasks are automatically hidden (via parent chain checking)
   * - The group will not appear in the tree unless "show hidden" mode is active
   *
   * This method:
   * 1. Extracts or uses the item's ID
   * 2. Adds it to the filtered tasks set
   * 3. Persists the change to globalState
   * 4. Fires the change event to notify listeners (triggers tree refresh)
   *
   * After calling this, the task/group will be hidden from the tree view
   * (unless show hidden mode is active).
   *
   * @param item - The TaskItem (task or group) to hide
   */
  public hideTask(item: TaskItem): void {
    // For groups (workspace, type, folder, etc.), use the item's ID directly
    // For tasks, get the canonical ID from TaskStateManager
    let id: string | undefined;

    if (item.taskType === 'workspace' ||
        item.taskType === 'type' ||
        item.taskType === 'folder' ||
        item.taskType === 'favorites' ||
        item.taskType === 'compoundTask' ||
        item.taskType === 'recent') {
      // This is a group - use its ID directly
      id = item.id;
    } else {
      // This is a task - get canonical ID
      id = TaskStateManager.getInstance().getTaskId(item);
    }

    if (id) {
      let changed = false;
      if (!this.filteredTasks.has(id)) {
        this.filteredTasks.add(id);
        changed = true;
      }
      if (this.unhiddenTasks.has(id)) {
        this.unhiddenTasks.delete(id);
        changed = true;
      }

      if (changed) {
        this.save();
        this._onDidChange.fire();
      }
    }
  }

  /**
   * Removes a task or group from the filtered (hidden) set, making it visible again.
   *
   * This method works for both individual tasks and task groups.
   * When a group is unhidden, it and all its children become visible.
   *
   * This method:
   * 1. Extracts or uses the item's ID
   * 2. Removes it from the filtered tasks set if present
   * 3. Persists the change to globalState
   * 4. Fires the change event to notify listeners (triggers tree refresh)
   *
   * After calling this, the task/group will reappear in the tree view.
   *
   * @param item - The TaskItem (task or group) to unhide
   */
  public showTask(item: TaskItem): void {
    // For groups, use the item's ID directly
    // For tasks, get the canonical ID from TaskStateManager
    let id: string | undefined;

    if (item.taskType === 'workspace' ||
        item.taskType === 'type' ||
        item.taskType === 'folder' ||
        item.taskType === 'favorites' ||
        item.taskType === 'compoundTask' ||
        item.taskType === 'recent') {
      // This is a group - use its ID directly
      id = item.id;
    } else {
      // This is a task - get canonical ID
      id = TaskStateManager.getInstance().getTaskId(item);
    }

    if (id) {
      let changed = false;
      if (this.filteredTasks.has(id)) {
        this.filteredTasks.delete(id);
        changed = true;
      }
      if (!this.unhiddenTasks.has(id)) {
        this.unhiddenTasks.add(id);
        changed = true;
      }

      if (changed) {
        this.save();
        this._onDidChange.fire();
      }
    }
  }

  /**
   * Toggles between showing and hiding filtered tasks in the tree view.
   *
   * This method:
   * 1. Flips the showHiddenMode flag
   * 2. Persists the new mode state to globalState
   * 3. Fires the change event to trigger a tree refresh
   *
   * When toggled to show mode:
   * - Hidden tasks become visible (possibly with special styling)
   * - Context menu shows "Unhide Task" option for filtered tasks
   *
   * When toggled to hide mode:
   * - Filtered tasks are removed from the tree view
   * - Only active (non-filtered) tasks are shown
   *
   * @returns The new state of show hidden mode (true if now showing hidden, false if hiding)
   */
  public toggleShowHidden(): boolean {
    this.showHiddenMode = !this.showHiddenMode;
    this.context?.globalState.update(this.SHOW_HIDDEN_KEY, this.showHiddenMode);
    this._onDidChange.fire();
    return this.showHiddenMode;
  }

  /**
   * Removes all tasks from the filtered set, making all tasks visible again.
   *
   * This method:
   * 1. Clears the entire filtered tasks set
   * 2. Resets show hidden mode to false
   * 3. Persists both changes to globalState
   * 4. Fires the change event to trigger a tree refresh
   *
   * After calling this, all previously hidden tasks will reappear in the tree view
   * and the view will return to normal mode (not showing hidden tasks).
   * This is typically called from a "Clear Hidden Tasks" button in the title bar.
   */
  public clearFiltered(): void {
    this.filteredTasks.clear();
    this.unhiddenTasks.clear();
    this.showHiddenMode = false;
    this.save();
    this.context?.globalState.update(this.SHOW_HIDDEN_KEY, this.showHiddenMode);
    this._onDidChange.fire();
  }

  /**
   * Gets the count of currently filtered (hidden) tasks.
   *
   * This is useful for:
   * - Displaying a badge count in the UI
   * - Determining whether to show the "Clear Hidden Tasks" button
   * - Showing status messages to users
   *
   * @returns The number of tasks currently in the filtered set
   */
  public getFilteredCount(): number {
    return this.filteredTasks.size;
  }

  /**
   * Checks if any tasks are currently filtered (hidden).
   *
   * This is useful for conditional UI elements, such as:
   * - Only showing the "Show Hidden Tasks" toggle when tasks are filtered
   * - Only showing the "Clear Hidden Tasks" button when there are tasks to clear
   * - Displaying status bar messages about filtered tasks
   *
   * @returns true if at least one task is filtered, false if no tasks are hidden
   */
  public hasFilteredTasks(): boolean {
    return this.filteredTasks.size > 0;
  }

  /**
   * Persists the current filtered tasks set to VSCode's globalState storage.
   *
   * This ensures that hidden tasks remain hidden across VS Code restarts.
   * Called automatically by methods that modify the filtered set.
   *
   * @private
   */
  private save(): void {
    this.context?.globalState.update(this.STORAGE_KEY, Array.from(this.filteredTasks));
    this.context?.globalState.update(this.UNHIDDEN_STORAGE_KEY, Array.from(this.unhiddenTasks));
  }
}
