import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';
import { TaskCacheService } from '../services/taskCacheService';
import { configuration } from '../libs/configuration';
import { CompoundTaskService } from '../services/compoundTaskService';
import { getCircleCiWorkflowRunId } from '../libs/circleCiWorkflowRunId';

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

/** Signals that can be used to force-stop a running task. */
export type ForceStopSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

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

  return terminals.find((t) => {
    if (t.name === name) { return true; }
    if (t.name === `${source}: ${name}`) { return true; }
    return t.name === `Task - ${name}`;
  });
}

/**
 * Kills the task process using the given signal while preserving the terminal
 * window when possible.
 *
 * - **SIGINT**: Sends the interrupt character (`\u0003`) via the terminal so the TTY
 *   layer handles it. This always preserves the terminal panel.
 * - **SIGTERM / SIGKILL**: When the task's `presentation.close` is `false` and a
 *   terminal with a known process ID is available, kills the shell process directly
 *   via the OS. This causes VSCode to treat the exit as natural and keep the panel
 *   open. Falls back to `execution.terminate()` otherwise.
 *
 * Falls back to `execution.terminate()` when:
 * - `presentation.close` is `true` (user wants the terminal closed on task end)
 * - No terminal reference is provided
 * - The terminal's process ID is unavailable
 * - The OS-level kill call throws unexpectedly
 */
export async function forceKillPreservingTerminal(
  terminal: vscode.Terminal | undefined,
  execution: vscode.TaskExecution,
  signal: ForceStopSignal = 'SIGKILL',
): Promise<void> {
  // SIGINT via terminal sendText is the most reliable method and always preserves the terminal.
  if (signal === 'SIGINT' && terminal !== undefined) {
    terminal.sendText('\u0003', false);
    return;
  }

  const shouldClose = execution.task.presentationOptions?.close ?? false;
  if (!shouldClose && terminal !== undefined) {
    const shellPid = await terminal.processId;
    if (shellPid !== undefined) {
      try {
        process.kill(shellPid, signal);
        return;
      } catch {
        // Process already exited or kill failed — fall through to execution.terminate()
      }
    }
  }
  execution.terminate();
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

  function visit(label: string): void {
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
  }

  visit(taskLabel);
  return Array.from(result);
}

export class StopTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopTask', context);
  }

  /**
   * Resolves the signal to use when force-stopping a task.
   *
   * If `workspaceTasks.task.forceStopMethod` is set to a specific signal
   * (`SIGINT`, `SIGTERM`, or `SIGKILL`), that signal is used directly.
   * When set to `ask` (the default), a QuickPick is shown so the user can
   * choose interactively. Returns `undefined` if the user dismisses the picker.
   */
  private async resolveForceStopSignal(): Promise<ForceStopSignal | undefined> {
    const method = configuration.get<string>('task.forceStopMethod', 'ask');
    if (method === 'SIGINT' || method === 'SIGTERM' || method === 'SIGKILL') {
      return method as ForceStopSignal;
    }
    // 'ask' — show a QuickPick so the user can choose
    const items: vscode.QuickPickItem[] = [
      {
        label: 'SIGINT',
        description: 'Interrupt (Ctrl+C)',
        detail: 'Sends a second interrupt signal. Safe for most processes; the terminal is preserved.',
      },
      {
        label: 'SIGTERM',
        description: 'Terminate',
        detail: 'Requests the process to exit gracefully. The terminal is preserved when possible.',
      },
      {
        label: 'SIGKILL',
        description: 'Force kill',
        detail: 'Immediately kills the process. Cannot be caught or ignored. The terminal is preserved when possible.',
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Force Stop Task',
      placeHolder: 'The task did not respond to SIGINT. Choose how to force stop it.',
    });
    return picked?.label as ForceStopSignal | undefined;
  }

  async run(item: TaskItem): Promise<void> {
    if (item?.id) {
      const cached = TaskCacheService.getInstance().getTask(item.id);
      if (cached) {
        item = cached;
      }
    }

    const stateManager = TaskStateManager.getInstance();
    const id = stateManager.getTaskId(item);
    const execution = stateManager.getExecution(id);

    if (item.taskType === 'circleci' && item.metadata?.type === 'workflow') {
      const runIdFromMeta = typeof item.metadata?.workflowRunId === 'string' ? item.metadata.workflowRunId : undefined;
      const workflowRunId = runIdFromMeta || getCircleCiWorkflowRunId(item);
      if (workflowRunId) {
        const compoundTaskService = CompoundTaskService.getInstance();
        compoundTaskService.cancelCompoundTask(workflowRunId);

        const workflowJobs = compoundTaskService.getCompoundTask(workflowRunId) ?? [];
        for (const workflowJob of workflowJobs) {
          const jobId = stateManager.getTaskId(workflowJob);
          const jobExecution = stateManager.getExecution(jobId);
          if (jobExecution) {
            stateManager.markTerminated(jobId);
            jobExecution.terminate();
          }
        }

        stateManager.setStatus(id, 'idle');
        return;
      }
    }

    if (!execution) {
      this.logger.debug(
        `[StopTask] No primary execution tracked for '${item.label}' (${id}). Attempting dependency stop only.`,
      );
      await this.stopCompoundDependencies(item, id, 'no-primary-execution');
      return;
    }

    // Second click while SIGINT is pending → prompt for (or apply configured) force-kill signal.
    if (stateManager.getStopTimer(id)) {
      const terminal = stateManager.getTerminal(id) ?? findTerminalForTask(execution.task);
      stateManager.clearStopTimer(id);
      stateManager.markTerminated(id);
      await this.stopCompoundDependencies(item, id, 'force-stop-second-click');
      const signal = await this.resolveForceStopSignal();
      if (signal !== undefined) {
        await forceKillPreservingTerminal(terminal, execution, signal);
      }
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

    // Regular (non-compound) task: send SIGINT first; a second click will prompt for force-kill.
    const terminal = stateManager.getTerminal(id) ?? findTerminalForTask(execution.task);
    if (terminal) {
      // Mark as terminated now so that if the process exits on its own in response
      // to SIGINT, the history/metrics service still records it as a termination.
      stateManager.markTerminated(id);
      // Send SIGINT (Ctrl+C) — the process gets a chance to shut down gracefully
      // and the terminal window is preserved.
      terminal.sendText('\u0003', false);
      // Store a marker so a second click can detect that SIGINT has already been sent.
      const pendingMarker = (globalThis as any).setTimeout(() => {}, 2147483647);
      stateManager.setStopTimer(id, pendingMarker);
    } else {
      // No terminal reference found — execution.terminate() is the only available stop method.
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

      // Second stop request while a "pending SIGINT" marker exists for this dependency
      // means we should force terminate it now using the configured/chosen signal.
      if (stateManager.getStopTimer(dependencyId)) {
        const depTerminal = stateManager.getTerminal(dependencyId) ?? findTerminalForTask(dependencyExecution.task);
        stateManager.clearStopTimer(dependencyId);
        stateManager.markTerminated(dependencyId);
        const signal = await this.resolveForceStopSignal();
        if (signal !== undefined) {
          await forceKillPreservingTerminal(depTerminal, dependencyExecution, signal);
        }
        forcedCount += 1;
        continue;
      }

      const terminal = stateManager.getTerminal(dependencyId) ?? findTerminalForTask(dependencyExecution.task);
      if (terminal) {
        // Mark as terminated now so that if the dependency exits on its own in
        // response to SIGINT, the history/metrics service records it as a termination.
        stateManager.markTerminated(dependencyId);
        terminal.sendText('\u0003', false);
        // Store a marker so a second click can detect that SIGINT has already been sent.
        const pendingMarker = (globalThis as any).setTimeout(() => {}, 2147483647);
        stateManager.setStopTimer(dependencyId, pendingMarker);
        gracefulCount += 1;
      } else {
        stateManager.markTerminated(dependencyId);
        dependencyExecution.terminate();
        forcedCount += 1;
      }
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
