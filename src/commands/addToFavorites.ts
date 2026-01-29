import BaseCommand from "../common/baseCommand";
import * as vscode from 'vscode';
import { TaskItem } from "../taskItem";
import { TaskTreeDataProvider } from "../taskTreeDataProvider";
import { FavoritesService } from "../services/favoritesService";

export class AddToFavoritesCommand extends BaseCommand {
  private taskTreeDataProvider: TaskTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    super('addToFavorites', context);
    this.taskTreeDataProvider = TaskTreeDataProvider.getInstance(this.context);

  }

  async run(item: TaskItem): Promise<void> {
    FavoritesService.getInstance().addToFavorites(item);
    this.taskTreeDataProvider.refreshLocal();
  }
}
