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
  public taskFileUri?: vscode.Uri;
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

  // Static counter for ensure unique IDs within a session if needed,
  // though deterministic IDs are better for state preservation.
  private static idCounter = 0;

  public onOpenActionCommand?: vscode.Command;
  public onRunActionCommand?: vscode.Command;
  public onRunWithArgsActionCommand?: vscode.Command;

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

    if (
      this.taskType === 'workspace' ||
      this.taskType === 'folder' ||
      this.taskType === 'type' ||
      this.taskType === 'favorites' ||
      this.taskType === 'queue' ||
      this.taskType === 'recent'
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
          path: '/group',
          query: this.id,
          fragment: isFilteredOrParent ? 'dimmed' : '',
        });
      }

      if (isFiltered) {
        // Add filtered prefix to group context value
        this.contextValue = 'filtered' + this.taskType.charAt(0).toUpperCase() + this.taskType.slice(1);
      } else {
        this.contextValue = this.taskType;
      }
    } else {
      // It's a task leaf node
      const id = TaskStateManager.getInstance().getTaskId(this);
      const status = TaskStateManager.getInstance().getStatus(id);
      const isFavorite = FavoritesService.getInstance().isFavorite(id);
      const isFiltered = filteredService.isFiltered(id);
      const isFilteredOrParent = filteredService.isFilteredOrHasFilteredParent(this);

      // resourceUri includes dimmed fragment if filtered (explicitly or via parent)
      this.resourceUri = vscode.Uri.from({
        scheme: 'workspace-tasks',
        path: '/task',
        query: id,
        fragment: isFilteredOrParent ? 'dimmed' : ''
      });

      if (this.taskType === 'jupyter') {
        this.contextValue = 'jupyterTask';
      }

      if (status === 'running') {
        this.contextValue = 'runningTask';
        this.iconPath = new vscode.ThemeIcon('loading~spin');
      } else {
        // Determine base context value considering filtered state
        let baseContext = 'task';

        // If it was already set to queuedTask (manually by TreeDataProvider), we keep it
        if (this.contextValue === 'queuedTask') {
          baseContext = 'queuedTask';
        } else if (this.contextValue === 'recentTask') {
          baseContext = isFavorite ? 'favoriteRecentTask' : 'recentTask';
        } else if (isFavorite) {
          baseContext = 'favoriteTask';
        }

        // Add filtered prefix if the task is in the filtered set
        // This allows separate menu items for filtered tasks (e.g., "Unhide Task" vs "Hide Task")
        if (isFiltered) {
          baseContext = 'filtered' + baseContext.charAt(0).toUpperCase() + baseContext.slice(1);
        }

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
