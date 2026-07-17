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
 * Finds the terminal whose underlying shell process id matches the given OS
 * process id. This is the authoritative way to correlate a task execution
 * with its terminal — process ids are unique, unlike terminal names, which
 * can collide between unrelated or duplicate tasks (e.g. the same task
 * label run concurrently, or two different tasks that happen to share a
 * label across workspace folders).
 *
 * Returns `undefined` when no `processId` is supplied (e.g. the task hasn't
 * reported a process yet, or is a `CustomExecution` task with no real OS
 * process) so callers can fall back to name-based matching.
 */
export async function findTerminalByProcessId(
  processId: number | undefined,
  terminals: readonly vscode.Terminal[] = vscode.window.terminals,
): Promise<vscode.Terminal | undefined> {
  if (processId === undefined) {
    return undefined;
  }
  for (const terminal of terminals) {
    const pid = await terminal.processId;
    if (pid === processId) {
      return terminal;
    }
  }
  return undefined;
}

/**
 * Resolves the terminal that hosts a task's running process.
 *
 * Prefers matching by OS process id (precise and unambiguous) and only falls
 * back to name-based heuristics — via {@link findTerminalForTask} — when no
 * process id is known, e.g. because the process hasn't started yet or the
 * task never spawns a real OS process.
 */
export async function resolveTaskTerminal(
  task: vscode.Task,
  processId: number | undefined,
  terminals: readonly vscode.Terminal[] = vscode.window.terminals,
): Promise<vscode.Terminal | undefined> {
  const byPid = await findTerminalByProcessId(processId, terminals);
  if (byPid !== undefined) {
    return byPid;
  }
  return findTerminalForTask(task, terminals);
}

/**
 * Finds the terminal that belongs to a task by matching against common
 * naming conventions that VSCode uses for task terminals.
 *
 * This is a best-effort fallback only — terminal names are not guaranteed to
 * be unique (e.g. duplicate task labels across folders), so prefer
 * {@link resolveTaskTerminal} which matches by OS process id first.
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
  const folderName = (task.scope as vscode.WorkspaceFolder)?.name;

  const validNames = new Set<string>([
    name,
    `${source}: ${name}`,
    `Task - ${name}`,
  ]);
  if (folderName) {
    validNames.add(`${name} (${folderName})`);
    validNames.add(`${source}: ${name} (${folderName})`);
    validNames.add(`Task - ${name} (${folderName})`);
  }

  // Iterate all terminals and keep the last match — terminals are ordered
  // oldest-first, so the last match is the most recently created instance,
  // which corresponds to the current task run when a previous terminal with
  // the same name is still open.
  let result: vscode.Terminal | undefined;
  for (const t of terminals) {
    if (validNames.has(t.name)) {
      result = t;
    }
  }
  return result;
}

/**
 * Kills the task process using the given signal while preserving the terminal
 * window when possible.
 *
 * - **SIGINT**: Sends the interrupt character (`\u0003`) via the terminal so the TTY
 *   layer handles it. This always preserves the terminal panel.
 * - **SIGTERM / SIGKILL**: When the task's `presentation.close` is `false`, kills the
 *   process directly via the OS using `processId` (preferred, captured from
 *   `onDidStartTaskProcess`) or the resolved terminal's `processId` as a fallback.
 *   This causes VSCode to treat the exit as natural and keep the panel open. The
 *   exact signal requested is sent immediately — there is no automatic escalation
 *   or substitution of a different signal. Note that for wrapper/proxy processes
 *   (e.g. `docker run`, `ssh`) killing the local wrapper process does not guarantee
 *   the remote work it launched (a container, a remote session, etc.) is stopped;
 *   that is an inherent limitation of signaling the wrapper rather than something
 *   this extension can safely work around on the caller's behalf.
 *
 * Falls back to `execution.terminate()` only when `presentation.close` is `true`
 * (the user has explicitly asked for the terminal to be closed on task end).
 * Otherwise, if the process cannot be killed directly, a warning is shown and
 * `execution.terminate()` is never called — closing/destroying the terminal
 * unexpectedly is worse than leaving a task marked as running.
 */
export async function forceKillPreservingTerminal(
  terminal: vscode.Terminal | undefined,
  execution: vscode.TaskExecution,
  signal: ForceStopSignal = 'SIGKILL',
  processId?: number,
): Promise<void> {
  // If the caller didn't supply a terminal, resolve it — preferring process id
  // correlation over name-based matching (including multi-root workspace
  // folder suffix patterns).
  const resolvedTerminal = terminal ?? await resolveTaskTerminal(execution.task, processId);

  // SIGINT via terminal sendText is the most reliable method and always preserves the terminal.
  if (signal === 'SIGINT' && resolvedTerminal !== undefined) {
    resolvedTerminal.sendText('\u0003', false);
    return;
  }

  const shouldClose = execution.task.presentationOptions?.close ?? false;
  if (signal !== 'SIGINT' && !shouldClose) {
    // Prefer the process id captured directly from `onDidStartTaskProcess` — it is
    // authoritative and avoids any ambiguity from terminal matching.
    const pid = processId ?? await resolvedTerminal?.processId;
    if (pid !== undefined) {
      try {
        process.kill(pid, signal);
        return;
      } catch {
        // Process already exited or kill failed — fall through
      }
    }
  }

  if (shouldClose) {
    execution.terminate();
  } else {
    vscode.window.showWarningMessage(
      `Unable to stop task '${execution.task.name}': the process could not be killed directly.`,
    );
  }
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

    // Second (and every subsequent) click while a stop is pending → prompt for (or apply
    // configured) force-kill signal. No matter how much time has elapsed since the first
    // click, or how many force-stop attempts have already been made, another click always
    // means "force stop" — the pending marker is intentionally NOT cleared here. It is only
    // cleared once the task actually exits (see the onDidEndTaskProcess/onDidEndTask
    // handlers in extension.ts), so if a chosen signal fails to stop the process (e.g. the
    // user picks SIGINT again, dismisses the QuickPick, or no process id is available), the
    // next click retries force-stop instead of falling back to a fresh graceful SIGINT.
    if (stateManager.getStopTimer(id)) {
      const processId = stateManager.getProcessId(id);
      const terminal = (await resolveTaskTerminal(execution.task, processId)) ?? stateManager.getTerminal(id);
      stateManager.markTerminated(id);
      await this.stopCompoundDependencies(item, id, 'force-stop-second-click');
      const signal = await this.resolveForceStopSignal();
      if (signal !== undefined) {
        await forceKillPreservingTerminal(terminal, execution, signal, processId);
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
    const terminal = (await resolveTaskTerminal(execution.task, stateManager.getProcessId(id))) ?? stateManager.getTerminal(id);
    const pendingMarker = (globalThis as any).setTimeout(() => { }, 2147483647);
    stateManager.setStopTimer(id, pendingMarker);
    if (terminal) {
      // Mark as terminated now so that if the process exits on its own in response
      // to SIGINT, the history/metrics service still records it as a termination.
      stateManager.markTerminated(id);
      // Send SIGINT (Ctrl+C) — the process gets a chance to shut down gracefully
      // and the terminal window is preserved.
      terminal.sendText('\u0003', false);
      // Store a marker so a second click can detect that SIGINT has already been sent.
    } else {
      // No terminal reference found — we cannot send SIGINT without closing the terminal,
      // so warn the user rather than force-terminating.
      stateManager.markTerminated(id);
      vscode.window.showWarningMessage(
        `Unable to stop task '${execution.task.name}': no terminal panel was found. Try clicking Stop again or closing the terminal manually.`,
      );
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
    let warnedCount = 0;

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

      // Second (and every subsequent) stop request while a "pending SIGINT" marker exists
      // for this dependency means we should force terminate it now using the
      // configured/chosen signal. The marker is intentionally NOT cleared here — see the
      // matching comment in `run()` — so a later click keeps retrying force-stop until the
      // dependency actually exits.
      if (stateManager.getStopTimer(dependencyId)) {
        const depProcessId = stateManager.getProcessId(dependencyId);
        const depTerminal = (await resolveTaskTerminal(dependencyExecution.task, depProcessId)) ?? stateManager.getTerminal(dependencyId);
        stateManager.markTerminated(dependencyId);
        const signal = await this.resolveForceStopSignal();
        if (signal !== undefined) {
          await forceKillPreservingTerminal(depTerminal, dependencyExecution, signal, depProcessId);
        }
        forcedCount += 1;
        continue;
      }

      const terminal = (await resolveTaskTerminal(dependencyExecution.task, stateManager.getProcessId(dependencyId))) ?? stateManager.getTerminal(dependencyId);
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
        // No terminal reference found — we cannot send SIGINT without closing the
        // terminal, so warn rather than calling execution.terminate() (which would
        // destroy the terminal panel unexpectedly), mirroring the primary-task path.
        stateManager.markTerminated(dependencyId);
        vscode.window.showWarningMessage(
          `Unable to stop task '${dependencyExecution.task.name}': no terminal panel was found. Try clicking Stop again or closing the terminal manually.`,
        );
        warnedCount += 1;
      }
    }

    if (gracefulCount === 0 && forcedCount === 0 && warnedCount === 0) {
      this.logger.debug(
        `[StopTask] Dependencies identified but none are currently running for '${item.label}' (${taskId}). Trigger: ${trigger}. Dependency IDs: ${dependencyIds.join(', ')}`,
      );
    } else {
      this.logger.debug(
        `[StopTask] Dependency stop summary for '${item.label}' (${taskId}). Trigger: ${trigger}. Graceful: ${gracefulCount}, Forced: ${forcedCount}, Warned: ${warnedCount}.`,
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
