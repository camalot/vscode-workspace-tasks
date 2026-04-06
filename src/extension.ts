import * as vscode from 'vscode';
import { TaskTreeDataProvider } from './taskTreeDataProvider';
import { TaskStateManager } from './taskStateManager';
import { LoggerService } from './services/loggerService';
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
import { TaskHistoryTreeDataProvider } from './taskHistoryTreeDataProvider';
import { TaskHistoryTableViewProvider } from './taskHistoryTableViewProvider';
import { loadCommands } from './commands/index';
import { registerTaskProviders } from './providers/index';
import { configuration } from './libs/configuration';

export async function activate(context: vscode.ExtensionContext) {
  LoggerService.getInstance().initialize(context);
  const logger = LoggerService.getInstance();
  logger.debug('Workspace Tasks extension activating...');
  ExtensionConfigurationService.getInstance().initialize(context);
  TaskStateManager.getInstance().initialize(context);

  const taskHistoryTreeDataProvider = new TaskHistoryTreeDataProvider(context);
  const historyTreeView = vscode.window.createTreeView('workspaceTasksHistoryView', {
    treeDataProvider: taskHistoryTreeDataProvider,
    showCollapseAll: true
  });

  const taskHistoryTableViewProvider = new TaskHistoryTableViewProvider(context.extensionUri);
  context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(TaskHistoryTableViewProvider.viewType, taskHistoryTableViewProvider)
  );

  // Initialize the view based on persisted preference
  await taskHistoryTreeDataProvider.initializeView();

  context.subscriptions.push(
    historyTreeView,
    vscode.commands.registerCommand('workspaceTasks.history.clear', () => taskHistoryTreeDataProvider.clear()),
    vscode.commands.registerCommand('workspaceTasks.history.switchTreeView', () => taskHistoryTreeDataProvider.toggleViewMode()),
    vscode.commands.registerCommand('workspaceTasks.history.switchTableView', () => taskHistoryTreeDataProvider.toggleViewMode()),
    vscode.commands.registerCommand('workspaceTasks.history.enableFilterRunning', () => taskHistoryTreeDataProvider.toggleFilter('Running')),
    vscode.commands.registerCommand('workspaceTasks.history.disableFilterRunning', () => taskHistoryTreeDataProvider.toggleFilter('Running')),
    vscode.commands.registerCommand('workspaceTasks.history.enableFilterSuccess', () => taskHistoryTreeDataProvider.toggleFilter('Success')),
    vscode.commands.registerCommand('workspaceTasks.history.disableFilterSuccess', () => taskHistoryTreeDataProvider.toggleFilter('Success')),
    vscode.commands.registerCommand('workspaceTasks.history.enableFilterFailed', () => taskHistoryTreeDataProvider.toggleFilter('Failed')),
    vscode.commands.registerCommand('workspaceTasks.history.disableFilterFailed', () => taskHistoryTreeDataProvider.toggleFilter('Failed')),
    vscode.commands.registerCommand('workspaceTasks.history.enableFilterTerminated', () => taskHistoryTreeDataProvider.toggleFilter('Terminated')),
    vscode.commands.registerCommand('workspaceTasks.history.disableFilterTerminated', () => taskHistoryTreeDataProvider.toggleFilter('Terminated'))
  );
  await TaskFilesService.getInstance().initialize(context);
  context.subscriptions.push(TaskFilesService.getInstance());
  TaskCacheService.getInstance().initialize(context);
  TaskIconService.getInstance().initialize(context);
  await WorkspaceTasksService.getInstance().initialize(context);
  RecentTasksService.getInstance().initialize(context);
  FavoritesService.getInstance().initialize(context);
  QueueService.getInstance().initialize(context);
  // Enable Settings Sync for favorites and queues so they sync across machines
  context.globalState.setKeysForSync(['favorites', 'savedQueues']);
  FilteredTaskService.getInstance().initialize(context);
  const taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  await taskTreeDataProvider.initialize(context);



  // Register FileDecorationProvider for dimming filtered tasks
  const decorationProvider = new FilteredTaskDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));

  const resetTimers = new Map<string, NodeJS.Timeout>();

  const scheduleStatusReset = (id: string) => {
    // Clear any existing reset timer for this task
    if (resetTimers.has(id)) {
      clearTimeout(resetTimers.get(id)!);
      resetTimers.delete(id);
    }

    const stateManager = TaskStateManager.getInstance();
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
  };

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
    logger.error('Command loading error:', err);
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
    vscode.tasks.onDidStartTask((e) => {
      const stateManager = TaskStateManager.getInstance();
      const task = e.execution.task;
      const item = TaskCacheService.getInstance().findMatchingTask(task);
      if (item) {
        const id = stateManager.getTaskId(item);
        if (id) {
          stateManager.clearTerminated(id); // Clear any terminated state if task is restarting
          stateManager.clearStopTimer(id);  // Cancel any pending force-kill timer
          stateManager.setExecution(id, e.execution);
          stateManager.setStatus(id, 'running');
          taskTreeDataProvider.refreshLocal();

          if (resetTimers.has(id)) {
            clearTimeout(resetTimers.get(id)!);
            resetTimers.delete(id);
          }

          // Capture the terminal that opens for this task so the stop command
          // can send SIGINT instead of destroying the terminal.
          const openSub = vscode.window.onDidOpenTerminal((terminal) => {
            openSub.dispose();
            clearTimeout(terminalCaptureTimeout);
            stateManager.setTerminal(id, terminal);
          });
          // Fallback: if no new terminal opens within 1.5 s use the active one
          // (happens when the task reuses an existing dedicated/shared terminal).
          const terminalCaptureTimeout = setTimeout(() => {
            openSub.dispose();
            if (!stateManager.getTerminal(id) && vscode.window.activeTerminal) {
              stateManager.setTerminal(id, vscode.window.activeTerminal);
            }
          }, 1500);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((e) => {
      const stateManager = TaskStateManager.getInstance();
      const id = stateManager.getIdByExecution(e.execution);
      if (id) {
        stateManager.clearStopTimer(id);
        const status = e.exitCode === 0 ? 'success' : 'failure';
        stateManager.setStatus(id, status);
        stateManager.clearExecution(id);
        taskTreeDataProvider.refreshLocal();

        scheduleStatusReset(id);
      }
    }),
  );

  context.subscriptions.push(
    vscode.tasks.onDidEndTask((e) => {
      // This fires when a task ends.
      // We handle non-process tasks (like compound tasks) here.
      // If the task was a process task, onDidEndTaskProcess should have already handled it.
      const stateManager = TaskStateManager.getInstance();
      const id = stateManager.getIdByExecution(e.execution);
      if (id) {
        stateManager.clearStopTimer(id);
        // Only act if the task is still marked as running.
        // If it was a process task, status would be 'success' or 'failure' by now.
        if (stateManager.getStatus(id) === 'running') {
          if (stateManager.isTerminated(id)) {
            stateManager.setStatus(id, 'idle');
            stateManager.clearTerminated(id);
          } else {
            stateManager.setStatus(id, 'success');
          }
          stateManager.clearExecution(id);
          taskTreeDataProvider.refreshLocal();

          scheduleStatusReset(id);
        }
      }
    }),
  );
}

export function deactivate() {}
