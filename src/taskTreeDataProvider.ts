import * as vscode from 'vscode';
import * as path from 'path';
import constants from './libs/constants';
import { TaskProvider } from './taskProvider';
import { TaskItem } from './taskItem';
import { TaskTypeFactory } from './taskTypeItems';
import { TaskStateManager } from './taskStateManager';
import { TaskTreeDragAndDropController } from './taskTreeDragAndDropController';
import { TaskCacheService } from './services/taskCacheService';
import { TaskIconService } from './services/taskIconService';
import { RecentTasksService } from './services/recentTasksService';
import { FavoritesService } from './services/favoritesService';
import { CompoundTaskService } from './services/compoundTaskService';
import { FilteredTaskService } from './services/filteredTaskService';
import { WorkspaceTasksService } from './services/workspaceTasksService';

export type ExpandedTaskGroups = { favorites: boolean; compoundTask: boolean; queue?: boolean; recent: boolean };
export type RootTreeTypes = 'favorites' | 'compoundTask' | 'compoundTasks' | 'recent' | 'workspace';

export class TaskTreeDataProvider implements vscode.TreeDataProvider<TaskItem> {
  private static instance: TaskTreeDataProvider | undefined;

  private _onDidChangeTreeData: vscode.EventEmitter<TaskItem | undefined | null | void> = new vscode.EventEmitter<
    TaskItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TaskItem | undefined | null | void> = this._onDidChangeTreeData.event;

  public dragAndDropController: vscode.TreeDragAndDropController<TaskItem>;
  private views: vscode.TreeView<TaskItem>[] = [];
  private currentRoots: TaskItem[] = [];
  private collapseLevel: number = 0;
  private pendingRevealLevel: number | undefined = undefined;
  // Use a dedicated emitter for roots updates to synchronize reveal actions
  private onRootsUpdated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  private refreshTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.dragAndDropController = new TaskTreeDragAndDropController();

    TaskCacheService.getInstance().onDidUpdate(() => {
      this._onDidChangeTreeData.fire();
    });

    TaskCacheService.getInstance().onDidLoadingStateChange(() => {
      this._onDidChangeTreeData.fire();
    });

    // Restore collapseLevel from workspace state (default to 0)
    // Actually we only care about restoring if it was 0, as other modes are temporary toggles usually?
    // But if persistence is tricky for groups, maybe we just default to 0.
    // The issue with persistence is likely that the TreeView doesn't know about these IDs until we feed them to it.

    // NOTE: Visual Studio Code persists expansion state based on ID.
  }

  public static getInstance(context?: vscode.ExtensionContext): TaskTreeDataProvider {
    if (!TaskTreeDataProvider.instance && context) {
      TaskTreeDataProvider.instance = new TaskTreeDataProvider(context);
    }
    return TaskTreeDataProvider.instance!;
  }

  public async initialize(context: vscode.ExtensionContext): Promise<TaskTreeDataProvider> {
    this.context = context;
    return this;
  }

  public bindView(view: vscode.TreeView<TaskItem>) {
    this.views.push(view);
    view.onDidExpandElement((e) => {
      this.updateExpandedState(e.element.id, true);
    });
    view.onDidCollapseElement((e) => {
      this.updateExpandedState(e.element.id, false);
    });
  }

  private updateExpandedState(id: string | undefined, expanded: boolean) {
    if (!id || this.collapseLevel !== 0 || !this.context || !this.context.workspaceState) {
      return;
    }
    const key = 'taskTree.itemState';
    const stateMap = this.context.workspaceState.get<Record<string, vscode.TreeItemCollapsibleState>>(key, {});
    const newStateMap = { ...stateMap };
    newStateMap[id] = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    this.context.workspaceState.update(key, newStateMap);
  }

  private getExpandedState(id: string, defaultState: vscode.TreeItemCollapsibleState): vscode.TreeItemCollapsibleState {
    if (this.collapseLevel !== 0 || !this.context || !this.context.workspaceState) {
      return defaultState;
    }
    const key = 'taskTree.itemState';
    const stateMap = this.context.workspaceState.get<Record<string, vscode.TreeItemCollapsibleState>>(key, {});

    if (stateMap && stateMap[id] !== undefined) {
      return stateMap[id];
    }
    return defaultState;
  }

  registerProvider(provider: TaskProvider) {
    TaskCacheService.getInstance().registerProvider(provider);
    if (provider.filePattern) {
      const watcher = vscode.workspace.createFileSystemWatcher(provider.filePattern);
      const onChange = () => this.handleFileChange(provider);

      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);

      this.context.subscriptions.push(watcher);
    }
  }

  private handleFileChange(provider: TaskProvider) {
    if (!provider.type) {
      return;
    }
    const type = provider.type;

    if (this.refreshTimeouts.has(type)) {
      clearTimeout(this.refreshTimeouts.get(type));
    }

    this.refreshTimeouts.set(
      type,
      setTimeout(async () => {
        this.refreshTimeouts.delete(type);
        await TaskCacheService.getInstance().refreshProvider(type);
        this._onDidChangeTreeData.fire();
      }, 1000),
    );
  }

  async refresh(): Promise<void> {
    await TaskCacheService.getInstance().refresh();
  }

  refreshLocal(): void {
    this._onDidChangeTreeData.fire();
  }

  async collapseAllTaskGroups(): Promise<void> {
    if (this.views.length === 0) {
      return;
    }

    // Toggle logic:
    // 0 -> 1 (Expand All)
    // 1 -> 2 (Collapse All Roots)
    // 2 -> 0 (Collapse Groups / Default)
    this.collapseLevel = (this.collapseLevel + 1) % 3;

    if (this.collapseLevel === 1) {
      // Expand All (Level 1)
      // Refresh with 'expanded' IDs and defaults.
      this.pendingRevealLevel = 0;
      this._onDidChangeTreeData.fire();
      return;
    } else if (this.collapseLevel === 2) {
      // Collapse All Roots
      // Refresh tree with salt='roots_collapsed' and defaults to Collapsed.
      this.pendingRevealLevel = undefined;
      this._onDidChangeTreeData.fire();
      return;
    } else {
      // Default / Collapse Groups (Level 0)
      // Groups Collapsed:
      // We refresh the tree with new IDs (salt='default') and defaults to Collapsed.
      // after refresh, we ensure roots are expanded.
      this.pendingRevealLevel = 1;
      // FAST REFRESH (Cached Only)
      this._onDidChangeTreeData.fire();
      return;
    }
  }

  getTreeItem(element: TaskItem): vscode.TreeItem {
    return element;
  }

  getParent(element: TaskItem): vscode.ProviderResult<TaskItem> {
    return element.parent;
  }

  async getChildren(element?: TaskItem): Promise<TaskItem[]> {
    if (element) {
      // Compound task dep items (and other dynamically-created children) are built fresh
      // in organizeTasks() but are NOT part of the shared task cache. Unlike cache items
      // that are updated in-place by updateContextRecursively(), these items may become
      // stale if VS Code passes an old element reference to getChildren during a tree
      // refresh. Explicitly refreshing the context values here ensures running status
      // (icons, contextValues) is always current when VS Code renders these items.
      for (const child of element.children) {
        child.updateContextValue();
        for (const grandchild of child.children) {
          grandchild.updateContextValue();
        }
      }
      return element.children;
    } else {
      const cacheService = TaskCacheService.getInstance();
      const allTasks = cacheService.getAllTasks();
      this.currentRoots = this.organizeTasks(allTasks);

      // Inject a loading placeholder for each in-flight provider that has not yet committed tasks.
      // Placeholders are placed after Favorites/Recent/Compound groups and before workspace-folder
      // groups, per the plan. They disappear once the provider delivers tasks or finishes.
      const loadingProviders = cacheService.getLoadingProviders();
      const loadingItems: TaskItem[] = [];
      for (const type of loadingProviders) {
        if (!cacheService.hasTasksForProviderType(type)) {
          const placeholder = new TaskItem(
            `Loading ${type} tasks…`,
            vscode.TreeItemCollapsibleState.None,
            type,
          );
          placeholder.iconPath = new vscode.ThemeIcon('loading~spin');
          placeholder.contextValue = 'loadingPlaceholder';
          loadingItems.push(placeholder);
        }
      }

      if (loadingItems.length > 0) {
        // Insert placeholders after special groups (favorites, recent, compoundTask, compoundTasks)
        // and before workspace-folder groups.
        const specialTypes = new Set(['recent', 'favorites', 'compoundTask', 'compoundTasks']);
        const firstNonSpecialIdx = this.currentRoots.findIndex(
          (r) => !specialTypes.has(r.taskType || ''),
        );
        if (firstNonSpecialIdx >= 0) {
          this.currentRoots.splice(firstNonSpecialIdx, 0, ...loadingItems);
        } else {
          this.currentRoots.push(...loadingItems);
        }
      }

      // Fire update signal for collapse logic
      // Use setTimeout to ensure we are out of the immediate stack if needed,
      // but synchronous dispatch is usually fine for event emitters.
      // However, we must wait for Visual Studio Code to finish 'getting' children before we 'reveal'.
      // Actually Visual Studio Code calls getChildren, then renders.
      // So determining when render is complete is hard.
      // But typically firing a follow-up action a bit later works.
      if (this.pendingRevealLevel !== undefined) {
        const level = this.pendingRevealLevel;
        this.pendingRevealLevel = undefined;
        setTimeout(async () => {
          if (this.views.length === 0) {
            return;
          }
          for (const view of this.views) {
            for (const root of this.currentRoots) {
              try {
                if (level === 1) {
                  // Ensure root is expanded 1 level deep (showing collapsed groups)
                  await view.reveal(root, { expand: 1, select: false, focus: false });
                } else if (level === 0) {
                  // Ensure root is expanded 3 levels deep (showing tasks)
                  await view.reveal(root, { expand: 3, select: false, focus: false });
                }
              } catch (e) { }
            }
          }
        }, 100);
      }

      return this.currentRoots;
    }
  }

  private makeId(base: string, salt: string): string {
    return salt ? `${base}:${salt}` : base;
  }

  private organizeTasks(tasks: TaskItem[]): TaskItem[] {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const groupsEnabled = config.get<boolean>('groups.enabled', true);
    const useParentFolder = config.get<boolean>('groups.useParentFolder', false);
    const recentGroupsEnabled = config.get<boolean>('groups.recentTasks.enabled', false);
    const compoundTasksGroupEnabled = config.get<boolean>('groups.compoundTasks.enabled', false);
    const includeVsCodeCompoundTasks = config.get<boolean>('compoundTasks.includeVsCodeCompoundTasks', true);
    const taskSeparator = config.get<string>('groups.taskSeparator', '-');
    const expandedGroups = config.get<ExpandedTaskGroups>('groups.expanded', {
      favorites: true,
      compoundTask: true,
      recent: true,
    });

    // Get filtered task service instance
    const filteredService = FilteredTaskService.getInstance();
    const showHiddenMode = filteredService.isShowHiddenMode();
    const stateManager = TaskStateManager.getInstance();

    /**
     * Filter tasks based on filtered state.
     *
     * Logic:
     * - If showHiddenMode is false (default): Filter out hidden tasks and groups completely
     * - If showHiddenMode is true: Show all tasks including hidden ones
     *
     * This handles both individual tasks and groups:
     * - Individual tasks are filtered if they or any parent group is filtered
     * - Groups are filtered if they are explicitly filtered OR if all their children are filtered
     *
     * This needs to be applied recursively to handle nested task structures
     * (e.g., GitHub Actions with workflow -> job hierarchy)
     */
    const filterTask = (task: TaskItem): TaskItem | null => {
      // Check if this specific item is directly filtered
      const isDirectlyFiltered = task.id ? filteredService.isFiltered(task.id) : false;

      // Check if this item or any parent is filtered
      const isFilteredViaParent = filteredService.isFilteredOrHasFilteredParent(task);

      // If not in show hidden mode and item/parent is filtered, exclude it
      if (!showHiddenMode && isFilteredViaParent) {
        return null;
      }

      // If task has children, recursively filter them
      if (task.children && task.children.length > 0) {
        const filteredChildren = task.children
          .map(child => filterTask(child))
          .filter((child): child is TaskItem => child !== null);

        // Update the task's children with filtered results
        task.children = filteredChildren;

        // If this is a group and all children were filtered out, hide the group too
        // (unless we're in show hidden mode or the group itself is explicitly filtered)
        const isGroup = task.taskType === 'workspace' ||
          task.taskType === 'type' ||
          task.taskType === 'folder';

        if (!showHiddenMode && isGroup && filteredChildren.length === 0 && !isDirectlyFiltered) {
          // All children filtered out and group not explicitly filtered
          // Hide the empty group
          return null;
        }
      }

      return task;
    };

    // Apply filtering to all tasks
    const filteredTasks = showHiddenMode
      ? tasks // Show all tasks in show hidden mode
      : tasks
        .map(task => filterTask(task))
        .filter((task): task is TaskItem => task !== null);

    // Determine group state based on collapseLevel
    // Level 1 = Groups Expanded (Expand All).
    // Level 2 = Roots Collapsed.
    // Level 0 = Groups Collapsed (Default).

    // Determine Group Items Collapsible State and ID Salt
    // If we're in Default (Level 0), we use Collapsed as default for standard groups, but Visual Studio Code persistence should handle expansions.
    // Favorites/Recent/CompoundTasks will verify their own config for default state.

    let groupState = vscode.TreeItemCollapsibleState.Collapsed;
    let groupSalt = '';

    if (this.collapseLevel === 1) {
      groupState = vscode.TreeItemCollapsibleState.Expanded;
      groupSalt = 'expanded';
    } else if (this.collapseLevel === 2) {
      groupSalt = 'roots_collapsed';
    }

    const rootSalt = this.collapseLevel === 2 ? 'collapsed' : '';

    // Map<WorkspaceId, Map<TaskType, TaskItem[]>>
    // We use Workspace URI as key to ensure uniqueness even if names are identical
    const workspaceMap = new Map<string, Map<string, TaskItem[]>>();
    const workspaceInfoMap = new Map<string, string>(); // URI -> Name mapping

    const favoriteTasks: TaskItem[] = [];
    const allRecentTasks = (RecentTasksService.getInstance() as any).getRecentTasks();
    const recentTasks = showHiddenMode
      ? allRecentTasks
      : allRecentTasks.filter((t: TaskItem) => !filteredService.isFilteredOrHasFilteredParent(t));

    const favoritesService = FavoritesService.getInstance();
    const compoundTaskService = CompoundTaskService.getInstance();

    // Helper to recursively check and add favorites
    const checkFavorite = (item: TaskItem) => {
      if (favoritesService.isFavorite(item)) {
        // Clone task for favorites view
        const favTask = new TaskItem(
          item.label,
          item.collapsibleState === vscode.TreeItemCollapsibleState.None
            ? vscode.TreeItemCollapsibleState.None
            : vscode.TreeItemCollapsibleState.Collapsed,
          item.taskType,
          item.taskFileUri,
          item.command,
          item.defaultIconPath,
        );
        favTask.originalLabel = item.originalLabel || item.label;
        favTask.startLine = item.startLine;
        favTask.metadata = item.metadata;
        // Preserve file association and source/provider so that cloned items remain runnable
        favTask.taskFileUri = item.taskFileUri;
        favTask.taskSource = item.taskSource;
        favTask.taskOrigin = item.taskOrigin;

        // Clone children if any (deep clone not strictly necessary if we rebuild tree, but favorites structure uses specific parent)
        // For favorites, we might want to flatten or keep structure.
        // If the item itself is favorited, we likely want access to its children.
        if (item.children.length > 0) {
          // Create copies of children for the favorite item
          favTask.children = item.children.map((child) => {
            const childCopy = new TaskItem(
              child.label,
              child.collapsibleState,
              child.taskType,
              child.taskFileUri,
              child.command,
              child.defaultIconPath,
            );
            childCopy.originalLabel = child.originalLabel;
            childCopy.startLine = child.startLine;
            childCopy.metadata = child.metadata;
            childCopy.parent = favTask;
            // Preserve child file association and source/provider as well
            childCopy.taskFileUri = child.taskFileUri;
            childCopy.taskSource = child.taskSource;
            childCopy.taskOrigin = child.taskOrigin;
            // We don't recurse deeper for now as typically tasks are 1-2 levels deep.
            // But for GitHub Actions -> Events -> (maybe Jobs?), we might need more.
            // Actually GH Actions is "File -> Event / Job". Depth is 1.
            return childCopy;
          });
        }

        // Set description to workspace folder
        const itemUri = item.taskFileUri || item.resourceUri;
        const workspaceFolder = itemUri ? vscode.workspace.getWorkspaceFolder(itemUri) : undefined;
        let description = workspaceFolder ? workspaceFolder.name : '';

        if (itemUri && workspaceFolder) {
          const relativePath = vscode.workspace.asRelativePath(itemUri, false);
          if (relativePath && relativePath !== description) {
            description = `${description} • ${relativePath}`;
          }
        }
        favTask.description = description;

        // Must set ID before updating context value so that getTaskId works correctly on the clone
        // But wait, the clone has a fresh ID from constructor.
        // We want the clone to behave like the original for status lookup, but be unique in tree.
        // TaskStateManager.getTaskId strips 'fav:', so that logic works.
        // BUT, we need to ensure the ID is set to `fav:...` AFTER updateContextValue calls getTaskId(this)
        // NO, updateContextValue calls getTaskId(this).
        // If we set favTask.id = `fav:${favTask.id}` afterwards, then during updateContextValue, it has the ORIGINAL id (or similar).

        // Let's set the ID first to what it WOULD be on the original to ensure getTaskId retrieves the canonical ID correctly?
        // No, the new TaskItem constructor logic sets ID based on params.
        // We should explicitly set the ID to match the item's ID first (preserving base ID for lookup)
        // Then applying the prefix.

        // Fix: Ensure the favTask has the ID of the original item initially so lookups work?
        // The constructor generates a new ID.
        // Let's force the ID to match the original item's ID first.
        favTask.id = item.id;

        favTask.updateContextValue();
        // Override context value to ensure it is 'favoriteTask' even if logic inside updateContextValue missed it?
        // updateContextValue uses isFavorite(id). Since we set favTask.id = item.id, getTaskId should return the canonical ID.
        // And isFavorite(canonicalId) should be true.
        // So contextValue should be 'favoriteTask' or 'runningTask'.

        // Finally, prefix the ID for tree uniqueness
        favTask.id = `fav:${item.id}`;

        favoriteTasks.push(favTask);
      }

      // Check children only if the parent wasn't added?
      // Or should we support having a parent AND a child favorited separately?
      // Yes, user might favorite a specific job.
      if (item.children) {
        item.children.forEach((child) => checkFavorite(child));
      }
    };

    // Helper to recursively update context value
    const updateContextRecursively = (item: TaskItem) => {
      item.updateContextValue();
      if (item.children) {
        item.children.forEach((child) => updateContextRecursively(child));
      }
    };

    for (const task of filteredTasks) {
      checkFavorite(task);
      updateContextRecursively(task);

      const taskUri = task.taskFileUri || task.resourceUri;
      if (!taskUri) {
        const workspaceId = 'workspace_generic';
        const workspaceName = 'Workspace';
        workspaceInfoMap.set(workspaceId, workspaceName);

        let projectMap = workspaceMap.get(workspaceId);
        if (!projectMap) {
          projectMap = new Map<string, TaskItem[]>();
          workspaceMap.set(workspaceId, projectMap);
        }

        let typeTasks = projectMap.get(task.taskType);
        if (!typeTasks) {
          typeTasks = [];
          projectMap.set(task.taskType, typeTasks);
        }
        typeTasks.push(task);
        continue;
      }
      // ... rest of loop processing for normal view

      // Update context value for the original task item to reflect current state
      // task.updateContextValue(); // Moved to start of loop and made recursive

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(taskUri);

      // User-level global tasks (taskOrigin === 'user') live outside any workspace folder.
      // Instead of placing them in "External", assign them to each workspace folder so
      // they appear alongside workspace tasks. In multi-root setups each workspace folder
      // gets its own clone of the task so VS Code tree IDs remain unique.
      if (!workspaceFolder && task.taskOrigin === 'user') {
        const allFolders = vscode.workspace.workspaceFolders;
        if (allFolders && allFolders.length > 0) {
          for (const folder of allFolders) {
            const wsId = folder.uri.toString();
            workspaceInfoMap.set(wsId, folder.name);

            let projectMap = workspaceMap.get(wsId);
            if (!projectMap) {
              projectMap = new Map<string, TaskItem[]>();
              workspaceMap.set(wsId, projectMap);
            }

            let typeTasks = projectMap.get(task.taskType);
            if (!typeTasks) {
              typeTasks = [];
              projectMap.set(task.taskType, typeTasks);
            }

            // Clone the task for each workspace so each instance gets a unique parent/ID
            const copy = this.cloneUserTaskForWorkspace(task, folder);
            typeTasks.push(copy);
          }
          continue;
        }
      }

      const workspaceName = workspaceFolder ? workspaceFolder.name : 'External';
      const workspaceId = workspaceFolder ? workspaceFolder.uri.toString() : 'external';
      workspaceInfoMap.set(workspaceId, workspaceName);

      let projectMap = workspaceMap.get(workspaceId);
      if (!projectMap) {
        projectMap = new Map<string, TaskItem[]>();
        workspaceMap.set(workspaceId, projectMap);
      }

      let typeTasks = projectMap.get(task.taskType);
      if (!typeTasks) {
        typeTasks = [];
        projectMap.set(task.taskType, typeTasks);
      }
      typeTasks.push(task);
    }

    // Build the tree items
    const rootItems: TaskItem[] = [];
    const compoundTaskGroups: TaskItem[] = [];
    const favoriteCompoundGroups: TaskItem[] = [];
    const vscodeCompoundTasksForGroup: TaskItem[] = [];
    let favGroup: TaskItem | undefined;
    let recentGroup: TaskItem | undefined;
    let compoundTaskGroup: TaskItem | undefined; // TODO: for when they are grouped.
    const workspaceRoots: TaskItem[] = [];

    // Add Compound Task Groups
    const allCompoundTasks = compoundTaskService.getAllCompoundTasks();
    for (const [compoundTaskName, compoundTaskItems] of allCompoundTasks) {
      if (compoundTaskItems.length > 0) {
        const compoundTaskId = `${constants.COMPOUND_TASK_ID_PREFIX}:${compoundTaskName}`;
        const compoundTaskGroup = new TaskItem(
          compoundTaskName,
          this.getExpandedState(compoundTaskId, this.getRootState('compoundTask', expandedGroups)),
          'compoundTask'
        );
        const executionType = compoundTaskService.getCompoundTaskExecutionType(compoundTaskName);
        compoundTaskGroup.iconPath = {
          light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', `${executionType}.svg`)),
          dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', `${executionType}.svg`)),
        };
        compoundTaskGroup.id = compoundTaskId;
        // Update context value after setting the final ID
        compoundTaskGroup.updateContextValue();

        // Override context value and icon when compound task is actively running
        if (compoundTaskService.isCompoundTaskRunning(compoundTaskName)) {
          compoundTaskGroup.contextValue = 'runningCompoundTask';
          compoundTaskGroup.iconPath = new vscode.ThemeIcon('loading~spin');
        }

        // Create Compound Task Items
        for (const task of compoundTaskItems) {
          const iconObj = TaskIconService.getInstance().getTaskTypeIcon(task.taskType);
          const iconPath = iconObj ? iconObj.TaskIcon : undefined;

          // If this task has dependsOn labels, it is a VSCode compound (dependent) task.
          // In that case, show it as collapsible so users can see its dependency tasks.
          const dependsOnLabels: string[] = task.metadata?.dependsOnLabels || [];

          const compoundTaskItem = new TaskItem(
            task.label,
            dependsOnLabels.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            task.taskType,
            task.taskFileUri,
            task.command,
            iconPath,
          );
          compoundTaskItem.originalLabel = task.originalLabel || task.label;
          compoundTaskItem.startLine = task.startLine;
          compoundTaskItem.metadata = task.metadata;
          // Set description to workspace folder and file path
          const workspaceFolder = task.taskFileUri ? vscode.workspace.getWorkspaceFolder(task.taskFileUri) : undefined;
          let description = workspaceFolder ? workspaceFolder.name : '';

          if (task.taskFileUri && workspaceFolder) {
            const relativePath = vscode.workspace.asRelativePath(task.taskFileUri, false);
            if (relativePath && relativePath !== description) {
              description = `${description} • ${relativePath}`;
            }
          }
          compoundTaskItem.description = description;

          // Set context value to 'queuedTask' so that compound task child items show standard
          // task action bar items (run, open, favorites) plus the "Remove from Compound Task" action.
          // updateContextValue() preserves 'queuedTask' as the base and will produce
          // 'runningQueuedTask' when the task is actively running.
          compoundTaskItem.contextValue = 'queuedTask';
          compoundTaskItem.parent = compoundTaskGroup;

          // Re-sync ID just like favorites
          compoundTaskItem.id = task.id; // Use original task ID for status lookup
          compoundTaskItem.updateContextValue(); // Updates status (running/success/fail), preserves queuedTask as base

          compoundTaskItem.id = `${constants.COMPOUND_TASK_ID_PREFIX}:${compoundTaskName}:${compoundTaskItem.id}`;

          // Add dependency task items as children when the task has dependsOn labels.
          // These are displayed as read-only informational sub-items (contextValue: 'compoundTaskDependency')
          // so users can see which tasks this VSCode compound task depends on.
          if (dependsOnLabels.length > 0) {
            const allCacheTasks = TaskCacheService.getInstance().getAllTasks();
            const depIconObj = TaskIconService.getInstance().getTaskTypeIcon('vscode');
            const depIconPath = depIconObj ? depIconObj.TaskIcon : undefined;

            for (const depLabel of dependsOnLabels) {
              // Look up the matching VSCode task from the cache by label and file URI
              const depTask = allCacheTasks.find(
                (t) =>
                  t.taskType === 'vscode' &&
                  String(t.originalLabel || t.label).toLowerCase() === depLabel.toLowerCase() &&
                  t.taskFileUri?.toString() === task.taskFileUri?.toString(),
              );

              const depItem = new TaskItem(
                depLabel,
                vscode.TreeItemCollapsibleState.None,
                'vscode',
                depTask?.taskFileUri ?? task.taskFileUri,
                undefined,
                depTask?.defaultIconPath ?? depIconPath,
              );
              depItem.originalLabel = depLabel;
              depItem.startLine = depTask?.startLine;
              depItem.metadata = depTask?.metadata;
              // Set description same as parent compound task item
              depItem.description = description;
              depItem.parent = compoundTaskItem;

              // Use the dep task's original ID for status (running/success/fail) lookup,
              // then update context value so the item gets the same action bar as its task type,
              // then prefix the ID for tree node uniqueness.
              depItem.id = depTask?.id ?? depItem.id;
              depItem.updateContextValue();
              depItem.id = `${compoundTaskItem.id}:dep:${depItem.id}`;

              compoundTaskItem.children.push(depItem);
            }
          }

          compoundTaskGroup.children.push(compoundTaskItem);
        }
        compoundTaskGroups.push(compoundTaskGroup);

        // If this compound task group is a favorite, create a clone for the favorites section
        if (favoritesService.isFavorite(compoundTaskGroup)) {
          const favCompoundGroup = new TaskItem(
            compoundTaskName,
            this.getExpandedState(`fav:${compoundTaskId}`, this.getGroupState('favorites', expandedGroups)),
            'compoundTask',
          );
          favCompoundGroup.iconPath = compoundTaskGroup.iconPath;
          // Use the original (non-prefixed, non-fav) ID for state lookups, then prefix for tree uniqueness
          favCompoundGroup.id = compoundTaskId;
          favCompoundGroup.updateContextValue(); // Sets 'favoriteCompoundTask'

          if (compoundTaskService.isCompoundTaskRunning(compoundTaskName)) {
            favCompoundGroup.contextValue = 'runningFavoriteCompoundTask';
            favCompoundGroup.iconPath = new vscode.ThemeIcon('loading~spin');
          }

          // Clone children so the favorites copy has its own tree nodes
          favCompoundGroup.children = compoundTaskGroup.children.map((child) => {
            const childCopy = new TaskItem(
              child.label,
              child.collapsibleState,
              child.taskType,
              child.taskFileUri,
              child.command,
              child.defaultIconPath,
            );
            childCopy.originalLabel = child.originalLabel;
            childCopy.startLine = child.startLine;
            childCopy.metadata = child.metadata;
            childCopy.taskFileUri = child.taskFileUri;
            childCopy.description = child.description;
            childCopy.contextValue = child.contextValue;
            childCopy.parent = favCompoundGroup;
            // Re-use the same ID so running state is shared with the original
            childCopy.id = child.id;

            // Clone dependency grandchildren (sub-items of a VSCode compound/dependent task)
            if (child.children.length > 0) {
              childCopy.children = child.children.map((grandchild) => {
                const grandchildCopy = new TaskItem(
                  grandchild.label,
                  grandchild.collapsibleState,
                  grandchild.taskType,
                  grandchild.taskFileUri,
                  grandchild.command,
                  grandchild.defaultIconPath,
                );
                grandchildCopy.originalLabel = grandchild.originalLabel;
                grandchildCopy.startLine = grandchild.startLine;
                grandchildCopy.metadata = grandchild.metadata;
                grandchildCopy.taskFileUri = grandchild.taskFileUri;
                grandchildCopy.description = grandchild.description;
                grandchildCopy.contextValue = grandchild.contextValue;
                grandchildCopy.parent = childCopy;
                grandchildCopy.id = grandchild.id;
                return grandchildCopy;
              });
            }

            return childCopy;
          });

          // Prefix the ID so this node is unique in the VS Code tree
          favCompoundGroup.id = `fav:${compoundTaskId}`;
          favoriteCompoundGroups.push(favCompoundGroup);
        }
      }
    }

    // Collect VSCode compound tasks (with dependsOn) for the Compound Tasks group
    if (compoundTasksGroupEnabled && includeVsCodeCompoundTasks) {
      const allCacheTasks = TaskCacheService.getInstance().getAllTasks();
      const vscodeIconObj = TaskIconService.getInstance().getTaskTypeIcon('vscode');
      const vscodeDepIconPath = vscodeIconObj ? vscodeIconObj.TaskIcon : undefined;

      for (const task of filteredTasks) {
        if (task.taskType !== 'vscode') {
          continue;
        }
        const dependsOnLabels: string[] = Array.isArray(task.metadata?.dependsOnLabels)
          ? task.metadata.dependsOnLabels
          : [];
        if (dependsOnLabels.length === 0) {
          continue;
        }

        const iconObj = TaskIconService.getInstance().getTaskTypeIcon(task.taskType);
        const iconPath = iconObj ? iconObj.TaskIcon : undefined;

        const compoundItem = new TaskItem(
          task.label,
          vscode.TreeItemCollapsibleState.Collapsed,
          task.taskType,
          task.taskFileUri,
          task.command,
          iconPath,
        );
        compoundItem.originalLabel = task.originalLabel || task.label;
        compoundItem.startLine = task.startLine;
        compoundItem.metadata = task.metadata;
        compoundItem.taskFileUri = task.taskFileUri;
        compoundItem.taskSource = task.taskSource;
        compoundItem.taskOrigin = task.taskOrigin;
        compoundItem.task = task.task;

        const taskWsFolder = task.taskFileUri ? vscode.workspace.getWorkspaceFolder(task.taskFileUri) : undefined;
        let taskDescription = taskWsFolder ? taskWsFolder.name : '';
        if (task.taskFileUri && taskWsFolder) {
          const relativePath = vscode.workspace.asRelativePath(task.taskFileUri, false);
          if (relativePath && relativePath !== taskDescription) {
            taskDescription = `${taskDescription} • ${relativePath}`;
          }
        }
        compoundItem.description = taskDescription;

        // Use the original task ID for state (running/success/fail) lookup, then prefix for tree uniqueness
        compoundItem.id = task.id;
        compoundItem.updateContextValue();
        compoundItem.id = `${constants.VSCODE_COMPOUND_TASK_ID_PREFIX}:${task.id}`;

        // Build dependency sub-items
        for (const depLabel of dependsOnLabels) {
          const depTask = allCacheTasks.find(
            (t) =>
              t.taskType === 'vscode' &&
              String(t.originalLabel || t.label).toLowerCase() === depLabel.toLowerCase() &&
              t.taskFileUri?.toString() === task.taskFileUri?.toString(),
          );

          const depItem = new TaskItem(
            depLabel,
            vscode.TreeItemCollapsibleState.None,
            'vscode',
            depTask?.taskFileUri ?? task.taskFileUri,
            undefined,
            depTask?.defaultIconPath ?? vscodeDepIconPath,
          );
          depItem.originalLabel = depLabel;
          depItem.startLine = depTask?.startLine;
          depItem.metadata = depTask?.metadata;
          depItem.description = taskDescription;
          depItem.parent = compoundItem;
          depItem.id = depTask?.id ?? depItem.id;
          depItem.updateContextValue();
          depItem.id = `${compoundItem.id}:dep:${depItem.id}`;
          compoundItem.children.push(depItem);
        }

        vscodeCompoundTasksForGroup.push(compoundItem);
      }
    }

    // Add Favorites Group
    if (favoriteTasks.length > 0 || favoriteCompoundGroups.length > 0) {
      const favGroupId = this.makeId('favorites', rootSalt);
      favGroup = new TaskItem(
        'Favorites', // TODO: support localization from package.nls.json (%tree.favorites%)
        this.getExpandedState(favGroupId, this.getRootState('favorites', expandedGroups)),
        'favorites',
      );
      // Salt favorites
      favGroup.id = favGroupId;
      // Update context value after setting the final ID
      favGroup.updateContextValue();
      favGroup.iconPath = new vscode.ThemeIcon('star-full');

      // Add favorited compound task groups directly as children (not bucketed by type)
      for (const favCompoundGroup of favoriteCompoundGroups) {
        favCompoundGroup.parent = favGroup;
        // parent setter triggers updateContextValue() which resets the running override;
        // re-apply it so the correct contextValue is preserved.
        const favCompoundName = favCompoundGroup.label as string;
        if (compoundTaskService.isCompoundTaskRunning(favCompoundName)) {
          favCompoundGroup.contextValue = 'runningFavoriteCompoundTask';
          favCompoundGroup.iconPath = new vscode.ThemeIcon('loading~spin');
        }
        favGroup.children.push(favCompoundGroup);
      }

      // Group leaf favorites by type
      const favTypeMap = new Map<string, TaskItem[]>();
      for (const task of favoriteTasks) {
        let list = favTypeMap.get(task.taskType);
        if (!list) {
          list = [];
          favTypeMap.set(task.taskType, list);
        }
        list.push(task);
      }

      for (const [type, tasks] of favTypeMap) {
        const typeId = this.makeId(`fav:${type}`, groupSalt);
        const typeItem = TaskTypeFactory.create(type, this.getExpandedState(typeId, this.getGroupState('favorites', expandedGroups)), WorkspaceTasksService.getInstance().getIconUri(type));
        typeItem.id = typeId;
        typeItem.children = tasks;
        typeItem.parent = favGroup;
        for (const child of tasks) {
          child.parent = typeItem;
        }
        // Sort favorites
        typeItem.children.sort((a, b) => a.label.localeCompare(b.label));
        favGroup.children.push(typeItem);
      }
      // Sort favorite groups by name
      favGroup.children.sort((a, b) => a.label.localeCompare(b.label));
    }

    // Add Recent Tasks Group
    if (recentTasks.length > 0) {
      const recentGroupId = this.makeId('recent', rootSalt);
      recentGroup = new TaskItem('Recent Tasks', this.getExpandedState(recentGroupId, this.getRootState('recent', expandedGroups)), 'recent');
      // Salt recent
      recentGroup.id = recentGroupId;
      // Update context value after setting the final ID
      recentGroup.updateContextValue();
      recentGroup.iconPath = new vscode.ThemeIcon('history');

      if (recentGroupsEnabled) {
        // Group by type
        const recentTypeMap = new Map<string, TaskItem[]>(); // Maintain insertion order for recency?
        // Wait, if we group by type, we lose the strict "most recent" global ordering in visual representation.
        // But user asked for order from "most recently executed".
        // Inside each group, they should be ordered by recency.

        // Map will iterate in insertion order which matches RecentTasksService order (most recent first).

        for (const task of recentTasks) {
          let list = recentTypeMap.get(task.taskType);
          if (!list) {
            list = [];
            recentTypeMap.set(task.taskType, list);
          }
          list.push(task);
        }

        for (const [type, tasks] of recentTypeMap) {
          const typeId = this.makeId(`recent:${type}`, groupSalt);
          const typeItem = TaskTypeFactory.create(type, this.getExpandedState(typeId, this.getGroupState('recent', expandedGroups)), WorkspaceTasksService.getInstance().getIconUri(type));
          typeItem.id = typeId;
          typeItem.children = tasks.map((t: TaskItem) => {
            const iconPath = t.defaultIconPath;
            const copy = new TaskItem(
              t.label,
              vscode.TreeItemCollapsibleState.None,
              t.taskType,
              t.taskFileUri,
              t.command,
              iconPath,
            );
            copy.originalLabel = t.originalLabel || t.label;
            copy.startLine = t.startLine;
            copy.metadata = t.metadata;
            // Preserve file association and source/provider so recent items remain runnable
            copy.taskFileUri = t.taskFileUri;
            copy.taskSource = t.taskSource;
            copy.taskOrigin = t.taskOrigin;
            copy.description = t.description; // Preserve description (folder name etc)
            copy.parent = typeItem;
            copy.id = `recent:${t.id}`;
            copy.contextValue = 'recentTask';
            copy.updateContextValue();
            return copy;
          });

          typeItem.parent = recentGroup;
          recentGroup.children.push(typeItem);
        }
        // Do NOT sort groups by name? Recent is temporal.
        // But user said "ordered from 'most recently executed'".
        // If grouped by type, groups order implies ... ?
        // Maybe sort groups by the timestamp of the *latest* task in them?
        // Since we iterated in recency order build the map, the map keys order (insertion order)
        // will be order of first appearance of that type. Which is correct for "most recent type first".
        // So we leave it as is (insertion order).
      } else {
        // Flat list
        const seenRecentIds = new Set<string>();

        recentGroup.children = recentTasks.map((t: TaskItem) => {
          // Use the default icon path from the original task item which is hydrated from the cache
          // Always recalculate icon to ensure consistency, especially for items with no default icon (like makefiles)
          const iconObj = TaskIconService.getInstance().getTaskTypeIcon(t.taskType);
          const iconPath = iconObj && iconObj.TaskIcon ? iconObj.TaskIcon : undefined;

          const copy = new TaskItem(
            t.label,
            vscode.TreeItemCollapsibleState.None,
            t.taskType,
            t.taskFileUri,
            t.command,
            iconPath,
          );
          // We should ideally show descriptions if same name exists
          copy.originalLabel = t.originalLabel || t.label;
          copy.startLine = t.startLine;
          copy.metadata = t.metadata;
          // Preserve file association and source/provider so recent items remain runnable
          copy.taskFileUri = t.taskFileUri;
          copy.taskSource = t.taskSource;
          copy.taskOrigin = t.taskOrigin;
          copy.description = t.description;
          copy.parent = recentGroup;

          let uniqueId = `recent:${t.id}`;
          let counter = 1;
          const baseId = uniqueId;

          while (seenRecentIds.has(uniqueId)) {
            uniqueId = `${baseId}|${counter++}`;
          }
          seenRecentIds.add(uniqueId);

          copy.id = uniqueId;
          copy.contextValue = 'recentTask';
          copy.updateContextValue();
          return copy;
        });
      }
    }

    if (!groupsEnabled) {
      const tasksRoot = new TaskItem(
        'Tasks', // TODO: support localization from package.nls.json (%tree.tasks%)
        vscode.TreeItemCollapsibleState.Expanded,
        'folder',
      );

      const taskIcon = TaskIconService.getInstance().getTaskTypeIcon('task');
      if (taskIcon?.TaskIcon) {
        tasksRoot.iconPath = taskIcon.TaskIcon;
      }

      const flatTasks: TaskItem[] = [];
      for (const projectMap of workspaceMap.values()) {
        for (const typeTasks of projectMap.values()) {
          flatTasks.push(...typeTasks);
        }
      }
      flatTasks.sort((a, b) => a.label.localeCompare(b.label));

      tasksRoot.children = flatTasks;
      for (const t of flatTasks) {
        t.parent = tasksRoot;
      }
      workspaceRoots.push(tasksRoot);
    } else {
      // Sort workspaceIds by name using the lookup map
      const sortedWorkspaceIds = Array.from(workspaceMap.keys()).sort((a, b) => {
        const nameA = workspaceInfoMap.get(a) || '';
        const nameB = workspaceInfoMap.get(b) || '';
        return nameA.localeCompare(nameB);
      });

      for (const workspaceId of sortedWorkspaceIds) {
        const projectMap = workspaceMap.get(workspaceId)!;
        const workspaceName = workspaceInfoMap.get(workspaceId)!;

        const workspaceIdStr = this.makeId(`workspace:${workspaceId}`, rootSalt);
        const workspaceItem = new TaskItem(workspaceName, this.getExpandedState(workspaceIdStr, this.getRootState('workspace', expandedGroups)), 'workspace');
        // Salt the ID of workspace item too!
        // Make ID robust using workspace ID (URI or special string)
        workspaceItem.id = workspaceIdStr;
        // Update context value after setting the final ID
        workspaceItem.updateContextValue();

        // Try to enable folder icon for workspace item explicitly found via URI
        // Not essential but might look better
        workspaceItem.iconPath = vscode.ThemeIcon.Folder;

        for (const [taskType, typeTasks] of projectMap) {
          const typeItemId = this.makeId(`type:${taskType}:${workspaceId}`, groupSalt);
          // Use Factory to create typed item
          const typeItem = TaskTypeFactory.create(taskType, this.getExpandedState(typeItemId, groupState), WorkspaceTasksService.getInstance().getIconUri(taskType));
          // Use workspaceId in ID key for robustness
          typeItem.id = typeItemId;
          // Update context value after setting the final ID
          typeItem.updateContextValue();

          if (useParentFolder) {
            typeItem.children = this.groupTasksByParentFolder(
              typeTasks,
              taskSeparator,
              taskType,
              workspaceId,
              groupSalt,
            );
          } else {
            typeItem.children = this.groupTasksByName(typeTasks, taskSeparator);
          }

          typeItem.parent = workspaceItem;
          // groupTasksByName already sets parent for its direct children? No, I need to check
          for (const child of typeItem.children) {
            child.parent = typeItem;
          }

          // Create correct context value now that children are populated (checks for all-hidden children)
          typeItem.updateContextValue();

          workspaceItem.children.push(typeItem);
        }
        // Sort types by name
        workspaceItem.children.sort((a, b) => a.label.localeCompare(b.label));

        // Create correct context value now that children are populated (checks for all-hidden children)
        workspaceItem.updateContextValue();

        workspaceRoots.push(workspaceItem);
      }
    }

    // Assemble final root order: Recent, Favorites, Compound Tasks, Projects
    if (recentGroup) {
      rootItems.push(recentGroup);
    }
    if (favGroup) {
      rootItems.push(favGroup);
    }
    if (compoundTaskGroups.length > 0 || vscodeCompoundTasksForGroup.length > 0) {
      if (compoundTasksGroupEnabled) {
        // Wrap all compound task groups under a single "Compound Tasks" root item
        const compoundTasksRootId = this.makeId('compoundTasks', rootSalt);
        const compoundTasksRoot = new TaskItem(
          'Compound Tasks',
          this.getExpandedState(compoundTasksRootId, this.getRootState('compoundTasks', expandedGroups)),
          'compoundTasks',
        );
        compoundTasksRoot.id = compoundTasksRootId;
        compoundTasksRoot.updateContextValue();
        compoundTasksRoot.iconPath = new vscode.ThemeIcon('layers');

        // Add VSCode compound tasks (from tasks.json dependsOn) as direct root children
        for (const item of vscodeCompoundTasksForGroup) {
          item.parent = compoundTasksRoot;
          compoundTasksRoot.children.push(item);
        }

        for (const group of compoundTaskGroups) {
          group.parent = compoundTasksRoot;
          compoundTasksRoot.children.push(group);
        }
        rootItems.push(compoundTasksRoot);
      } else {
        rootItems.push(...compoundTaskGroups);
      }
    }

    // Add remaining project roots
    rootItems.push(...workspaceRoots);

    return rootItems;
  }

  /**
   * Helper to get workspace folder for a URI.
   * Can be overridden for testing.
   */
  protected getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
  }

  /**
   * Creates a shallow clone of a user-level global task item scoped to a specific workspace folder.
   * All original properties (file URI, start line, commands, etc.) are preserved so the task
   * can still be opened/run correctly. The clone's ID is prefixed with the workspace folder name
   * to keep tree node IDs unique in multi-root setups.
   */
  private cloneUserTaskForWorkspace(task: TaskItem, folder: vscode.WorkspaceFolder): TaskItem {
    const copy = new TaskItem(
      task.label,
      task.collapsibleState,
      task.taskType,
      task.taskFileUri,
      task.command,
      task.defaultIconPath,
      task.onRunActionCommand,
      task.onRunWithArgsActionCommand,
    );
    copy.originalLabel = task.originalLabel || task.label;
    copy.startLine = task.startLine;
    copy.metadata = task.metadata;
    copy.taskFileUri = task.taskFileUri;
    copy.taskSource = task.taskSource;
    copy.taskOrigin = task.taskOrigin;
    copy.description = task.description;
    copy.onOpenActionCommand = task.onOpenActionCommand;
    copy.task = task.task;

    // Use a workspace-scoped ID so each workspace gets a distinct tree node.
    // This prevents VS Code from treating the same user task as the same tree item
    // when it appears under multiple workspaces in a multi-root setup.
    // Use folder.index to ensure uniqueness even if folder names are identical in multi-root workspace.
    copy.id = `workspace:${folder.index}:user-global:${task.originalLabel || task.label}`;
    copy.updateContextValue();

    return copy;
  }

  /**
   * Group tasks by the parent folder name
   * @param tasks
   * @param separator
   * @param taskType
   * @param workspaceId
   * @param groupSalt
   * @returns
   */
  public groupTasksByParentFolder(
    tasks: TaskItem[],
    separator: string,
    taskType: string,
    workspaceId: string,
    groupSalt: string,
  ): TaskItem[] {
    const folderGroups = new Map<string, TaskItem[]>();
    const rootTasks: TaskItem[] = [];

    for (const task of tasks) {
      const uri = task.taskFileUri || task.resourceUri;
      let folderPath: string | undefined;

      if (uri) {
        const dir = path.dirname(uri.fsPath);
        const wsFolder = this.getWorkspaceFolder(uri);
        if (wsFolder && dir !== wsFolder.uri.fsPath) {
          folderPath = dir;
        }
      }

      if (folderPath) {
        let list = folderGroups.get(folderPath);
        if (!list) {
          list = [];
          folderGroups.set(folderPath, list);
        }
        list.push(task);
      } else {
        rootTasks.push(task);
      }
    }

    const folderChildren: TaskItem[] = [];
    for (const [folderPath, tasks] of folderGroups) {
      const folderName = path.basename(folderPath);
      const folderId = this.makeId(`folder:${folderPath}:${taskType}:${workspaceId}`, groupSalt);
      const folderItem = new TaskItem(folderName, this.getExpandedState(folderId, vscode.TreeItemCollapsibleState.Collapsed), 'folder');
      folderItem.id = folderId;
      // Update context value after setting the final ID
      folderItem.updateContextValue();
      folderItem.iconPath = vscode.ThemeIcon.Folder;
      folderItem.children = this.groupTasksByName(tasks, separator);
      for (const child of folderItem.children) {
        child.parent = folderItem;
      }
      folderItem.updateContextValue();
      folderChildren.push(folderItem);
    }
    folderChildren.sort((a, b) => a.label.localeCompare(b.label));

    const rootChildren = this.groupTasksByName(rootTasks, separator);

    return [...folderChildren, ...rootChildren];
  }

  public groupTasksByName(tasks: TaskItem[], separator: string, parentPath: string = ''): TaskItem[] {
    if (!separator) {
      return tasks.sort((a, b) => a.label.localeCompare(b.label));
    }

    const rootItems: TaskItem[] = [];
    const groups = new Map<string, TaskItem[]>();
    const leafs: TaskItem[] = [];

    for (const task of tasks) {
      const parts = task.label.split(separator);
      if (parts.length > 1) {
        const groupName = parts[0].trim();
        let groupList = groups.get(groupName);
        if (!groupList) {
          groupList = [];
          groups.set(groupName, groupList);
        }
        const remainder = parts.slice(1).join(separator).trim();
        const newTask = new TaskItem(
          remainder,
          task.collapsibleState,
          task.taskType,
          task.taskFileUri,
          task.onOpenActionCommand,
          task.iconPath,
          task.onRunActionCommand,
        );
        newTask.originalLabel = task.originalLabel || task.label;
        newTask.startLine = task.startLine;
        newTask.tooltip = task.tooltip;
        newTask.description = task.description;
        // Inherit ID from the original task to prevent collisions and ensure correct tracking
        // But only if this new task represents the "rest" of the split (which it is).
        // If we split further recursively, the final leaf will carry this ID.
        // Wait, if we push to groupList, and that groupList is recursively processed...
        // The Leaf at the end of the chain will eventually be created and needs this ID.
        // Is newTask the leaf? Or just the next segment?
        // newTask is the next segment effectively.
        // If newTask is "tests:unit" (from "npm:tests:unit"), it represents the task "npm:tests:unit".
        // It should carry the ID of "npm:tests:unit".
        // If it is split further, the next segment "unit" will inherit from "tests:unit" (which inherited from "npm:tests:unit").
        // So yes, inheriting ID at each step works.
        newTask.id = task.id;

        // Re-run context value update now that originalLabel is set
        newTask.updateContextValue();

        groupList.push(newTask);
      } else {
        leafs.push(task);
      }
    }

    for (const [groupName, groupTasks] of groups) {
      let iconUri: vscode.Uri | undefined;
      let iconPath: any | undefined;
      if (groupTasks.length > 0) {
        const typeItem = TaskTypeFactory.create(groupTasks[0].taskType, undefined, WorkspaceTasksService.getInstance().getIconUri(groupTasks[0].taskType));
        iconUri = typeItem.resourceUri;
        iconPath = typeItem.iconPath;
      }

      const fullGroupName = parentPath ? `${parentPath}${separator}${groupName}` : groupName;
      const groupId = `group:${fullGroupName}:${tasks[0]?.taskFileUri?.toString() || tasks[0]?.resourceUri?.toString() || 'unknown'}`;
      const groupItem = new TaskItem(groupName, this.getExpandedState(groupId, vscode.TreeItemCollapsibleState.Collapsed), 'folder', iconUri);
      groupItem.id = groupId;
      // Update context value after setting the final ID
      groupItem.updateContextValue();
      if (iconPath) {
        groupItem.iconPath = iconPath;
      } else if (iconUri) {
        groupItem.iconPath = vscode.ThemeIcon.File;
      }
      groupItem.children = this.groupTasksByName(groupTasks, separator, fullGroupName);
      for (const child of groupItem.children) {
        child.parent = groupItem;
      }
      groupItem.updateContextValue();

      rootItems.push(groupItem);
    }

    // Sort groups/leafs? Usually folders first
    rootItems.sort((a, b) => {
      if (a.contextValue === 'folder' && b.contextValue !== 'folder') {
        return -1;
      }
      if (a.contextValue !== 'folder' && b.contextValue === 'folder') {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });

    // Add leafs if any? wait. rootItems has groups.
    // Actually I should just merge leafs into rootItems and then sort.
    // But above I just pushed groups.

    rootItems.push(...leafs);

    // Sort again to ensure leafs are mixed or sorted properly
    rootItems.sort((a, b) => {
      // Folders first
      const aIsFolder = a.contextValue === 'folder' ? 1 : 0;
      const bIsFolder = b.contextValue === 'folder' ? 1 : 0;
      if (aIsFolder !== bIsFolder) {
        return bIsFolder - aIsFolder;
      }
      return a.label.localeCompare(b.label);
    });

    return rootItems;
  }

  private getRootState(
    type: RootTreeTypes,
    expandedGroups: ExpandedTaskGroups,
  ): vscode.TreeItemCollapsibleState {
    if (this.collapseLevel === 2) {
      return vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (this.collapseLevel === 1) {
      return vscode.TreeItemCollapsibleState.Expanded;
    }
    // Level 0 (Default config)
    if (type === 'favorites') {
      return expandedGroups.favorites
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (type === 'compoundTask' || type === 'compoundTasks') {
      return (expandedGroups.compoundTask ?? expandedGroups.queue ?? true)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (type === 'recent') {
      return expandedGroups.recent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    return vscode.TreeItemCollapsibleState.Expanded;
  }

  private getGroupState(
    rootType: RootTreeTypes,
    expandedGroups: ExpandedTaskGroups,
  ): vscode.TreeItemCollapsibleState {
    if (this.collapseLevel === 1) {
      return vscode.TreeItemCollapsibleState.Expanded;
    }
    if (this.collapseLevel === 2) {
      return vscode.TreeItemCollapsibleState.Collapsed;
    }
    // Level 0
    if (rootType === 'favorites') {
      return expandedGroups.favorites
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (rootType === 'recent') {
      return expandedGroups.recent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    if (rootType === 'compoundTask' || rootType === 'compoundTasks') {
      return (expandedGroups.compoundTask ?? expandedGroups.queue ?? true)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }
    return vscode.TreeItemCollapsibleState.Collapsed;
  }
}
