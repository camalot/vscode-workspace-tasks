import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskTreeDataProvider } from '../taskTreeDataProvider';
import { RecentTasksService } from '../services/recentTasksService';
import { TaskItem } from '../taskItem';

export class RemoveFromRecentTasksCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;
  constructor(context: vscode.ExtensionContext) {
    super('removeFromRecentTasks', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  }

  async run(item: TaskItem): Promise<void> {
    (RecentTasksService.getInstance() as RecentTasksService).remove(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
