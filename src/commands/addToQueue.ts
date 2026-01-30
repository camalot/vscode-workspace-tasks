import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { QueueService } from '../services/queueService';

export class AddToQueueCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    super('addToQueue', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item: TaskItem): Promise<void> {
    const queueService = QueueService.getInstance();
    const queues = queueService.getQueueNames();
    let targetQueue: string | undefined;

    // TODO: localize these strings
    if (queues.length === 0) {
      targetQueue = await vscode.window.showInputBox({
        prompt: 'Enter name for new queue',
        placeHolder: 'Queue Name',
        value: 'Queue',
      });
    } else {
      const items = [...queues, 'New Queue...'];
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select Queue to add task to' });
      if (selected === 'New Queue...') {
        targetQueue = await vscode.window.showInputBox({
          prompt: 'Enter name for new queue',
          placeHolder: 'Queue Name',
          value: 'Queue',
        });
      } else {
        targetQueue = selected;
      }
    }

    if (targetQueue) {
      queueService.addToQueue(item, targetQueue);
      this.taskTreeDataProvider.refreshLocal();
    }
  }
}
