import * as vscode from 'vscode';
import { TaskTreeDataProvider } from './taskTreeDataProvider';
import { TaskStateManager } from './taskStateManager';
import { TaskFilesService } from './services/taskFilesService';
import { TaskCacheService } from './services/taskCacheService';
import { ExtensionConfigurationService } from './services/extensionConfigurationService';
import { TaskIconService } from './services/taskIconService';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { RecentTasksService } from './services/recentTasksService';
import { FavoritesService } from './services/favoritesService';
import { QueueService } from './services/queueService';
import { FilteredTaskService } from './services/filteredTaskService';
import { FilteredTaskDecorationProvider } from './filteredTaskDecorationProvider';
import { loadCommands } from './commands/index';
import { registerTaskProviders } from './providers/index';
import { configuration } from './libs/configuration';

export async function activate(context: vscode.ExtensionContext) {
  ExtensionConfigurationService.getInstance().initialize(context);
  TaskStateManager.getInstance().initialize(context);
  await TaskFilesService.getInstance().initialize(context);
  TaskCacheService.getInstance().initialize(context);
  TaskIconService.getInstance().initialize(context);
  WorkspaceTasksService.getInstance().initialize(context);
  RecentTasksService.getInstance().initialize(context);
  FavoritesService.getInstance().initialize(context);
  QueueService.getInstance().initialize(context);
  FilteredTaskService.getInstance().initialize(context);
  const taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  await taskTreeDataProvider.initialize(context);

  // Register FileDecorationProvider for dimming filtered tasks
  const decorationProvider = new FilteredTaskDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

  const resetTimers = new Map<string, NodeJS.Timeout>();

  // Set up context keys for filtered tasks feature
  const updateFilteredTasksContext = () => {
    const filteredService = FilteredTaskService.getInstance();
    vscode.commands.executeCommand('setContext', 'workspaceTasks.hasFilteredTasks', filteredService.hasFilteredTasks());
    vscode.commands.executeCommand('setContext', 'workspaceTasks.showHiddenMode', filteredService.isShowHiddenMode());
  };

  // Initial context setup
  updateFilteredTasksContext();

  // Listen for filtered task changes and update context + refresh tree
  context.subscriptions.push(
    FilteredTaskService.getInstance().onDidChange(() => {
      updateFilteredTasksContext();
      decorationProvider.refresh(); // Refresh decorations when filtered tasks change
      taskTreeDataProvider.refreshLocal();
    })
  );

  // Register Providers
  registerTaskProviders(context);
  // Initial refresh
  taskTreeDataProvider.refresh();

  // Listen for configuration changes with debouncing
  let configChangeTimeout: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workspaceTasks')) {
        // Clear existing timeout if it exists
        if (configChangeTimeout) {
          clearTimeout(configChangeTimeout);
        }
        // Set new timeout for 3 seconds
        configChangeTimeout = setTimeout(() => {
          taskTreeDataProvider.refresh();
          configChangeTimeout = undefined;
        }, 3000);
      }
    }),
  );

  // Register Tree Data Provider
  const treeView = vscode.window.createTreeView('workspaceTasksView', {
    treeDataProvider: taskTreeDataProvider,
    dragAndDropController: taskTreeDataProvider.dragAndDropController,
  });
  taskTreeDataProvider.bindView(treeView);
  context.subscriptions.push(treeView);

  const explorerView = vscode.window.createTreeView('workspaceTasksExplorer', {
    treeDataProvider: taskTreeDataProvider,
    dragAndDropController: taskTreeDataProvider.dragAndDropController,
  });
  taskTreeDataProvider.bindView(explorerView);
  context.subscriptions.push(explorerView);

  // Load commands (statically imported so webpack includes them)
  try {
    loadCommands(context);
  } catch (err) {
    console.error('Command loading error:', err);
  }

  // Monitor state changes to cancel pending resets if task restarts
  context.subscriptions.push(
    TaskStateManager.getInstance().onDidStateChange((e) => {
      if (e.status === 'running') {
        if (resetTimers.has(e.id)) {
          clearTimeout(resetTimers.get(e.id)!);
          resetTimers.delete(e.id);
        }
      }
    }),
  );

  // Task Events
  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((e) => {
      const stateManager = TaskStateManager.getInstance();
      const id = stateManager.getIdByExecution(e.execution);
      if (id) {
        const status = e.exitCode === 0 ? 'success' : 'failure';
        stateManager.setStatus(id, status);
        stateManager.clearExecution(id);
        taskTreeDataProvider.refreshLocal();

        // Clear any existing reset timer for this task
        if (resetTimers.has(id)) {
          clearTimeout(resetTimers.get(id)!);
          resetTimers.delete(id);
        }

        const delay = configuration.get<number>('task.statusResetDelay', 500);
        if (delay > 0) {
          const timer = setTimeout(() => {
            // Double check status hasn't changed to running in the meantime
            if (stateManager.getStatus(id) !== 'running') {
              stateManager.setStatus(id, 'idle');
              taskTreeDataProvider.refreshLocal();
            }
            resetTimers.delete(id);
          }, delay);
          resetTimers.set(id, timer);
        } else {
          stateManager.setStatus(id, 'idle');
          taskTreeDataProvider.refreshLocal();
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.tasks.onDidEndTask(() => {
      // This fires when a task ends. No action required here; onDidEndTaskProcess handles status updates.
    }),
  );
}

export function deactivate() {}
