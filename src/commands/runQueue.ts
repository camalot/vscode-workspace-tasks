import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskTreeDataProvider } from "../taskTreeDataProvider";
import { QueueService } from "../services/queueService";
import { TaskRunner } from "../taskRunner";

export class RunQueueCommand extends BaseCommand {

  constructor(context: vscode.ExtensionContext) {
    super('runQueue', context);

  }

  async run(item?: TaskItem): Promise<void> {
    const taskRunner = TaskRunner.getInstance();

    if (item && item.contextValue === 'queue') {
      taskRunner.runQueue(item.label as string);
      return;
    }

    const queueService = QueueService.getInstance();

    const queues = queueService.getQueueNames();
    if (queues.length === 0) {
      vscode.window.showInformationMessage("No queues to run.");
      return;
    }

    let queueName: string | undefined;
    if (queues.length === 1) {
      queueName = queues[0];
    } else {
      queueName = await vscode.window.showQuickPick(queues, { placeHolder: 'Select queue to run' });
    }

    if (queueName) {
      taskRunner.runQueue(queueName);
    }

  }
}
