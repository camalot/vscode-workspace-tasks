import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { QueueService, QueueExecutionType } from '../services/queueService';

export class SetQueueExecutionTypeCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('setQueueExecutionType', context);
  }

  async run(item?: TaskItem): Promise<void> {
    const taskTreeDataProvider = TaskTreeDataProvider.getInstance();

    let queueName: string | undefined;

    if (item && item.contextValue === 'queue') {
      queueName = item.label as string;
    } else {
      const queueService = QueueService.getInstance();
      const queues = queueService.getQueueNames();
      if (queues.length === 0) {
        vscode.window.showInformationMessage('No queues available.');
        return;
      }
      if (queues.length === 1) {
        queueName = queues[0];
      } else {
        queueName = await vscode.window.showQuickPick(queues, { placeHolder: 'Select queue' });
      }
    }

    if (!queueName) {
      return;
    }

    const queueService = QueueService.getInstance();
    const current = queueService.getQueueExecutionType(queueName);
    const next: QueueExecutionType = current === 'sequential' ? 'parallel' : 'sequential';
    queueService.setQueueExecutionType(queueName, next);
    taskTreeDataProvider.refreshLocal();
  }
}
