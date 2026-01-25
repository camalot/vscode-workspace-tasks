import * as vscode from 'vscode';
import { TaskProvider } from './taskProvider';
import { TaskItem } from './taskItem';
import { TaskTypeFactory } from './taskTypeItems';
import { TaskStateManager } from './taskStateManager';
import { TaskTreeDragAndDropController } from './taskTreeDragAndDropController';
import { TaskCacheService } from './services/taskCacheService';
import { TaskIconService } from './services/taskIconService';
import { RecentTasksService } from './services/recentTasksService';

export class TaskTreeDataProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskItem | undefined | null | void> = new vscode.EventEmitter<TaskItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskItem | undefined | null | void> = this._onDidChangeTreeData.event;

  public dragAndDropController: vscode.TreeDragAndDropController<TaskItem>;
  private view?: vscode.TreeView<TaskItem>;
  private currentRoots: TaskItem[] = [];
  private collapseLevel: number = 0;
  private pendingRevealLevel: number | undefined = undefined;
  // Use a dedicated emitter for roots updates to synchronize reveal actions
  private onRootsUpdated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  private refreshTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    this.dragAndDropController = new TaskTreeDragAndDropController();

    // Restore collapseLevel from workspace state (default to 0)
    // Actually we only care about restoring if it was 0, as other modes are temporary toggles usuallly?
    // But if persistence is tricky for groups, maybe we just default to 0.
    // The issue with persistence is likely that the TreeView doesn't know about these IDs until we feed them to it.

    // NOTE: VS Code persists expansion state based on ID.
  }

  public bindView(view: vscode.TreeView<TaskItem>) {
    this.view = view;
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
      if (!provider.type) { return; }
      const type = provider.type;

      if (this.refreshTimeouts.has(type)) {
          clearTimeout(this.refreshTimeouts.get(type));
      }

      this.refreshTimeouts.set(type, setTimeout(async () => {
          this.refreshTimeouts.delete(type);
          await TaskCacheService.getInstance().refreshProvider(type);
          this._onDidChangeTreeData.fire();
      }, 1000));
  }

  async refresh(): Promise<void> {
    await TaskCacheService.getInstance().refresh();
    this._onDidChangeTreeData.fire();
  }

  async collapseAllTaskGroups(): Promise<void> {
    if (!this.view) { return; }

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
    }
    else if (this.collapseLevel === 2) {
       // Collapse All Roots
       // Refresh tree with salt='roots_collapsed' and defaults to Collapsed.
       this.pendingRevealLevel = undefined;
       this._onDidChangeTreeData.fire();
       return;
    }
    else {
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
      return element.children;
    } else {
      const allTasks = TaskCacheService.getInstance().getAllTasks();
      this.currentRoots = this.organizeTasks(allTasks);

      // Fire update signal for collapse logic
      // Use setTimeout to ensure we are out of the immediate stack if needed,
      // but synchronous dispatch is usually fine for event emitters.
      // However, we must wait for VS Code to finish 'getting' children before we 'reveal'.
      // Actually VS Code calls getChildren, then renders.
      // So determining when render is complete is hard.
      // But typically firing a follow-up action a bit later works.
      if (this.pendingRevealLevel !== undefined) {
          const level = this.pendingRevealLevel;
          this.pendingRevealLevel = undefined;
          setTimeout(async () => {
              if (!this.view) return;
              for (const root of this.currentRoots) {
                try {
                    if (level === 1) {
                         // Ensure root is expanded 1 level deep (showing collapsed groups)
                         await this.view.reveal(root, { expand: 1, select: false, focus: false });
                    } else if (level === 0) {
                         // Ensure root is expanded 3 levels deep (showing tasks)
                         await this.view.reveal(root, { expand: 3, select: false, focus: false });
                    }
                } catch (e) { }
              }
          }, 100);
      }

      return this.currentRoots;
    }
  }

  private organizeTasks(tasks: TaskItem[]): TaskItem[] {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const groupsEnabled = config.get<boolean>('groups.enabled', true);
    const recentGroupsEnabled = config.get<boolean>('groups.recentTasks.enabled', false);
    const taskSeparator = config.get<string>('groups.taskSeparator', '-');

    // Determine group state based on collapseLevel
    // Level 1 = Groups Expanded (Expand All).
    // Level 2 = Roots Collapsed.
    // Level 0 = Groups Collapsed (Default).

    // Determine Group Items Collapsible State and ID Salt
    // If we're in Default (Level 0), we use Collapsed as default, but VS Code persistence should handle expansions.
    // If VS Code is forcing collapsed, we might need to be less aggressive with default.
    // However, user Requirement: "start off collapsed".
    // This implies that on *first* load (or if no state exists), it should be collapsed.

    let groupState = vscode.TreeItemCollapsibleState.Collapsed;
    let groupSalt = '';

    if (this.collapseLevel === 1) {
        groupState = vscode.TreeItemCollapsibleState.Expanded;
        groupSalt = 'expanded';
    } else if (this.collapseLevel === 2) {
         groupSalt = 'roots_collapsed';
    }

    // Determine Workspace Root Items Collapsible State and ID Salt
    // If Level 2, Root is Collapsed.
    const rootState = (this.collapseLevel === 2) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
    const rootSalt = (this.collapseLevel === 2) ? 'collapsed' : '';

    const mkId = (base: string, salt: string) => salt ? `${base}:${salt}` : base;

    // Map<WorkspaceId, Map<TaskType, TaskItem[]>>
    // We use Workspace URI as key to ensure uniqueness even if names are identical
    const workspaceMap = new Map<string, Map<string, TaskItem[]>>();
    const workspaceInfoMap = new Map<string, string>(); // URI -> Name mapping

    const favoriteTasks: TaskItem[] = [];
    const recentTasks = (RecentTasksService.getInstance() as any).getRecentTasks();

    const stateManager = TaskStateManager.getInstance();

    // Helper to recursively check and add favorites
    const checkFavorite = (item: TaskItem) => {
      const id = stateManager.getTaskId(item);
      if (stateManager.isFavorite(id)) {
          // Clone task for favorites view
          const favTask = new TaskItem(
              item.label,
              item.collapsibleState === vscode.TreeItemCollapsibleState.None ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
              item.taskType,
              item.resourceUri,
              item.command,
              item.defaultIconPath
          );
          favTask.originalLabel = item.originalLabel || item.label;
          favTask.startLine = item.startLine;
          favTask.metadata = item.metadata;

          // Clone children if any (deep clone not strictly necessary if we rebuild tree, but favorites structure uses specific parent)
          // For favorites, we might want to flatten or keep structure.
          // If the item itself is favorited, we likely want access to its children.
          if (item.children.length > 0) {
             // Create copies of children for the favorite item
             favTask.children = item.children.map(child => {
                 const childCopy = new TaskItem(
                     child.label,
                     child.collapsibleState,
                     child.taskType,
                     child.resourceUri,
                     child.command,
                     child.defaultIconPath
                 );
                 childCopy.originalLabel = child.originalLabel;
                 childCopy.startLine = child.startLine;
                 childCopy.metadata = child.metadata;
                 childCopy.parent = favTask;
                 // We don't recurse deeper for now as typically tasks are 1-2 levels deep.
                 // But for GitHub Actions -> Events -> (maybe Jobs?), we might need more.
                 // Actually GH Actions is "File -> Event / Job". Depth is 1.
                 return childCopy;
             });
          }

          // Set description to workspace folder
          const workspaceFolder = item.resourceUri ? vscode.workspace.getWorkspaceFolder(item.resourceUri) : undefined;
          let description = workspaceFolder ? workspaceFolder.name : '';

          if (item.resourceUri && workspaceFolder) {
              const relativePath = vscode.workspace.asRelativePath(item.resourceUri, false);
              if (relativePath && relativePath !== description) {
                  description = `${description} • ${relativePath}`;
              }
          }
          favTask.description = description;

          favTask.updateContextValue();
          favTask.id = `fav:${favTask.id}`;
          favoriteTasks.push(favTask);
      }

      // Check children only if the parent wasn't added?
      // Or should we support having a parent AND a child favorited separately?
      // Yes, user might favorite a specific job.
      if (item.children) {
          item.children.forEach(child => checkFavorite(child));
      }
    };

    // console.log(`[TaskTreeDataProvider] organizeTasks - Collapse Level: ${this.collapseLevel}`);

    for (const task of tasks) {
      checkFavorite(task);

      if (!task.resourceUri) {
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
      task.updateContextValue();

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(task.resourceUri);
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
    const queueGroups: TaskItem[] = [];
    let favGroup: TaskItem | undefined;
    let recentGroup: TaskItem | undefined;
    const workspaceRoots: TaskItem[] = [];

    // Add Queue Groups
    const allQueues = stateManager.getAllQueues();
    for (const [queueName, queueTasks] of allQueues) {
      if (queueTasks.length > 0) {
        const queueGroup = new TaskItem(
          queueName,
          vscode.TreeItemCollapsibleState.Expanded,
          'queue'
        );
        queueGroup.iconPath = new vscode.ThemeIcon('list-ordered');
        queueGroup.id = `queue:${queueName}`;

        // Create Queued Items
        for (const task of queueTasks) {
          const iconObj = TaskIconService.getInstance().getTaskTypeIcon(task.taskType);
          const iconPath = iconObj ? (iconObj.TaskIcon || iconObj.DisplayUri) : undefined;

          const queuedItem = new TaskItem(
            task.label,
            vscode.TreeItemCollapsibleState.None,
            task.taskType,
            task.resourceUri,
            task.command,
            iconPath
          );
          queuedItem.originalLabel = task.originalLabel || task.label;
          queuedItem.startLine = task.startLine;
          queuedItem.metadata = task.metadata;
          // Set description to workspace folder and file path
          const workspaceFolder = task.resourceUri ? vscode.workspace.getWorkspaceFolder(task.resourceUri) : undefined;
          let description = workspaceFolder ? workspaceFolder.name : '';

          if (task.resourceUri && workspaceFolder) {
              const relativePath = vscode.workspace.asRelativePath(task.resourceUri, false);
              if (relativePath && relativePath !== description) {
                  description = `${description} • ${relativePath}`;
              }
          }
          queuedItem.description = description;

          // Explicitly set context value for queued items to allow distinct actions
          queuedItem.contextValue = 'queuedTask';
          queuedItem.parent = queueGroup;
          queuedItem.id = `queue:${queueName}:${queuedItem.id}`;

          queueGroup.children.push(queuedItem);
        }
        queueGroups.push(queueGroup);
      }
    }

    // Add Favorites Group
    if (favoriteTasks.length > 0) {
      favGroup = new TaskItem(
        'Favorites', // TODO: support localization from package.nls.json (%tree.favorites%)
        rootState,
        'favorites'
      );
      // Salt favorites
      favGroup.id = mkId('favorites', rootSalt);
      favGroup.iconPath = new vscode.ThemeIcon('star-full');

      // Group favorites by type
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
        const typeItem = TaskTypeFactory.create(type, groupState);
        typeItem.id = mkId(`fav:${type}`, groupSalt);
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
      recentGroup = new TaskItem(
        'Recent Tasks',
        rootState,
        'recent'
      );
      // Salt recent
      recentGroup.id = mkId('recent', rootSalt);
      recentGroup.iconPath = new vscode.ThemeIcon('history');
      // Ensure this group has the proper context so inline action shows only the clear button
      recentGroup.contextValue = 'recent';

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
           const typeItem = TaskTypeFactory.create(type, groupState);
           typeItem.id = mkId(`recent:${type}`, groupSalt);
           typeItem.children = tasks.map((t: TaskItem) => {
                const copy = new TaskItem(
                    t.label,
                    vscode.TreeItemCollapsibleState.None,
                    t.taskType,
                    t.resourceUri,
                    t.command,
                    t.defaultIconPath
                );
                copy.originalLabel = t.originalLabel || t.label;
                copy.startLine = t.startLine;
                copy.metadata = t.metadata;
                copy.description = t.description; // Preserve description (folder name etc)
                copy.parent = typeItem;
                copy.id = `recent:${t.id}`;
                copy.contextValue = t.contextValue;
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
        recentGroup.children = recentTasks.map((t: TaskItem) => {
            const copy = new TaskItem(
                t.label,
                vscode.TreeItemCollapsibleState.None,
                t.taskType,
                t.resourceUri,
                t.command,
                t.defaultIconPath
            );
            // We should ideally show descriptions if same name exists
            copy.originalLabel = t.originalLabel || t.label;
            copy.startLine = t.startLine;
            copy.metadata = t.metadata;
            copy.description = t.description;
            copy.parent = recentGroup;
            copy.id = `recent:${t.id}`;
            copy.contextValue = t.contextValue;
            copy.updateContextValue();
            return copy;
        });
      }
    }

    if (!groupsEnabled) {
      const tasksRoot = new TaskItem(
        'Tasks', // TODO: support localization from package.nls.json (%tree.tasks%)
        vscode.TreeItemCollapsibleState.Expanded,
        'folder'
      );

      const flatTasks: TaskItem[] = [];
      for (const projectMap of workspaceMap.values()) {
        for (const typeTasks of projectMap.values()) {
          flatTasks.push(...typeTasks);
        }
      }
      flatTasks.sort((a, b) => a.label.localeCompare(b.label));

      tasksRoot.children = flatTasks;
      for (const t of flatTasks) { t.parent = tasksRoot; }
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

        const workspaceItem = new TaskItem(
          workspaceName,
          rootState,
          'workspace'
        );
        // Salt the ID of workspace item too!
        // Make ID robust using workspace ID (URI or special string)
        workspaceItem.id = mkId(`workspace:${workspaceId}`, rootSalt);

        // Try to enable folder icon for workspace item explicitly found via URI
        // Not essential but might look better
        workspaceItem.iconPath = vscode.ThemeIcon.Folder;

        // console.log(`[TaskTreeDataProvider] Workspace Item Created: ID=${workspaceItem.id}, Label=${workspaceItem.label}, State=${workspaceItem.collapsibleState}`);

        for (const [taskType, typeTasks] of projectMap) {
          // Use Factory to create typed item
          const typeItem = TaskTypeFactory.create(taskType, groupState);
          // Use workspaceId in ID key for robustness
          typeItem.id = mkId(`type:${taskType}:${workspaceId}`, groupSalt);
          typeItem.children = this.groupTasksByName(typeTasks, taskSeparator);
          typeItem.parent = workspaceItem;
          // groupTasksByName already sets parent for its direct children? No, I need to check
          for (const child of typeItem.children) { child.parent = typeItem; }

          // console.log(`[TaskTreeDataProvider] Group Item Created: ID=${typeItem.id}, Type=${taskType}, State=${typeItem.collapsibleState} (Requested: ${groupState})`);

          workspaceItem.children.push(typeItem);
        }
        // Sort types by name
        workspaceItem.children.sort((a, b) => a.label.localeCompare(b.label));

        workspaceRoots.push(workspaceItem);
      }
    }

    // Assemble final root order: Recent, Favorites, Queues, Projects
    if (recentGroup) {
      rootItems.push(recentGroup);
    }
    if (favGroup) {
      rootItems.push(favGroup);
    }
    if (queueGroups.length > 0) {
      rootItems.push(...queueGroups);
    }

    // Add remaining project roots
    rootItems.push(...workspaceRoots);

    return rootItems;
  }

  public groupTasksByName(tasks: TaskItem[], separator: string): TaskItem[] {
    if (!separator) {
      return tasks.sort((a, b) => a.label.localeCompare(b.label));
    }

    const rootItems: TaskItem[] = [];
    const groups = new Map<string, TaskItem[]>();
    const leafs: TaskItem[] = [];

    for (const task of tasks) {
      const parts = task.label.split(separator);
      if (parts.length > 1) {
        const groupName = parts[0];
        let groupList = groups.get(groupName);
        if (!groupList) {
          groupList = [];
          groups.set(groupName, groupList);
        }
        const remainder = parts.slice(1).join(separator);
        const newTask = new TaskItem(
          remainder,
          task.collapsibleState,
          task.taskType,
          task.resourceUri,
          task.command
        );
        newTask.originalLabel = task.originalLabel || task.label;
        newTask.startLine = task.startLine;
        newTask.tooltip = task.tooltip;
        // Re-run context value update now that originalLabel is set
        newTask.updateContextValue();

        groupList.push(newTask);
      } else {
        leafs.push(task);
      }
    }

    for (const [groupName, groupTasks] of groups) {
      let iconUri: vscode.Uri | undefined;
      if (groupTasks.length > 0) {
        const typeItem = TaskTypeFactory.create(groupTasks[0].taskType);
        iconUri = typeItem.resourceUri;
      }

      const groupItem = new TaskItem(groupName, vscode.TreeItemCollapsibleState.Collapsed, 'folder', iconUri);
      groupItem.id = `group:${groupName}:${tasks[0]?.resourceUri?.toString() || 'unknown'}`;
      if (iconUri) {
        groupItem.iconPath = vscode.ThemeIcon.File;
      }
      groupItem.contextValue = 'folder';
      groupItem.children = this.groupTasksByName(groupTasks, separator);
      for (const child of groupItem.children) { child.parent = groupItem; }

      rootItems.push(groupItem);
    }

    // Sort groups/leafs? Usually folders first
    rootItems.sort((a, b) => {
      if (a.contextValue === 'folder' && b.contextValue !== 'folder') return -1;
      if (a.contextValue !== 'folder' && b.contextValue === 'folder') return 1;
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
      if (aIsFolder !== bIsFolder) { return bIsFolder - aIsFolder; }
      return a.label.localeCompare(b.label);
    });

    return rootItems;
  }
}
