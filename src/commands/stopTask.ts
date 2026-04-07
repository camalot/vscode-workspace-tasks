import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';
import { ExtensionConfigurationService } from '../services/extensionConfigurationService';

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

export class StopTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    const stateManager = TaskStateManager.getInstance();
    const id = stateManager.getTaskId(item);
    const execution = stateManager.getExecution(id);

    if (!execution) {
      return;
    }

    // Second click while a graceful-stop timer is already pending → force kill now.
    if (stateManager.getStopTimer(id)) {
      stateManager.clearStopTimer(id);
      stateManager.markTerminated(id);
      execution.terminate();
      return;
    }

    // Try the stored terminal first, then fall back to a name-based search.
    const terminal = stateManager.getTerminal(id) ?? findTerminalForTask(execution.task);
    if (terminal) {
      // Send SIGINT (Ctrl+C) — the process gets a chance to shut down gracefully
      // and the terminal window is preserved.
      terminal.sendText('\u0003', false);

      const extensionConfig = ExtensionConfigurationService.getInstance();

      // graceful-stop timeout should come from configuration at workspaceTasks.task.stopGracefulDelayMilliseconds
      const timeout = extensionConfig.get<number>('workspaceTasks.task.stopGracefulDelayMilliseconds', 5000);
      // Schedule a fallback force-kill in case the process ignores the signal.
      const timer = setTimeout(() => {
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
}
