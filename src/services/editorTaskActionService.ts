import * as vscode from 'vscode';
import { TaskCacheService } from './taskCacheService';
import constants from '../libs/constants';

export class EditorTaskActionService {
  private static instance: EditorTaskActionService;
  private _updateTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor() {}

  public static getInstance(): EditorTaskActionService {
    if (!EditorTaskActionService.instance) {
      EditorTaskActionService.instance = new EditorTaskActionService();
    }
    return EditorTaskActionService.instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateContext(editor))
    );
    context.subscriptions.push(
      TaskCacheService.getInstance().onDidUpdate(() => this.scheduleUpdate())
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.updateContext(vscode.window.activeTextEditor))
    );
    // Set initial context immediately (not debounced) on activation
    this.updateContext(vscode.window.activeTextEditor);
  }

  /** Debounced update — used when reacting to cache updates to avoid burst on startup. */
  private scheduleUpdate(): void {
    clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => this.updateContext(vscode.window.activeTextEditor), 75);
  }

  /** Updates the editor title bar context key. */
  public updateContext(editor?: vscode.TextEditor): void {
    const uri = editor?.document.uri;
    const isRunnable = this.isRunnableFile(uri);
    vscode.commands.executeCommand(
      'setContext',
      'workspaceTasks.activeFileIsRunnableTask',
      isRunnable
    );
  }

  /** Returns true when the URI belongs to a workspace file that has at least one runnable task. */
  public isRunnableFile(uri: vscode.Uri | undefined): boolean {
    if (!uri || uri.scheme !== 'file') {
      return false;
    }
    if (!vscode.workspace.isTrusted) {
      return false;
    }
    const tasks = TaskCacheService.getInstance().getTasksForFile(uri);
    return tasks.some(t => constants.RUNNABLE_TASK_TYPES.has(t.taskType));
  }
}
