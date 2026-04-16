import BaseCommand from '../common/baseCommand';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskRunGuardService } from '../services/taskRunGuardService';

export class AddRunGuardCommand extends BaseCommand {
  constructor(context: vscode.ExtensionContext) {
    super('addRunGuard', context);
  }

  async run(item?: TaskItem): Promise<void> {
    if (!item) { return; }
    await TaskRunGuardService.getInstance().addGuard(item);
    // No explicit refresh() here — onDidChangeGuards fires → extension.ts subscription
    // calls taskTreeDataProvider.refresh(). This is the same pattern as FavoritesService
    // and FilteredTaskService to prevent double-refresh.
  }
}
