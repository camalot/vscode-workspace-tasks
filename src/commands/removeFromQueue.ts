import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { TaskItem } from '../taskItem';
import { QueueService } from '../services/queueService';

export class RemoveFromQueueCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('removeFromQueue', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item: TaskItem): Promise<void> {
    let queueName: string | undefined;
    if (item.parent && item.parent.contextValue === 'queue') {
      queueName = item.parent.label as string;
    }
    QueueService.getInstance().removeFromQueue(item, queueName);
    this.taskTreeDataProvider.refreshLocal();
  }
}
