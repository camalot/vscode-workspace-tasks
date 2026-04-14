import * as vscode from 'vscode';
import { TaskStateManager } from './taskStateManager';
import { FavoritesService } from './services/favoritesService';
import { FilteredTaskService } from './services/filteredTaskService';

export class TaskItem extends vscode.TreeItem {
  public children: TaskItem[] = [];
  public startLine: number | undefined;
  public originalLabel: string;
  public defaultIconPath: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined;
  public taskSource: string | undefined;
  public taskOrigin: 'user' | 'workspace' | undefined;
  public taskFileUri?: vscode.Uri;
  /** When set, its path is embedded in the workspace-tasks:// URI so VS Code's file icon
   * theme can match the right icon (e.g. "tsconfig.json" → TS config icon). Works for both
   * group items and task leaf items. Prefer setting this over assigning resourceUri directly,
   * since updateContextValue() rebuilds resourceUri and would clobber a direct assignment. */
  public iconDisplayUri?: vscode.Uri;
  private _parent?: TaskItem;
  public get parent(): TaskItem | undefined {
    return this._parent;
  }
  public set parent(value: TaskItem | undefined) {
    this._parent = value;
    // Update context value when parent changes to inherit filtered state
    this.updateContextValue();
    // Recursively update all children since the parent chain has changed
    this.updateChildrenContext();
  }

  private updateChildrenContext() {
    if (this.children) {
      for (const child of this.children) {
        child.updateContextValue();
        child.updateChildrenContext(); // Recurse down
      }
    }
  }

  public metadata?: any;

  public onOpenActionCommand?: vscode.Command;
  public onRunActionCommand?: vscode.Command;
  public onRunWithArgsActionCommand?: vscode.Command;
  public task?: vscode.Task;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly taskType: string,
    resourceUri?: vscode.Uri,
    command?: vscode.Command,
    defaultIconPath?: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri },
    onRunActionCommand?: vscode.Command,
    onRunWithArgsActionCommand?: vscode.Command,
  ) {
    super(label, collapsibleState);

    this.onOpenActionCommand = command;
    this.onRunActionCommand = onRunActionCommand;
    this.onRunWithArgsActionCommand = onRunWithArgsActionCommand;

    // Default double click to run task if it's a leaf node
    if (!this.onRunActionCommand && this.collapsibleState === vscode.TreeItemCollapsibleState.None) {
      this.onRunActionCommand = {
        command: 'workspaceTasks.runTask',
        title: 'Run Task',
        arguments: [this], // We pass 'this' here because runTask expects a TaskItem.
        // During onTreeItemClick, we resolve the real Item from cache,
        // so executing this command uses the real item from memory, preventing serialization issues.
      };
    }

    // Only set the trigger command if we actually have actions to perform
    if (this.onOpenActionCommand || this.onRunActionCommand || this.onRunWithArgsActionCommand) {
      this.command = {
        command: 'workspaceTasks.onTreeItemClick',
        title: 'On Tree Item Click',
        arguments: [this],
      };
    }

    this.originalLabel = label;
    this.tooltip = `${this.label} (${this.taskType})`;
    this.description = this.taskType;
    // Store the file URI but don't set resourceUri to avoid file decorations
    // resourceUri will only be set for dimming filtered items in updateContextValue
    if (resourceUri && !this.taskFileUri) {
      this.taskFileUri = resourceUri;
    }
    this.defaultIconPath = defaultIconPath;

    // Use TaskStateManager to generate variable-based persistent ID strictly matching TaskCacheService logic
    // This ensures that the ID generated here matches the ID generated when the cache is rebuilt
    this.id = TaskStateManager.getInstance().getTaskId(this);

    // Default open action
    // this will open the file, by default, to the start of the document.
    // it is up to the task creation to update/set this with settings
    // that will open the file to a specific location and to use `taskFileUri` if desired.
    if (!this.onOpenActionCommand && this.collapsibleState === vscode.TreeItemCollapsibleState.None) {
      this.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [this.taskFileUri || resourceUri, 0],
      };
    }

    this.updateContextValue();
  }

  public toJSON() {
    // Return a safe subset to avoid circular references during serialization
    // When passed to commands, we mainly need the ID to lookup the real instance
    return {
      id: this.id,
      label: this.label,
      taskType: this.taskType,
      contextValue: this.contextValue,
    };
  }

  public updateContextValue() {
    const filteredService = FilteredTaskService.getInstance();

    // Stored-secret items are managed separately — preserve their contextValue as-is.
    if (this.taskType === 'storedSecret') {
      this.contextValue = 'storedSecret';
      return;
    }

    if (
      this.taskType === 'workspace' ||
      this.taskType === 'folder' ||
      this.taskType === 'type' ||
      this.taskType === 'favorites' ||
      this.taskType === 'compoundTask' ||
      this.taskType === 'compoundTasks' ||
      this.taskType === 'recent' ||
      this.taskType === 'secrets'
    ) {
      // Check if this group is filtered
      const isFiltered = this.id ? filteredService.isFiltered(this.id) : false;
      let isFilteredOrParent = filteredService.isFilteredOrHasFilteredParent(this);

      // Check if all children are filtered (recursively)
      // If so, treat this group as effectively filtered (dimmed)
      if (!isFilteredOrParent && this.children && this.children.length > 0) {
        const checkChildren = (children: TaskItem[]): boolean => {
          return children.every((child) => {
            // Check if child itself is explicitly filtered
            // Try direct ID (for groups) and canonical ID (for tasks)
            const directId = child.id;
            const canonicalId = TaskStateManager.getInstance().getTaskId(child);

            if (directId && filteredService.isFiltered(directId)) {
              return true;
            }
            if (canonicalId && filteredService.isFiltered(canonicalId)) {
              return true;
            }

            // If child not explicitly filtered, check if it is a group with all children filtered
            if (child.children && child.children.length > 0) {
              return checkChildren(child.children);
            }

            // Leaf node, not filtered
            return false;
          });
        };

        if (checkChildren(this.children)) {
          isFilteredOrParent = true;
        }
      }

      // Resource URI includes dimmed fragment if filtered (explicitly or via parent)
      if (this.id) {
        this.resourceUri = vscode.Uri.from({
          scheme: 'workspace-tasks',
          path: this.iconDisplayUri?.path ?? '/group',
          query: this.id,
          fragment: isFilteredOrParent ? 'dimmed' : '',
        });
      }

      if (isFiltered) {
        // Add filtered prefix to group context value
        this.contextValue = 'filtered' + this.taskType.charAt(0).toUpperCase() + this.taskType.slice(1);
      } else if (this.taskType === 'compoundTask') {
        // Compound task groups can be favorited; reflect that in the context value
        const isFav = FavoritesService.getInstance().isFavorite(this);
        this.contextValue = isFav ? 'favoriteCompoundTask' : 'compoundTask';
      } else if (this.taskType === 'compoundTasks') {
        this.contextValue = 'compoundTasks';
      } else {
        this.contextValue = this.taskType;
      }
    } else {
      // It's a task leaf node
      const rawId = TaskStateManager.getInstance().getTaskId(this);
      // Strip the dedupe suffix ("|"+N) that TaskCacheService appends to compound task children
      // so they share status, filter, and favorite state with the original standalone task.
      const id = rawId.replace(/\|\d+$/, '');
      const status = TaskStateManager.getInstance().getStatus(id);
      const isFavorite = FavoritesService.getInstance().isFavorite(id);
      const isFiltered = filteredService.isFiltered(id);
      const isFilteredOrParent = filteredService.isFilteredOrHasFilteredParent(this);

      // resourceUri includes dimmed fragment if filtered (explicitly or via parent).
      // Use iconDisplayUri.path when present so the file icon theme can match the right
      // icon for a provider-specific filename (e.g. "package.json" → npm icon) without
      // interfering with workspace-tasks://-based decorations.  Fall back to taskFileUri
      // path so that the decoration provider can still dim hidden items.
      const leafIconPath = this.iconDisplayUri?.path ?? (this.taskFileUri ? this.taskFileUri.path : '/task');
      this.resourceUri = vscode.Uri.from({
        scheme: 'workspace-tasks',
        path: leafIconPath,
        query: id,
        fragment: isFilteredOrParent ? 'dimmed' : '',
      });

      // Determine base context value considering filtered state
      let baseContext = (this.taskType === 'jupyter') ? 'jupyterTask' : 'task';

      // If it was already set to queuedTask (manually by TreeDataProvider), we keep it
      // Note: This check relies on contextValue being set before updateContextValue call
      // which happens in constructor or by parent
      // ---
      /// The contextValue of `queuedTask` is a special case for tasks that are part of a compound task (formerly "queue") group. The name remains as `queuedTask` in the context value for backwards compatibility and to avoid breaking existing logic that may have been built around this context value before we renamed the feature to "compound tasks". When a task is added to a compound task, its contextValue is set to 'queuedTask' to allow specific menu items (e.g., "Remove from Compound Task") to be shown for these tasks. We check for this context value here and preserve it if already set, rather than overwriting it based on taskType. This allows us to maintain the special handling for tasks that are part of compound tasks while still supporting the new grouping and filtering logic.
      if (this.contextValue === 'queuedTask' || (this.contextValue && this.contextValue.includes('queuedTask'))) {
        baseContext = 'queuedTask';
      } else if (this.contextValue === 'recentTask' || (this.contextValue && this.contextValue.includes('recentTask'))) {
        baseContext = isFavorite ? 'favoriteRecentTask' : 'recentTask';
      } else if (isFavorite) {
        baseContext = 'favoriteTask';
      }

      // Add filtered prefix if the task is in the filtered set
      // This allows separate menu items for filtered tasks (e.g., "Unhide Task" vs "Hide Task")
      if (isFiltered) {
        baseContext = 'filtered' + baseContext.charAt(0).toUpperCase() + baseContext.slice(1);
      }

      if (status === 'running') {
        this.contextValue = 'running' + baseContext.charAt(0).toUpperCase() + baseContext.slice(1);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
      } else {
        this.contextValue = baseContext;

        if (status === 'success') {
          this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'failure') {
          this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        } else {
          this.iconPath = this.defaultIconPath; // Default
        }
      }
    }
  }
}
