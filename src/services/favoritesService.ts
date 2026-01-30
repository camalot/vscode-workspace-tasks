import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

export class FavoritesService {
  private static instance: FavoritesService;
  private favorites: Set<string> = new Set();
  private context?: vscode.ExtensionContext;
  private readonly STORAGE_KEY = 'favorites';

  private constructor() {}

  public static getInstance(): FavoritesService {
    if (!FavoritesService.instance) {
      FavoritesService.instance = new FavoritesService();
    }
    return FavoritesService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    const savedFavorites = context.globalState.get<string[]>(this.STORAGE_KEY, []);
    this.favorites = new Set(savedFavorites);
  }

  public isFavorite(id: string): boolean {
    return this.favorites.has(id);
  }

  public addToFavorites(item: TaskItem) {
    const id = TaskStateManager.getInstance().getTaskId(item);
    if (id) {
      this.favorites.add(id);
      this.save();
    }
  }

  public removeFromFavorites(item: TaskItem) {
    const id = TaskStateManager.getInstance().getTaskId(item);
    if (id && this.favorites.has(id)) {
      this.favorites.delete(id);
      this.save();
    }
  }

  private save() {
    this.context?.globalState.update(this.STORAGE_KEY, Array.from(this.favorites));
  }
}
