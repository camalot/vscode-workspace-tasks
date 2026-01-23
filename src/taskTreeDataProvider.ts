import * as vscode from 'vscode';
import { TaskProvider } from './taskProvider';
import { TaskItem } from './taskItem';
import { TaskTypeFactory } from './taskTypeItems';
import { TaskStateManager } from './taskStateManager';
import { TaskTreeDragAndDropController } from './taskTreeDragAndDropController';
import { TaskCacheService } from './services/taskCacheService';

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

  constructor(private context: vscode.ExtensionContext) {
    this.dragAndDropController = new TaskTreeDragAndDropController();
  }

  public bindView(view: vscode.TreeView<TaskItem>) {
    this.view = view;
  }

  registerProvider(provider: TaskProvider) {
    TaskCacheService.getInstance().registerProvider(provider);
  }

  async refresh(): Promise<void> {
    await TaskCacheService.getInstance().refresh();
    this._onDidChangeTreeData.fire();
  }

  async collapseAllTaskGroups(): Promise<void> {
    if (!this.view) { return; }

    // Toggle logic:
    // 0 -> 1 (Collapse Groups)
    // 1 -> 2 (Collapse All Roots)
    // 2 -> 0 (Expand All)
    this.collapseLevel = (this.collapseLevel + 1) % 3;

    if (this.collapseLevel === 1) {
       // Collapse Groups:
       // We refresh the tree with new IDs (salt='collapsed') and defaults to Collapsed.
       // after refresh, we ensure roots are expanded.
       this.pendingRevealLevel = 1;
       // FAST REFRESH (Cached Only)
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
        // Expand All (Level 0)
        // Refresh with 'expanded' IDs and defaults.
        this.pendingRevealLevel = 0;
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
    const taskSeparator = config.get<string>('groups.taskSeparator', '-');

    // Determine group state based on collapseLevel
    // Level 1 = Groups Collapsed.
    // Level 2 = Groups Collapsed (Roots Collapsed).
    // Level 0 = Groups Expanded (Default).

    // Determine Group Items Collapsible State and ID Salt
    let groupState = vscode.TreeItemCollapsibleState.Expanded;
    let groupSalt = 'expanded';
    if (this.collapseLevel === 1) {
        groupState = vscode.TreeItemCollapsibleState.Collapsed;
        groupSalt = 'collapsed';
    } else if (this.collapseLevel === 2) {
        // When Workspace Roots are collapsed, we don't care much about children state,
        // but let's keep them collapsed or whatever avoids rendering work.
        groupState = vscode.TreeItemCollapsibleState.Collapsed;
        groupSalt = 'roots_collapsed';
    }

    // Determine Workspace Root Items Collapsible State and ID Salt
    // If Level 2, Root is Collapsed.
    const rootState = (this.collapseLevel === 2) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
    const rootSalt = (this.collapseLevel === 2) ? 'collapsed' : 'expanded';

    // Map<WorkspaceName, Map<TaskType, TaskItem[]>>
    const workspaceMap = new Map<string, Map<string, TaskItem[]>>();
    const favoriteTasks: TaskItem[] = [];

    const stateManager = TaskStateManager.getInstance();

    for (const task of tasks) {
      const id = stateManager.getTaskId(task);

      // Check favorites
      if (stateManager.isFavorite(id)) {
        // Clone task for favorites view
        const favTask = new TaskItem(
          task.label,
          vscode.TreeItemCollapsibleState.None,
          task.taskType,
          task.resourceUri,
          task.command
        );
        favTask.originalLabel = task.originalLabel || task.label;
        favTask.startLine = task.startLine;

        // Set description to workspace folder
        const workspaceFolder = task.resourceUri ? vscode.workspace.getWorkspaceFolder(task.resourceUri) : undefined;
        favTask.description = workspaceFolder ? workspaceFolder.name : '';

        favTask.updateContextValue();
        favoriteTasks.push(favTask);
      }

      if (!task.resourceUri) {
        const workspaceName = 'Workspace';

        let projectMap = workspaceMap.get(workspaceName);
        if (!projectMap) {
          projectMap = new Map<string, TaskItem[]>();
          workspaceMap.set(workspaceName, projectMap);
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

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(task.resourceUri);
      const workspaceName = workspaceFolder ? workspaceFolder.name : 'External';

      let projectMap = workspaceMap.get(workspaceName);
      if (!projectMap) {
        projectMap = new Map<string, TaskItem[]>();
        workspaceMap.set(workspaceName, projectMap);
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

    // Add Queue Group
    const queueTasks = stateManager.getQueue();
    if (queueTasks.length > 0) {
      const queueGroup = new TaskItem(
        stateManager.getQueueName(),
        vscode.TreeItemCollapsibleState.Expanded,
        'queue'
      );
      queueGroup.iconPath = new vscode.ThemeIcon('list-ordered');

      // Create Queued Items
      for (const task of queueTasks) {
        const queuedItem = new TaskItem(
          task.label,
          vscode.TreeItemCollapsibleState.None,
          task.taskType,
          task.resourceUri,
          task.command
        );
        queuedItem.originalLabel = task.originalLabel || task.label;
        queuedItem.startLine = task.startLine;
        // Set description to workspace folder
        const workspaceFolder = task.resourceUri ? vscode.workspace.getWorkspaceFolder(task.resourceUri) : undefined;
        queuedItem.description = workspaceFolder ? workspaceFolder.name : '';

        // Explicitly set context value for queued items to allow distinct actions
        queuedItem.contextValue = 'queuedTask';
        queuedItem.parent = queueGroup;

        queueGroup.children.push(queuedItem);
      }
      rootItems.push(queueGroup);
    }

    // Add Favorites Group
    if (favoriteTasks.length > 0) {
      const favGroup = new TaskItem(
        'Favorites', // TODO: support localization from package.nls.json (%tree.favorites%)
        rootState,
        'favorites'
      );
      // Salt favorites
      favGroup.id = `favorites:${rootSalt}`;
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
        typeItem.id = `fav:${type}:${groupSalt}`;
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

      rootItems.push(favGroup);
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
      rootItems.push(tasksRoot);
    } else {
      // Sort workspaceNames
      const sortedWorkspaceNames = Array.from(workspaceMap.keys()).sort();

      for (const workspaceName of sortedWorkspaceNames) {
        const projectMap = workspaceMap.get(workspaceName)!;

        const workspaceItem = new TaskItem(
          workspaceName,
          rootState,
          'workspace'
        );
        // Salt the ID of workspace item too!
        workspaceItem.id = `workspace:${workspaceName}:${rootSalt}`;

        // Try to enable folder icon for workspace item explicitly found via URI
        // Not essential but might look better
        workspaceItem.iconPath = vscode.ThemeIcon.Folder;

        for (const [taskType, typeTasks] of projectMap) {
          // Use Factory to create typed item
          const typeItem = TaskTypeFactory.create(taskType, groupState);
          typeItem.id = `type:${taskType}:${workspaceName}:${groupSalt}`;
          typeItem.children = this.groupTasksByName(typeTasks, taskSeparator);
          typeItem.parent = workspaceItem;
          // groupTasksByName already sets parent for its direct children? No, I need to check
          for (const child of typeItem.children) { child.parent = typeItem; }

          workspaceItem.children.push(typeItem);
        }
        // Sort types by name
        workspaceItem.children.sort((a, b) => a.label.localeCompare(b.label));

        rootItems.push(workspaceItem);
      }
    }

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
