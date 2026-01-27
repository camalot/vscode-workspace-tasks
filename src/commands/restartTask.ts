import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskRunner } from "../taskRunner";
import { TaskStateManager } from "../taskStateManager";

export class RestartTaskCommand extends BaseCommand {

  constructor(context: vscode.ExtensionContext) {
    super('restartTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    const id = TaskStateManager.getInstance().getTaskId(item);
    const execution = TaskStateManager.getInstance().getExecution(id);
    if (execution) {
      execution.terminate();
      // Wait a moment to ensure termination
      setTimeout(() => {
        TaskRunner.getInstance().runTask(item);
      }, 500);
    } else {
      // If not running, just run the task
      TaskRunner.getInstance().runTask(item);
    }
  }
}
