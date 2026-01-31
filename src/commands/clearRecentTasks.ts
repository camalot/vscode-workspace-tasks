import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { RecentTasksService } from '../services/recentTasksService';

export class ClearRecentTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('clearRecentTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(): Promise<void> {
    (RecentTasksService.getInstance() as RecentTasksService).clear();
    this.taskTreeDataProvider.refreshLocal();
  }
}
