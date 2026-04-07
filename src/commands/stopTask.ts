import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';
import { TaskCacheService } from '../services/taskCacheService';
import { configuration } from '../libs/configuration';

interface VscodeTaskDependencyObject {
  task?: string;
}

interface VscodeTaskDefinition {
  label?: string;
  dependsOn?: string | VscodeTaskDependencyObject | Array<string | VscodeTaskDependencyObject>;
}

interface VscodeTasksFile {
  tasks?: VscodeTaskDefinition[];
}

/**
 * Finds the terminal that belongs to a task by matching against common
 * naming conventions that VSCode uses for task terminals.
 *
 * An optional `terminals` array can be provided for testing; defaults to
 * `vscode.window.terminals`.
 */
export function findTerminalForTask(
  task: vscode.Task,
  terminals: readonly vscode.Terminal[] = vscode.window.terminals,
): vscode.Terminal | undefined {
  const name = task.name;
  const source = task.source;

  return terminals.find((t) =>
    t.name === name ||
    t.name === `${source}: ${name}` ||
    t.name === `Task - ${name}` ||
    t.name.includes(name),
  );
}

export function getCompoundDependencyLabels(tasksJsonText: string, taskLabel: string): string[] {
  let parsed: VscodeTasksFile;

  try {
    parsed = JSON.parse(tasksJsonText);
  } catch {
    const jsonText = tasksJsonText
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*/gm, '')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    parsed = JSON.parse(jsonText);
  }

  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const dependsOnByLabel = new Map<string, string[]>();

  for (const task of tasks) {
    if (!task.label) {
      continue;
    }

    const dependsOn = task.dependsOn;
    const labels: string[] = [];

    if (typeof dependsOn === 'string') {
      labels.push(dependsOn);
    } else if (Array.isArray(dependsOn)) {
      for (const dep of dependsOn) {
        if (typeof dep === 'string') {
          labels.push(dep);
          continue;
        }

        if (dep && typeof dep.task === 'string') {
          labels.push(dep.task);
        }
      }
    } else if (dependsOn && typeof dependsOn.task === 'string') {
      labels.push(dependsOn.task);
    }

    dependsOnByLabel.set(task.label, labels);
  }

  const visited = new Set<string>();
  const result = new Set<string>();

  const visit = (label: string) => {
    if (visited.has(label)) {
      return;
    }
    visited.add(label);

    const dependencies = dependsOnByLabel.get(label) ?? [];
    for (const dependency of dependencies) {
      if (!dependency || dependency === taskLabel) {
        continue;
      }
      result.add(dependency);
      visit(dependency);
    }
  };

  visit(taskLabel);
  return Array.from(result);
}

export class StopTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    const stateManager = TaskStateManager.getInstance();
    const id = stateManager.getTaskId(item);
    const execution = stateManager.getExecution(id);

    if (!execution) {
      this.logger.debug(
        `[StopTask] No primary execution tracked for '${item.label}' (${id}). Attempting dependency stop only.`,
      );
      await this.stopCompoundDependencies(item, id, 'no-primary-execution');
      return;
    }

    // Second click while a graceful-stop timer is already pending → force kill now.
    if (stateManager.getStopTimer(id)) {
      stateManager.clearStopTimer(id);
      stateManager.markTerminated(id);
      await this.stopCompoundDependencies(item, id, 'force-stop-second-click');
      execution.terminate();
      return;
    }

    // Resolve dependency IDs up-front so we can decide the stop strategy before
    // anything has a chance to exit and trigger the next step in the sequence.
    const dependencyIds = await this.getCompoundDependencyTaskIds(item);

    if (dependencyIds.length > 0) {
      // Compound task — terminate the orchestration execution FIRST.
      // If we send SIGINT to the running dependency before killing the orchestration,
      // VS Code may detect the dependency exit and immediately schedule the next one.
      this.logger.debug(
        `[StopTask] Terminating compound task orchestration immediately to prevent next dependency from starting: '${item.label}' (${id}).`,
      );
      stateManager.markTerminated(id);
      execution.terminate();
      // Now gracefully stop any currently-running dependencies.
      await this.stopCompoundDependencies(item, id, 'compound-stop', dependencyIds);
      return;
    }

    // Regular (non-compound) task: graceful SIGINT with timeout fallback.
    const terminal = stateManager.getTerminal(id) ?? findTerminalForTask(execution.task);
    if (terminal) {
      // Send SIGINT (Ctrl+C) — the process gets a chance to shut down gracefully
      // and the terminal window is preserved.
      terminal.sendText('\u0003', false);

      // graceful-stop timeout should come from configuration at workspaceTasks.task.stopGracefulDelayMilliseconds
      const timeout = configuration.get<number>('task.stopGracefulDelayMilliseconds', 5000);
      // Schedule a fallback force-kill in case the process ignores the signal.
      const timer = (globalThis as any).setTimeout(() => {
        stateManager.clearStopTimer(id);
        // Only terminate if the task is still tracked as running.
        if (stateManager.getExecution(id) === execution) {
          stateManager.markTerminated(id);
          execution.terminate();
        }
      }, timeout);

      stateManager.setStopTimer(id, timer);
    } else {
      // No terminal reference found — fall back to immediate hard kill.
      stateManager.markTerminated(id);
      execution.terminate();
    }
  }

  /**
   * Stops all running compound dependencies of the given task.
   * Accepts an optional `preloadedDependencyIds` array to avoid re-fetching when the
   * caller has already resolved the IDs (e.g. to decide the stop order).
   */
  private async stopCompoundDependencies(
    item: TaskItem,
    taskId: string,
    trigger: string,
    preloadedDependencyIds?: string[],
  ): Promise<void> {
    const shouldStopDependencies = configuration.get<boolean>('task.stopCompoundDependencies', true);

    if (!shouldStopDependencies) {
      this.logger.debug(
        `[StopTask] Compound dependency stopping disabled for '${item.label}' (${taskId}). Trigger: ${trigger}.`,
      );
      return;
    }

    const dependencyIds = preloadedDependencyIds ?? await this.getCompoundDependencyTaskIds(item);

    if (dependencyIds.length === 0) {
      this.logger.debug(
        `[StopTask] No compound dependencies identified for '${item.label}' (${taskId}). Trigger: ${trigger}.`,
      );
      return;
    }

    const stateManager = TaskStateManager.getInstance();
    let gracefulCount = 0;
    let forcedCount = 0;

    for (const dependencyId of dependencyIds) {
      if (dependencyId === taskId) {
        continue;
      }

      const dependencyExecution = stateManager.getExecution(dependencyId);
      if (!dependencyExecution) {
        // This dependency hasn't started yet — block it so that if VSCode's
        // compound sequential runner tries to start it after the current
        // dependency exits (even via SIGINT), it will be immediately terminated.
        stateManager.blockTask(dependencyId);
        continue;
      }

      // Second stop request while a graceful-stop timer exists for the dependency
      // means we should force terminate it immediately.
      if (stateManager.getStopTimer(dependencyId)) {
        stateManager.clearStopTimer(dependencyId);
        stateManager.markTerminated(dependencyId);
        dependencyExecution.terminate();
        forcedCount += 1;
        continue;
      }

      const terminal = stateManager.getTerminal(dependencyId) ?? findTerminalForTask(dependencyExecution.task);
      if (terminal) {
        terminal.sendText('\u0003', false);

        const timeout = configuration.get<number>('task.stopGracefulDelayMilliseconds', 5000);
        const timer = (globalThis as any).setTimeout(() => {
          stateManager.clearStopTimer(dependencyId);
          if (stateManager.getExecution(dependencyId) === dependencyExecution) {
            stateManager.markTerminated(dependencyId);
            dependencyExecution.terminate();
            this.logger.debug(
              `[StopTask] Graceful stop timed out for dependency (${dependencyId}); forced termination applied. Trigger: ${trigger}.`,
            );
          }
        }, timeout);

        stateManager.setStopTimer(dependencyId, timer);
        gracefulCount += 1;
        continue;
      }

      stateManager.clearStopTimer(dependencyId);
      stateManager.markTerminated(dependencyId);
      dependencyExecution.terminate();
      forcedCount += 1;
    }

    if (gracefulCount === 0 && forcedCount === 0) {
      this.logger.debug(
        `[StopTask] Dependencies identified but none are currently running for '${item.label}' (${taskId}). Trigger: ${trigger}. Dependency IDs: ${dependencyIds.join(', ')}`,
      );
    } else {
      this.logger.debug(
        `[StopTask] Dependency stop summary for '${item.label}' (${taskId}). Trigger: ${trigger}. Graceful: ${gracefulCount}, Forced: ${forcedCount}.`,
      );
    }
  }

  private async getCompoundDependencyTaskIds(item: TaskItem): Promise<string[]> {
    const stateManager = TaskStateManager.getInstance();
    const canonicalId = stateManager.getTaskId(item);
    const canonicalItem = TaskCacheService.getInstance().getTaskById(canonicalId);

    const sourceTaskFileUri = item.taskFileUri ?? canonicalItem?.taskFileUri;
    if (!sourceTaskFileUri) {
      this.logger.debug(
        `[StopTask] Cannot resolve compound dependencies for '${item.label}' (${canonicalId}): missing task file URI.`,
      );
      return [];
    }

    const taskFileUri = sourceTaskFileUri;
    if (taskFileUri.scheme !== 'file') {
      this.logger.debug(
        `[StopTask] Cannot resolve compound dependencies for '${item.label}' (${canonicalId}): task file URI is not a file URI (${taskFileUri.scheme}).`,
      );
      return [];
    }

    let text: string;
    try {
      const document = await vscode.workspace.openTextDocument(taskFileUri);
      text = document.getText();
    } catch {
      this.logger.debug(
        `[StopTask] Failed to open task file for compound dependency resolution: ${taskFileUri.fsPath}.`,
      );
      return [];
    }

    const taskLabel = canonicalItem?.originalLabel || canonicalItem?.label || item.originalLabel || item.label;

    let dependencyLabels: string[];
    try {
      dependencyLabels = getCompoundDependencyLabels(text, taskLabel);
    } catch {
      this.logger.debug(
        `[StopTask] Failed to parse task dependencies from ${taskFileUri.fsPath} for task '${taskLabel}'.`,
      );
      return [];
    }

    if (dependencyLabels.length === 0) {
      return [];
    }

    const taskFilePath = taskFileUri.fsPath;
    const lowerCaseLabels = new Set(dependencyLabels.map(label => label.toLowerCase()));
    const taskItems = TaskCacheService.getInstance().getAllTasks();
    const dependencyIds = new Set<string>();

    for (const taskItem of taskItems) {
      if (taskItem.taskType !== 'vscode') {
        continue;
      }

      if (!taskItem.taskFileUri || taskItem.taskFileUri.fsPath !== taskFilePath) {
        continue;
      }

      const candidateLabel = (taskItem.originalLabel || taskItem.label).toLowerCase();
      if (!lowerCaseLabels.has(candidateLabel)) {
        continue;
      }

      const canonicalId = stateManager.getTaskId(taskItem);
      dependencyIds.add(canonicalId);

      // When duplicate IDs are deconflicted with a "|N" suffix in cache,
      // include the unsuffixed base ID as a fallback because running executions
      // can map to either instance depending on matching order.
      const baseId = canonicalId.replace(/\|\d+$/, '');
      dependencyIds.add(baseId);
    }

    return Array.from(dependencyIds);
  }
}
