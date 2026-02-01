import * as vscode from 'vscode';
import BaseCommand from '../common/baseCommand';
import { TaskItem } from '../taskItem';
import { createTaskForItem } from '../taskFactory';

export class CopyTaskCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('copyTaskCommand', context);
  }

  async run(item: TaskItem): Promise<void> {
    try {
      const created = await createTaskForItem(item);
      if (created && created.command) {
        await vscode.env.clipboard.writeText(created.command);
      } else {
        vscode.window.showWarningMessage('Could not resolve command for this task.');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to copy command: ${error instanceof Error ? error.message : error}`);
    }
  }
}
