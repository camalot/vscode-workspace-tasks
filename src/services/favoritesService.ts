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
    let savedFavorites = context.workspaceState.get<string[]>(this.STORAGE_KEY, []);

    // Migrate old global favorites to workspace favorites if needed?
    // Or just start using workspace state.
    // Let's check globalState too for migration purposes, but verify if they belong to workspace.
    const globalFavorites = context.globalState.get<string[]>(this.STORAGE_KEY, []);
    if (globalFavorites.length > 0) {
      // Migrate applicable favorites to workspace state
       const migratedGlobal = this.taskStateManager.normalizeTaskIds(globalFavorites);
       // We can only filter if we had the items loaded, but here we only have strings.
       // So we might as well just not migrate blindly to avoid pollution,
       // OR we migrate everything and let the runtime filter filter it out as implemented in isFavorite.

       // DECISION: For now, we just switch to workspaceState. Users might lose favorites if they relied on global sync.
       // But user explicitly asked to disable syncing.
       // We can clear global state to avoid confusion or keep it as backup.
       // Let's JUST use workspaceState.

       // If workspace state is empty, maybe try to populate from global (copy over)?
       if (savedFavorites.length === 0 && globalFavorites.length > 0) {
          savedFavorites = this.taskStateManager.normalizeTaskIds(globalFavorites);
          // Save to workspace immediately so we don't rely on global anymore
          context.workspaceState.update(this.STORAGE_KEY, savedFavorites);
          // Optional: Clear global state?
          // context.globalState.update(this.STORAGE_KEY, undefined);
       }
    }

    // Migrate old task IDs to new portable format
    const migratedFavorites = this.taskStateManager.normalizeTaskIds(savedFavorites);

    // If any IDs were migrated (format changed), save the migrated data back
    if (JSON.stringify(savedFavorites) !== JSON.stringify(migratedFavorites)) {
      context.workspaceState.update(this.STORAGE_KEY, migratedFavorites);
    }

    this.favorites = new Set(migratedFavorites);
  }

  public isFavorite(itemOrId: TaskItem | string): boolean {
    let id: string;
    let item: TaskItem | undefined;

    if (typeof itemOrId === 'string') {
      // Normalize the ID to handle old format and prefixes
      id = this.taskStateManager.normalizeTaskId(itemOrId);
      // We can't fetch the item here easily without injecting TaskCacheService or similar,
      // but typically isFavorite is called with a TaskItem when rendering.
      // If called with string, we assume caller knows it exists or we just return raw containment.
    } else {
      // If a TaskItem is passed, generate the portable ID
      id = this.taskStateManager.getTaskId(itemOrId);
      item = itemOrId;
    }

    if (item) {
      const uri = item.taskFileUri || item.resourceUri;
      if (uri) {
        const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!wsFolder) {
          return false;
        }
      }
    }

    return this.favorites.has(id);
  }

  public addToFavorites(item: TaskItem) {
    const portableId = this.taskStateManager.getTaskId(item);
    if (portableId) {
      this.favorites.add(portableId);
      this.save();
    }
  }

  public removeFromFavorites(item: TaskItem) {
    const portableId = this.taskStateManager.getTaskId(item);
    if (portableId && this.favorites.has(portableId)) {
      this.favorites.delete(portableId);
      this.save();
    }
  }

  private save() {
    this.context?.workspaceState.update(this.STORAGE_KEY, Array.from(this.favorites));
  }
}
