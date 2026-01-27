import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskRunner } from "../taskRunner";

export class RunTaskCommand extends BaseCommand {

  constructor(context: vscode.ExtensionContext) {
    super('runTask', context);
  }

  async run(item: TaskItem): Promise<void> {
    if (item.contextValue === 'queuedTask') {
      const queueName = item.parent?.label as string;
      await TaskRunner.getInstance().runQueue(queueName, item);
    } else {
      await TaskRunner.getInstance().runTask(item);
    }
  }
}
