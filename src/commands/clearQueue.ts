import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { TaskItem } from '../taskItem';
import { QueueService } from '../services/queueService';

export class ClearQueueCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('clearQueue', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (item && item.contextValue === 'queue') {
      QueueService.getInstance().clearQueue(item.label as string);
      this.taskTreeDataProvider.refreshLocal();
      return;
    }

    const queues = QueueService.getInstance().getQueueNames();
    if (queues.length === 0) {
      return;
    }

    const selected = await vscode.window.showQuickPick(queues, { placeHolder: 'Select queue to clear' });
    if (selected) {
      QueueService.getInstance().clearQueue(selected);
      this.taskTreeDataProvider.refreshLocal();
    }
  }
}
