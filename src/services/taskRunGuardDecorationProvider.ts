import * as vscode from 'vscode';
import { TaskRunGuardService } from './taskRunGuardService';
import { TaskCacheService } from './taskCacheService';

/**
 * Provides file decorations (🛡️ badge) for guarded tasks in the tree view.
 */
export class TaskRunGuardDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor() {
    // Subscribe once; fire the file-decorations event on any guard change so VS Code
    // re-evaluates provideFileDecoration for all workspace-tasks scheme URIs.
    TaskRunGuardService.getInstance().onDidChangeGuards(() => {
      this._onDidChange.fire(undefined as any);
    });
    // Also re-evaluate decorations when the task cache rebuilds, so that
    // definition-level guards (guardedByDefinition from confirm:true in
    // .workspace-tasks.json) are reflected immediately after a file save.
    TaskCacheService.getInstance().onDidUpdate(() => {
      this._onDidChange.fire(undefined as any);
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'workspace-tasks') { return undefined; }
    // The task ID is stored in uri.query (matching the FilteredTaskDecorationProvider pattern)
    const taskId = uri.query;
    if (!taskId) { return undefined; }

    // Attempt full guard evaluation using the cached TaskItem (all three guard sources).
    // Falls back to manual-guard-only check when the cache item cannot be found
    // (e.g., compound-task clone IDs — handled by isGuardedById's prefix stripping).
    const guardService = TaskRunGuardService.getInstance();
    const cacheItem = TaskCacheService.getInstance().getTaskById(taskId);
    const isGuarded = cacheItem
      ? guardService.isGuarded(cacheItem)
      : guardService.isGuardedById(taskId);

    if (!isGuarded) { return undefined; }

    return {
      badge: '🛡️',
      tooltip: 'This task requires confirmation before running',
      propagate: false,
    };
  }
}
