import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { QueueService } from '../services/queueService';
import { TaskStateManager } from '../taskStateManager';

export class StopQueueCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('stopQueue', context);
  }

  async run(item?: TaskItem): Promise<void> {
    let queueName: string | undefined;

    if (item && item.contextValue === 'runningQueue') {
      queueName = item.label as string;
    } else {
      const queueService = QueueService.getInstance();
      const runningQueues = queueService.getQueueNames().filter((name) => queueService.isQueueRunning(name));
      if (runningQueues.length === 0) {
        vscode.window.showInformationMessage('No queues are currently running.');
        return;
      }
      if (runningQueues.length === 1) {
        queueName = runningQueues[0];
      } else {
        queueName = await vscode.window.showQuickPick(runningQueues, { placeHolder: 'Select queue to stop' });
      }
    }

    if (!queueName) {
      return;
    }

    const queueService = QueueService.getInstance();
    const stateManager = TaskStateManager.getInstance();

    // Cancel the queue loop so no new tasks are started
    queueService.cancelQueue(queueName);

    // Stop any tasks from this queue that are currently running
    const queue = queueService.getQueue(queueName) ?? [];
    for (const task of queue) {
      const id = stateManager.getTaskId(task);
      const execution = stateManager.getExecution(id);
      if (execution) {
        stateManager.markTerminated(id);
        execution.terminate();
      }
    }
  }
}
