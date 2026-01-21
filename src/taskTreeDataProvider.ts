import * as vscode from 'vscode';
import * as path from 'path';
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

    constructor() {
        this.dragAndDropController = new TaskTreeDragAndDropController();
    }

    registerProvider(provider: TaskProvider) {
        TaskCacheService.getInstance().registerProvider(provider);
    }

    async refresh(): Promise<void> {
        await TaskCacheService.getInstance().refresh();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TaskItem): Promise<TaskItem[]> {
        if (element) {
            return element.children;
        } else {
            const allTasks = TaskCacheService.getInstance().getAllTasks();
            return this.organizeTasks(allTasks);
        }
    }

    private organizeTasks(tasks: TaskItem[]): TaskItem[] {
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
                favTask.startLine = task.startLine;

                // Set description to workspace folder
                const workspaceFolder = task.resourceUri ? vscode.workspace.getWorkspaceFolder(task.resourceUri) : undefined;
                favTask.description = workspaceFolder ? workspaceFolder.name : '';

                favoriteTasks.push(favTask);
            }

            if (!task.resourceUri) { continue; }
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
                 queuedItem.startLine = task.startLine;
                 // Set description to workspace folder
                 const workspaceFolder = task.resourceUri ? vscode.workspace.getWorkspaceFolder(task.resourceUri) : undefined;
                 queuedItem.description = workspaceFolder ? workspaceFolder.name : '';

                 // Explicitly set context value for queued items to allow distinct actions
                 queuedItem.contextValue = 'queuedTask';

                 queueGroup.children.push(queuedItem);
             }
             rootItems.push(queueGroup);
        }

        // Add Favorites Group
        if (favoriteTasks.length > 0) {
            const favGroup = new TaskItem(
                'Favorites',
                vscode.TreeItemCollapsibleState.Expanded,
                'favorites'
            );
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
                 const typeItem = TaskTypeFactory.create(type);
                 typeItem.children = tasks;
                 favGroup.children.push(typeItem);
            }

            rootItems.push(favGroup);
        }

        for (const [workspaceName, projectMap] of workspaceMap) {
            const workspaceItem = new TaskItem(
                workspaceName,
                vscode.TreeItemCollapsibleState.Expanded,
                'workspace'
            );

            // Try to enable folder icon for workspace item explicitly found via URI
            // Not essential but might look better
             workspaceItem.iconPath = vscode.ThemeIcon.Folder;

            for (const [taskType, typeTasks] of projectMap) {
                // Use Factory to create typed item
                const typeItem = TaskTypeFactory.create(taskType);
                typeItem.children = typeTasks;
                workspaceItem.children.push(typeItem);
            }
            // Sort types by name
            workspaceItem.children.sort((a, b) => a.label.localeCompare(b.label));

            rootItems.push(workspaceItem);
        }

        return rootItems;
    }
}
