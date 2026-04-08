import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { CompoundTaskService } from '../services/compoundTaskService';
import { TaskStateManager } from '../taskStateManager';

export class StopCompoundTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopCompoundTask', context);
  }

  async run(item?: TaskItem): Promise<void> {
    let compoundTaskName: string | undefined;

    if (item && item.contextValue === 'runningCompoundTask') {
      compoundTaskName = item.label as string;
    } else {
      const compoundTaskService = CompoundTaskService.getInstance();
      const runningCompoundTasks = compoundTaskService.getCompoundTaskNames().filter((name) => compoundTaskService.isCompoundTaskRunning(name));
      if (runningCompoundTasks.length === 0) {
        vscode.window.showInformationMessage('No compound tasks are currently running.');
        return;
      }
      if (runningCompoundTasks.length === 1) {
        compoundTaskName = runningCompoundTasks[0];
      } else {
        compoundTaskName = await vscode.window.showQuickPick(runningCompoundTasks, { placeHolder: 'Select compound task to stop' });
      }
    }

    if (!compoundTaskName) {
      return;
    }

    const compoundTaskService = CompoundTaskService.getInstance();
    const stateManager = TaskStateManager.getInstance();

    // Cancel the compound task loop so no new tasks are started
    compoundTaskService.cancelCompoundTask(compoundTaskName);

    // Stop any tasks from this compound task that are currently running
    const compoundTask = compoundTaskService.getCompoundTask(compoundTaskName) ?? [];
    for (const task of compoundTask) {
      const id = stateManager.getTaskId(task);
      const execution = stateManager.getExecution(id);
      if (execution) {
        stateManager.markTerminated(id);
        execution.terminate();
      }
    }
  }
}
