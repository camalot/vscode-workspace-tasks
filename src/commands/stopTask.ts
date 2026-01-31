import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

export class StopTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    const id = TaskStateManager.getInstance().getTaskId(item);
    const execution = TaskStateManager.getInstance().getExecution(id);
    if (execution) {
      execution.terminate();
    }
  }
}
