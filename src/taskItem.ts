import * as vscode from 'vscode';
import { TaskStateManager } from './taskStateManager';
import { FavoritesService } from './services/favoritesService';

export class TaskItem extends vscode.TreeItem {
  public children: TaskItem[] = [];
  public startLine: number | undefined;
  public originalLabel: string;
  public defaultIconPath: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined;
  public taskSource: string | undefined;
  public taskFileUri?: vscode.Uri;
  public parent?: TaskItem;
  public metadata?: any;

  // Static counter for ensure unique IDs within a session if needed,
  // though deterministic IDs are better for state preservation.
  private static idCounter = 0;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly taskType: string,
    public readonly resourceUri?: vscode.Uri,
    public command?: vscode.Command,
    defaultIconPath?: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }
  ) {
    super(label, collapsibleState);
    // Deterministic ID base
    const baseId = `${taskType}:${label}:${resourceUri?.toString() || 'workspace'}`;
    // Verify if we need uniqueness for duplicates?
    // We will handle duplicates by appending a counter at the Provider/Tree construction level if needed,
    // but let's just use a simple counter here to ensure technical uniqueness to avoid the error.
    // However, this breaks state preservation across refreshes.
    // Better: Use the baseId. The TreeProvider should ensure it doesn't create duplicate logical items.
    // If we really have duplicate tasks, we should distinguish them (e.g. by provider source).
    this.id = baseId;
    this.originalLabel = label;
    this.tooltip = `${this.label} (${this.taskType})`;
    this.description = this.taskType;
    this.resourceUri = resourceUri;
    this.defaultIconPath = defaultIconPath;

    this.updateContextValue();
  }

  public updateContextValue() {
    if (this.taskType === 'workspace' || this.taskType === 'folder' || this.taskType === 'type' || this.taskType === 'favorites' || this.taskType === 'queue' || this.taskType === 'recent') {
      this.contextValue = this.taskType;
    } else {
      // It's a task leaf node
      const id = TaskStateManager.getInstance().getTaskId(this);
      const status = TaskStateManager.getInstance().getStatus(id);
      const isFavorite = FavoritesService.getInstance().isFavorite(id);

      if (status === 'running') {
        this.contextValue = 'runningTask';
        this.iconPath = new vscode.ThemeIcon('loading~spin');
      } else {
        // If it was already set to queuedTask (manually by TreeDataProvider), we keep it
        if (this.contextValue !== 'queuedTask') {
            // For favorites view, we want to ensure it has 'favoriteTask' context value
            // But if it is running, it takes precedence above.

            // Should we have a specific 'favoriteTask' context?
            // If the item is in the favorites LIST, it should definitely be 'favoriteTask'.
            // If it is in the normal list, but is favorited, it should ALSO be 'favoriteTask' (to show "Remove") or maybe we want a distinct value?
            // The existing logic was: isFavorite ? 'favoriteTask' : 'task'.
            // This works for both locations if we want "Remove" available on both.
            // But maybe the user wants 'favoriteTask' to imply "In Favorites Group".
            // The issue report says: "interaction buttons include Add to Favorites, not Remove".
            // This implies isFavorite is FALSE during the check.

            this.contextValue = isFavorite ? 'favoriteTask' : 'task';
        }

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
