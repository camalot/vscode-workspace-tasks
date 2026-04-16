import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

const GUARD_STATE_KEY = 'workspaceTasks.guardedTasks';
const PATTERNS_SETTING = 'workspaceTasks.task.confirmPatterns';

export class TaskRunGuardService {
  private static _instance: TaskRunGuardService;
  private _context!: vscode.ExtensionContext;
  private _manualGuardIds: Set<string> = new Set();
  private _patterns: RegExp[] = [];
  private _onDidChangeGuards: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeGuards: vscode.Event<void> = this._onDidChangeGuards.event;

  private constructor() {}

  public static getInstance(): TaskRunGuardService {
    if (!TaskRunGuardService._instance) {
      TaskRunGuardService._instance = new TaskRunGuardService();
    }
    return TaskRunGuardService._instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    // Load Solution C manual guards from workspaceState
    const stored = context.workspaceState.get<string[]>(GUARD_STATE_KEY, []);
    this._manualGuardIds = new Set(stored);
    // Load Solution A patterns from settings
    this._refreshPatterns();
    // Refresh patterns when settings change
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(PATTERNS_SETTING)) {
          this._refreshPatterns();
          this._onDidChangeGuards.fire();
        }
      })
    );
  }

  /** True if the item is guarded by any source (C > B > A). */
  public isGuarded(item: TaskItem): boolean {
    // Solution C — manual workspaceState toggle
    // Normalize the ID so fav:/recent:/compound-task: prefixes are stripped before lookup.
    const canonicalId = TaskStateManager.getInstance().normalizeTaskId(item.id ?? '');
    if (this._manualGuardIds.has(canonicalId)) { return true; }
    // Solution B — definition-level flag from .workspace-tasks.json
    if (item.guardedByDefinition === true) { return true; }
    // Solution A — pattern matching against the task's original label
    const label = item.originalLabel ?? (typeof item.label === 'string' ? item.label : '');
    return this._patterns.some((p) => p.test(label));
  }

  /**
   * Checks manual guards using only a task ID string.
   * Strips known ID prefixes (fav:, compound-task:<name>:) before lookup.
   * Used by the decoration provider for items not in the task cache.
   */
  public isGuardedById(taskId: string): boolean {
    // Delegate normalization to TaskStateManager so all prefix-stripping is consistent.
    const id = TaskStateManager.getInstance().normalizeTaskId(taskId);
    if (this._manualGuardIds.has(id)) { return true; }
    // Cannot resolve label from ID alone reliably — pattern guards require a TaskItem.
    // For decoration purposes, manual-guard-only is sufficient for clone items.
    return false;
  }

  /**
   * If the item is guarded, shows a modal confirmation dialog.
   * Returns true to proceed, false if the user cancelled.
   */
  public async confirmIfNeeded(item: TaskItem): Promise<boolean> {
    if (!this.isGuarded(item)) { return true; }
    const label = item.originalLabel ?? (typeof item.label === 'string' ? item.label : 'this task');
    const choice = await vscode.window.showWarningMessage(
      `"${label}" is marked as a guarded task. Are you sure you want to run it?`,
      { modal: true },
      'Run Task'
    );
    return choice === 'Run Task';
  }

  /** Add a manual guard (Solution C). */
  public async addGuard(item: TaskItem): Promise<void> {
    // Always store the canonical (prefix-stripped) ID so that guard state is shared
    // across the regular task list, the Favorites section, and the Recents section.
    const id = TaskStateManager.getInstance().normalizeTaskId(item.id ?? '');
    if (!id || this._manualGuardIds.has(id)) { return; }
    this._manualGuardIds.add(id);
    await this._save();
    this._onDidChangeGuards.fire();
  }

  /** Remove a manual guard (Solution C). */
  public async removeGuard(item: TaskItem): Promise<void> {
    const id = TaskStateManager.getInstance().normalizeTaskId(item.id ?? '');
    if (!this._manualGuardIds.has(id)) { return; }
    this._manualGuardIds.delete(id);
    await this._save();
    this._onDidChangeGuards.fire();
  }

  /** True if item has an explicit manual guard (regardless of pattern/definition). */
  public isManuallyGuarded(id: string): boolean {
    const normalizedId = TaskStateManager.getInstance().normalizeTaskId(id);
    return this._manualGuardIds.has(normalizedId);
  }

  private async _save(): Promise<void> {
    await this._context.workspaceState.update(GUARD_STATE_KEY, [...this._manualGuardIds]);
  }

  private _refreshPatterns(): void {
    const raw = vscode.workspace.getConfiguration('workspaceTasks').get<string[]>('task.confirmPatterns', []);
    this._patterns = [];
    for (const entry of raw) {
      try {
        this._patterns.push(new RegExp(entry, 'i'));
      } catch {
        // Skip invalid regex patterns silently
      }
    }
  }
}
