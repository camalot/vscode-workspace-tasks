import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskStateManager } from '../taskStateManager';

export class FavoritesService {
  private static instance: FavoritesService;
  private favorites: Set<string> = new Set();
  private context?: vscode.ExtensionContext;
  private readonly STORAGE_KEY = 'favorites';
  private readonly taskStateManager = TaskStateManager.getInstance();

  private constructor() {}

  public static getInstance(): FavoritesService {
    if (!FavoritesService.instance) {
      FavoritesService.instance = new FavoritesService();
    }
    return FavoritesService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    let savedFavorites = context.globalState.get<string[]>(this.STORAGE_KEY, []);

    // Migrate old task IDs to new portable format
    const migratedFavorites = this.taskStateManager.normalizeTaskIds(savedFavorites);

    // If any IDs were migrated (format changed), save the migrated data back
    if (JSON.stringify(savedFavorites) !== JSON.stringify(migratedFavorites)) {
      context.globalState.update(this.STORAGE_KEY, migratedFavorites);
    }

    this.favorites = new Set(migratedFavorites);
  }

  public isFavorite(itemOrId: TaskItem | string): boolean {
    let id: string;

    if (typeof itemOrId === 'string') {
      // Normalize the ID to handle old format and prefixes
      id = this.taskStateManager.normalizeTaskId(itemOrId);
    } else {
      // If a TaskItem is passed, generate the portable ID
      id = this.taskStateManager.generatePortableTaskId(itemOrId);
    }

    return this.favorites.has(id);
  }

  public addToFavorites(item: TaskItem) {
    const portableId = this.taskStateManager.generatePortableTaskId(item);
    if (portableId) {
      this.favorites.add(portableId);
      this.save();
    }
  }

  public removeFromFavorites(item: TaskItem) {
    const portableId = this.taskStateManager.generatePortableTaskId(item);
    if (portableId && this.favorites.has(portableId)) {
      this.favorites.delete(portableId);
      this.save();
    }
  }

  private save() {
    this.context?.globalState.update(this.STORAGE_KEY, Array.from(this.favorites));
  }
}
