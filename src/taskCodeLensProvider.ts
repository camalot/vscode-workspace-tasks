import * as vscode from 'vscode';
import { TaskCacheService } from './services/taskCacheService';
import { FilteredTaskService } from './services/filteredTaskService';
import { FavoritesService } from './services/favoritesService';
import { TaskStateManager } from './taskStateManager';
import { TaskItem } from './taskItem';
import { isLeafTask } from './tools/taskToolsUtils';

/**
 * Provides inline CodeLens actions above task definitions in task source files.
 *
 * For every located leaf task in an open file the provider emits one or more
 * CodeLens items that mirror the action-bar buttons shown on the corresponding
 * tree-view task item:
 *  - Run Task / Stop Task
 *  - Run with Args
 *  - Add / Remove from Favorites
 *  - Add / Remove from Compound Task
 *  - Hide Task
 *  - Unhide Task (show-hidden mode only)
 *
 * The set of lenses respects the same `workspaceTasks.task.actionBar.*` flags
 * that control tree-view inline buttons, and can be completely disabled via
 * `workspaceTasks.codeLens.enabled`.
 */
export class TaskCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private readonly _subscriptions: vscode.Disposable[] = [];

  constructor(_context: vscode.ExtensionContext) {
    this._subscriptions.push(
      // Invalidate on task cache update (new tasks discovered or reloaded)
      TaskCacheService.getInstance().onDidUpdate(() =>
        this._onDidChangeCodeLenses.fire()
      ),

      // Invalidate when any workspaceTasks setting changes (actionBar flags, codeLens.enabled, …)
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workspaceTasks')) {
          this._onDidChangeCodeLenses.fire();
        }
      }),

      // Invalidate when a task is hidden or unhidden
      FilteredTaskService.getInstance().onDidChange(() =>
        this._onDidChangeCodeLenses.fire()
      ),

      // Invalidate when favorites change so the Add/Remove favorite lens reflects current state
      FavoritesService.getInstance().onDidChangeFavorites(() =>
        this._onDidChangeCodeLenses.fire()
      ),

      // Invalidate on task status change, but only when the affected task's file
      // is currently open — avoids a global invalidation storm for every running task.
      TaskStateManager.getInstance().onDidStateChange(({ id }) => {
        const task = TaskCacheService.getInstance().getTask(id);
        if (task?.taskFileUri) {
          const openUris = vscode.window.visibleTextEditors.map(
            (e) => e.document.uri.toString()
          );
          if (openUris.includes(task.taskFileUri.toString())) {
            this._onDidChangeCodeLenses.fire();
          }
        }
      }),
    );
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    // Guard: workspace trust
    if (!vscode.workspace.isTrusted) { return []; }

    // Guard: master on/off switch
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    if (!config.get<boolean>('codeLens.enabled', true)) { return []; }

    // Fast path: O(1) Map check — avoids heavier work for non-task files
    if (!TaskCacheService.getInstance().hasTasksForFile(document.uri)) { return []; }

    // Honour cancellation after the cheap lookup
    if (token.isCancellationRequested) { return []; }

    const allTasks = TaskCacheService.getInstance().getTasksForFile(document.uri);
    const filteredService = FilteredTaskService.getInstance();
    const showHidden = filteredService.isShowHiddenMode();

    // Deduplicate before split: multiple providers (e.g. npm, bun, pnpm, yarn) all
    // index the same file and emit tasks with identical (startLine, label) tuples.
    // Keep only the first occurrence (first-registered provider).
    const locatedUnique = this._deduplicateByLine(
      allTasks.filter((t) => isLeafTask(t) && t.startLine !== undefined),
    );

    const visibleTasks = locatedUnique.filter(
      (t) => !filteredService.isFilteredOrHasFilteredParent(t),
    );
    const hiddenTasks = showHidden
      ? locatedUnique.filter((t) => filteredService.isFilteredOrHasFilteredParent(t))
      : [];

    if (visibleTasks.length + hiddenTasks.length === 0) { return []; }

    const actionBar = config.get<Record<string, boolean>>('task.actionBar') ?? {};
    const lenses: vscode.CodeLens[] = [];

    for (const task of visibleTasks) {
      lenses.push(...this._buildVisibleLensRow(task, actionBar));
    }
    for (const task of hiddenTasks) {
      lenses.push(...this._buildHiddenLensRow(task, actionBar));
    }
    return lenses;
  }

  // resolveCodeLens is intentionally not implemented — all lens data (title, command,
  // range) is synchronously available at provideCodeLenses time so the two-phase API
  // provides no benefit.

  /**
   * Deduplicates tasks by (startLine, label) key, keeping the first occurrence.
   * Multiple providers (e.g. npm, bun, pnpm, yarn) can each emit tasks for the same
   * script at the same line, which would otherwise produce duplicate CodeLens rows.
   */
  private _deduplicateByLine(tasks: TaskItem[]): TaskItem[] {
    const seen = new Set<string>();
    return tasks.filter((t) => {
      const key = `${t.startLine}|${String(t.label)}`;
      if (seen.has(key)) { return false; }
      seen.add(key);
      return true;
    });
  }

  private _buildVisibleLensRow(
    task: TaskItem,
    actionBar: Record<string, boolean>,
  ): vscode.CodeLens[] {
    const range = new vscode.Range(task.startLine!, 0, task.startLine!, 0);
    const lenses: vscode.CodeLens[] = [];
    const status = TaskStateManager.getInstance().getStatus(task.id ?? '');
    const isFavorite = FavoritesService.getInstance().isFavorite(task.id ?? '');
    const isQueued = task.contextValue?.includes('queuedTask') ?? false;

    if (actionBar['run'] !== false) {
      if (status === 'running') {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(debug-stop) Stop Task',
          command: 'workspaceTasks.stopTask',
          arguments: [task],
        }));
      } else {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(debug-start) Run Task',
          command: 'workspaceTasks.runTask',
          arguments: [task],
        }));
      }
    }

    if (actionBar['runWithArgs'] !== false && status !== 'running') {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(debug-continue) Run with Args',
        command: 'workspaceTasks.runTaskWithArgs',
        arguments: [task],
      }));
    }

    if (actionBar['favorite'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: isFavorite ? '$(star-full) Remove from Favorites' : '$(star) Add to Favorites',
        command: isFavorite
          ? 'workspaceTasks.removeFromFavorites'
          : 'workspaceTasks.addToFavorites',
        arguments: [task],
      }));
    }

    if (actionBar['queue'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: isQueued
          ? '$(trash) Remove from Compound Task'
          : '$(list-unordered) Add to Compound Task',
        command: isQueued
          ? 'workspaceTasks.removeFromCompoundTask'
          : 'workspaceTasks.addToCompoundTask',
        arguments: [task],
      }));
    }

    if (actionBar['hide'] !== false) {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(eye-closed) Hide Task',
        command: 'workspaceTasks.hideTask',
        arguments: [task],
      }));
    }

    return lenses;
  }

  private _buildHiddenLensRow(
    task: TaskItem,
    actionBar: Record<string, boolean>,
  ): vscode.CodeLens[] {
    if (actionBar['unhide'] === false) { return []; }
    const range = new vscode.Range(task.startLine!, 0, task.startLine!, 0);
    return [new vscode.CodeLens(range, {
      title: '$(eye) Unhide Task',
      command: 'workspaceTasks.unhideTask',
      arguments: [task],
    })];
  }

  public dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    for (const d of this._subscriptions) { d.dispose(); }
    this._subscriptions.length = 0;
  }
}
