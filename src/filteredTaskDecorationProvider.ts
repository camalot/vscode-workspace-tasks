import * as vscode from 'vscode';
import { FilteredTaskService } from './services/filteredTaskService';

/**
 * Provides file decorations (dimming) for filtered tasks and groups when in show hidden mode
 */
export class FilteredTaskDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  >();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> =
    this._onDidChangeFileDecorations.event;

  constructor() {
    // Listen for changes to filtered tasks or show hidden mode
    const filteredService = FilteredTaskService.getInstance();

    // Watch for changes to show hidden mode
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workspaceTasks')) {
        this.refresh();
      }
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only provide decorations for workspace-tasks scheme
    if (uri.scheme !== 'workspace-tasks') {
      return undefined;
    }

    const filteredService = FilteredTaskService.getInstance();
    const isShowHiddenMode = filteredService.isShowHiddenMode();

    // Only apply dimming when in show hidden mode
    if (!isShowHiddenMode) {
      return undefined;
    }

    // Check if the task/group identified by the URI is filtered
    // Use query parameter which preserves the ID exactly without URI path parsing issues
    const taskId = uri.query;
    const isDimmed = uri.fragment === 'dimmed';

    if (filteredService.isFiltered(taskId) || isDimmed) {
      // Return a decoration with propagate: true to dim the item
      return {
        propagate: true, // Apply to children as well
        badge: '●',
        color: new vscode.ThemeColor('disabledForeground'),
        tooltip: 'This task is hidden',
      };
    }

    return undefined;
  }

  /**
   * Trigger a refresh of all decorations
   */
  refresh(): void {
    this._onDidChangeFileDecorations.fire(undefined as any);
  }
}
