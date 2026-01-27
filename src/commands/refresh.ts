import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from "../taskTreeDataProvider";

export class RefreshCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('refresh', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(): Promise<void> {
    this.taskTreeDataProvider.refresh();
  }
}
