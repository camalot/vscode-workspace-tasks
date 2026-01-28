import * as vscode from 'vscode';
import { TaskTreeDataProvider } from './taskTreeDataProvider';
import { NpmTaskProvider, PnpmTaskProvider, YarnTaskProvider } from './providers/npmTaskProvider';
import { ComposerTaskProvider } from './providers/composerTaskProvider';
import { ShellTaskProvider } from './providers/shellTaskProvider';
import { VscodeTaskProvider } from './providers/vscodeTaskProvider';
import { VenvTaskProvider } from './providers/venvTaskProvider';
import { MiseTaskProvider } from './providers/miseTaskProvider';
import { MakefileTaskProvider } from './providers/makefileTaskProvider';
import { JustfileTaskProvider } from './providers/justfileTaskProvider';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { TaskRunner } from './taskRunner';
import { TaskFilesService } from './services/taskFilesService';
import { TaskCacheService } from './services/taskCacheService';
import { ExtensionConfigurationService } from './services/extensionConfigurationService';
import { TaskIconService } from './services/taskIconService';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { RecentTasksService } from './services/recentTasksService';
import { FavoritesService } from './services/favoritesService';
import { QueueService } from './services/queueService';
import { WorkspaceTasksProvider } from './providers/workspaceTasksProvider';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';import { GithubActionsTaskProvider } from './providers/githubActionsTaskProvider';import { GruntTaskProvider } from './providers/gruntTaskProvider';
import { GulpTaskProvider } from './providers/gulpTaskProvider';
import { GradleTaskProvider } from './providers/gradleTaskProvider';
import { PipenvTaskProvider } from './providers/pipenvTaskProvider';
import { MavenTaskProvider } from './providers/mavenTaskProvider';
import { JupyterTaskProvider } from './providers/jupyterTaskProvider';
import { loadCommands } from './commands/index';

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
  const taskTreeDataProvider = TaskTreeDataProvider.getInstance(context);
  await taskTreeDataProvider.initialize(context);

  // Register Providers
  taskTreeDataProvider.registerProvider(new NpmTaskProvider());
  taskTreeDataProvider.registerProvider(new PnpmTaskProvider());
  taskTreeDataProvider.registerProvider(new YarnTaskProvider());
  taskTreeDataProvider.registerProvider(new ComposerTaskProvider());
  taskTreeDataProvider.registerProvider(new ShellTaskProvider());
  taskTreeDataProvider.registerProvider(new VscodeTaskProvider());
  taskTreeDataProvider.registerProvider(new VenvTaskProvider());
  taskTreeDataProvider.registerProvider(new MakefileTaskProvider());
  taskTreeDataProvider.registerProvider(new MiseTaskProvider());
  taskTreeDataProvider.registerProvider(new WorkspaceTasksProvider());
  taskTreeDataProvider.registerProvider(new JustfileTaskProvider());
  taskTreeDataProvider.registerProvider(new AntTaskProvider());
  taskTreeDataProvider.registerProvider(new GulpTaskProvider());
  taskTreeDataProvider.registerProvider(new GruntTaskProvider());
  taskTreeDataProvider.registerProvider(new MsBuildTaskProvider());
  taskTreeDataProvider.registerProvider(new MavenTaskProvider());
  taskTreeDataProvider.registerProvider(new GithubActionsTaskProvider());
  taskTreeDataProvider.registerProvider(new GradleTaskProvider());
  taskTreeDataProvider.registerProvider(new PipenvTaskProvider());
  taskTreeDataProvider.registerProvider(new JupyterTaskProvider());

  // Initial refresh
  taskTreeDataProvider.refresh();

  // Listen for configuration changes with debouncing
  let configChangeTimeout: NodeJS.Timeout | undefined;
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
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
  }));

  // Register Tree Data Provider
  const treeView = vscode.window.createTreeView('workspaceTasksView', {
    treeDataProvider: taskTreeDataProvider,
    dragAndDropController: taskTreeDataProvider.dragAndDropController
  });
  taskTreeDataProvider.bindView(treeView);
  context.subscriptions.push(treeView);

  const explorerView = vscode.window.createTreeView('workspaceTasksExplorer', {
    treeDataProvider: taskTreeDataProvider,
    dragAndDropController: taskTreeDataProvider.dragAndDropController
  });
  taskTreeDataProvider.bindView(explorerView);
  context.subscriptions.push(explorerView);

  // Load commands (statically imported so webpack includes them)
  try {
    loadCommands(context);
  }
  catch (err) {
    console.error('Command loading error:', err);
  }

  // Click Handler
  const clickTimers = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.onTreeItemClick', async (itemArgument: any) => {
    // Resolve the real TaskItem from cache if possible, as 'itemArgument' might be a serialized copy
    let item: TaskItem | undefined;

    if (itemArgument instanceof TaskItem) {
        item = itemArgument;
    } else if (itemArgument && typeof itemArgument.id === 'string') {
        item = TaskCacheService.getInstance().getTask(itemArgument.id);
    }

    if (!item) {
        // Fallback or item not found in cache (maybe dynamic item?)
        // If it's partial object but has commands, maybe we can still use it?
        // But the commands on partial object likely lack context.
        return;
    }

    // We use the ID to track clicks. If no ID, use random string.
    const id = item.id || Math.random().toString();

    if (clickTimers.has(id)) {
      // Double click
      clearTimeout(clickTimers.get(id));
      clickTimers.delete(id);

      if (item.onDoubleClickCommand) {
        vscode.commands.executeCommand(item.onDoubleClickCommand.command, ...(item.onDoubleClickCommand.arguments || []));
      }
    } else {
      // Single click - wait for potential double click
      const timeout = setTimeout(() => {
        clickTimers.delete(id);
        if (item.onSingleClickCommand) {
          vscode.commands.executeCommand(item.onSingleClickCommand.command, ...(item.onSingleClickCommand.arguments || []));
        }
      }, 250);
      clickTimers.set(id, timeout);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.removeFromQueue', (item: TaskItem) => {
    let queueName: string | undefined;
    if (item.parent && item.parent.contextValue === 'queue') {
         queueName = item.parent.label as string;
    }
    QueueService.getInstance().removeFromQueue(item, queueName);
    taskTreeDataProvider.refreshLocal();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.clearQueue', async (item?: TaskItem) => {
    if (item && item.contextValue === 'queue') {
        QueueService.getInstance().clearQueue(item.label as string);
        taskTreeDataProvider.refreshLocal();
        return;
    }

    const queues = QueueService.getInstance().getQueueNames();
    if (queues.length === 0) {
      return;
    }

    const selected = await vscode.window.showQuickPick(queues, { placeHolder: 'Select queue to clear'});
    if (selected) {
         QueueService.getInstance().clearQueue(selected);
         taskTreeDataProvider.refreshLocal();
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.runQueue', async (item?: TaskItem) => {
    if (item && item.contextValue === 'queue') {
         TaskRunner.getInstance().runQueue(item.label as string);
         return;
    }

    const queues = QueueService.getInstance().getQueueNames();
    if (queues.length === 0) {
         vscode.window.showInformationMessage("No queues to run.");
         return;
    }

    let queueName: string | undefined;
    if (queues.length === 1) {
        queueName = queues[0];
    } else {
        queueName = await vscode.window.showQuickPick(queues, { placeHolder: 'Select queue to run' });
    }

    if (queueName) {
        TaskRunner.getInstance().runQueue(queueName);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.renameQueue', async (item?: TaskItem) => {
    const target = item || treeView.selection[0];
    if (!target || target.contextValue !== 'queue') {
      return;
    }

    const currentName = target.label as string;
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the queue',
      value: currentName,
      placeHolder: 'Queue Name'
    });

    if (newName && newName.trim().length > 0) {
      QueueService.getInstance().renameQueue(currentName, newName.trim());
      taskTreeDataProvider.refreshLocal();
    }
  }));


  // Context Menu Commands
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.context.addToQueue', async (uri: vscode.Uri) => {
    const tasks = TaskCacheService.getInstance().getTasksForFile(uri);
    if (tasks.length === 0) {
      vscode.window.showInformationMessage("No tasks found for this file.");
      return;
    }

    let taskToAdd: TaskItem | undefined;
    if (tasks.length === 1) {
      taskToAdd = tasks[0];
    } else {
      const selected = await vscode.window.showQuickPick(tasks.map(t => ({ label: t.label, task: t })), {
        placeHolder: 'Select task to add to queue'
      });
      if (selected) {
        taskToAdd = selected.task;
      }
    }

    if (taskToAdd) {
      const queueService = QueueService.getInstance();
      const queues = queueService.getQueueNames();
      let targetQueue: string | undefined;

      if (queues.length === 0) {
          targetQueue = await vscode.window.showInputBox({ prompt: 'Enter name for new queue', placeHolder: 'Queue Name', value: 'Queue' });
      } else {
          const items = [...queues, 'New Queue...'];
          const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select Queue to add task to' });
          if (selected === 'New Queue...') {
              targetQueue = await vscode.window.showInputBox({ prompt: 'Enter name for new queue', placeHolder: 'Queue Name', value: 'Queue' });
          } else {
              targetQueue = selected;
          }
      }

      if (targetQueue) {
        queueService.addToQueue(taskToAdd, targetQueue);
        taskTreeDataProvider.refreshLocal();
        vscode.window.showInformationMessage(`Added '${taskToAdd.label}' to Queue '${targetQueue}'.`);
      }
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.context.addToFavorites', async (uri: vscode.Uri) => {
    const tasks = TaskCacheService.getInstance().getTasksForFile(uri);
    if (tasks.length === 0) {
      vscode.window.showInformationMessage("No tasks found for this file.");
      return;
    }

    let taskToAdd: TaskItem | undefined;
    if (tasks.length === 1) {
      taskToAdd = tasks[0];
    } else {
      const selected = await vscode.window.showQuickPick(tasks.map(t => ({ label: t.label, task: t })), {
        placeHolder: 'Select task to add to favorites'
      });
      if (selected) {
        taskToAdd = selected.task;
      }
    }

    if (taskToAdd) {
      FavoritesService.getInstance().addToFavorites(taskToAdd);
      taskTreeDataProvider.refreshLocal();
      vscode.window.showInformationMessage(`Added '${taskToAdd.label}' to Favorites.`);
    }
  }));

  // Favorites Commands
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.addToFavorites', (item: TaskItem) => {
    FavoritesService.getInstance().addToFavorites(item);
    taskTreeDataProvider.refreshLocal();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.removeFromFavorites', (item: TaskItem) => {
    FavoritesService.getInstance().removeFromFavorites(item);
    taskTreeDataProvider.refreshLocal();
  }));

  // Task Events
  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess((e) => {
    const stateManager = TaskStateManager.getInstance();
    const id = stateManager.getIdByExecution(e.execution);
    if (id) {
      const status = e.exitCode === 0 ? 'success' : 'failure';
      stateManager.setStatus(id, status);
      stateManager.clearExecution(id);
      taskTreeDataProvider.refreshLocal();
    }
  }));

  context.subscriptions.push(vscode.tasks.onDidEndTask(() => {
    // This fires when a task ends. No action required here; onDidEndTaskProcess handles status updates.
  }));
}

export function deactivate() { }
