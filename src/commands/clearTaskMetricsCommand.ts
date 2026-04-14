import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskMetricsService } from '../services/taskMetricsService';

/**
 * Builds the metrics storage key for a TaskItem using the same convention as
 * TaskHistoryService: `${source}:${name}:${scope}`.
 */
function buildMetricsKey(item: TaskItem): string {
  const scope =
    !item.task?.scope
      ? 'global'
      : typeof item.task.scope === 'object'
        ? (item.task.scope as vscode.WorkspaceFolder).name
        : (item.task.scope.toString() || 'global');
  return `${item.taskSource}:${item.task?.name ?? item.label}:${scope}`;
}

/**
 * Command to clear metrics for a single task (via context menu).
 * Registered as `workspaceTasks.metrics.clearTask`.
 */
export class MetricsClearTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('metrics.clearTask', context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (!item) { return; }
    TaskMetricsService.getInstance().clearMetrics(buildMetricsKey(item));
  }
}

/**
 * Command to clear all collected task metrics (command palette / view/title).
 * Registered as `workspaceTasks.metrics.clearAll`.
 */
export class MetricsClearAllCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('metrics.clearAll', context);
  }

  async run(): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      'Clear all task metrics data? This cannot be undone.',
      { modal: true },
      'Clear All'
    );
    if (answer !== 'Clear All') { return; }
    TaskMetricsService.getInstance().clearAllMetrics();
  }
}

/**
 * Command to clear task metrics for the current workspace only.
 * When metrics scope is `global` or `both`, the global store is shared across
 * workspaces; this command removes only entries belonging to the current
 * workspace folders and leaves other workspaces' data intact.
 * Registered as `workspaceTasks.metrics.clearWorkspace`.
 */
export class MetricsClearWorkspaceCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('metrics.clearWorkspace', context);
  }

  async run(): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      'Clear all task metrics for this workspace? This cannot be undone.',
      { modal: true },
      'Clear'
    );
    if (answer !== 'Clear') { return; }
    const folderNames = (vscode.workspace.workspaceFolders ?? []).map((f) => f.name);
    TaskMetricsService.getInstance().clearCurrentWorkspaceMetrics(folderNames);
  }
}
