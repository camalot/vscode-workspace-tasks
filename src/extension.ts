import * as vscode from 'vscode';
import { TaskTreeDataProvider } from './taskTreeDataProvider';
import { NpmTaskProvider } from './providers/npmTaskProvider';
import { ComposerTaskProvider } from './providers/composerTaskProvider';
import { ScriptTaskProvider } from './providers/scriptTaskProvider';
import { VscodeTaskProvider } from './providers/vscodeTaskProvider';
import { VenvTaskProvider } from './providers/venvTaskProvider';
import { MakefileTaskProvider } from './providers/makefileTaskProvider';
import { JustfileTaskProvider } from './providers/justfileTaskProvider';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { TaskRunner } from './taskRunner';
import { TaskFilesService } from './services/taskFilesService';
import { TaskCacheService } from './services/taskCacheService';
import { ExtensionConfigurationService } from './services/extensionConfigurationService';
import { TaskIconService } from './services/taskIconService';
import { WorkspaceTasksProvider } from './providers/workspaceTasksProvider';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';
import { GruntTaskProvider } from './providers/gruntTaskProvider';
import { GulpTaskProvider } from './providers/gulpTaskProvider';
import { GradleTaskProvider } from './providers/gradleTaskProvider';
import { PipenvTaskProvider } from './providers/pipenvTaskProvider';

export function activate(context: vscode.ExtensionContext) {
  ExtensionConfigurationService.getInstance().initialize(context);
  TaskStateManager.getInstance().initialize(context);
  TaskFilesService.getInstance().initialize(context);
  TaskCacheService.getInstance().initialize(context);
  TaskIconService.getInstance().initialize(context);
  const taskTreeDataProvider = new TaskTreeDataProvider(context);

  // Register Providers
  taskTreeDataProvider.registerProvider(new NpmTaskProvider());
  taskTreeDataProvider.registerProvider(new ComposerTaskProvider());
  taskTreeDataProvider.registerProvider(new ScriptTaskProvider());
  taskTreeDataProvider.registerProvider(new VscodeTaskProvider());
  taskTreeDataProvider.registerProvider(new VenvTaskProvider());
  taskTreeDataProvider.registerProvider(new MakefileTaskProvider());
  taskTreeDataProvider.registerProvider(new WorkspaceTasksProvider());
  taskTreeDataProvider.registerProvider(new JustfileTaskProvider());
  taskTreeDataProvider.registerProvider(new AntTaskProvider());
  taskTreeDataProvider.registerProvider(new GulpTaskProvider());
  taskTreeDataProvider.registerProvider(new GruntTaskProvider());
  taskTreeDataProvider.registerProvider(new MsBuildTaskProvider());
  taskTreeDataProvider.registerProvider(new GradleTaskProvider());
  taskTreeDataProvider.registerProvider(new PipenvTaskProvider());

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

  // Refresh command
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.refresh', () => {
    taskTreeDataProvider.refresh();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.collapseAll', () => {
    taskTreeDataProvider.collapseAllTaskGroups();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.buyMeACoffee', () => {
    const url = ExtensionConfigurationService.getInstance().get('sponsor.buymeacoffee');
    if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.githubSponsor', () => {
    const url = ExtensionConfigurationService.getInstance().get('sponsor.github');
    if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.githubIssues', () => {
    const url = ExtensionConfigurationService.getInstance().get('bugs.new');
    if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }));

  // Open File command
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.openFileAtLine', (uri: vscode.Uri, line: number) => {
    vscode.workspace.openTextDocument(uri).then(doc => {
      vscode.window.showTextDocument(doc).then(editor => {
        const position = new vscode.Position(line, 0);
        const range = new vscode.Range(position, position);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(position, position);
      });
    });
  }));

  // Run Task Command
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.runTask', async (item: TaskItem) => {
    if (item.contextValue === 'queuedTask') {
      await TaskRunner.getInstance().runQueue(item);
    } else {
      await TaskRunner.getInstance().runTask(item);
    }
  }));

  // Run Task with Arguments Command
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.runTaskWithArgs', async (item?: TaskItem) => {
    if (!item) { return; }
    const args = await vscode.window.showInputBox({
      prompt: `Enter arguments for task '${item.label}'`,
      placeHolder: 'Arguments'
    });
    if (args !== undefined) {
      await TaskRunner.getInstance().runTask(item, args);
    }
  }));

  // Queue Commands
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.addToQueue', (item: TaskItem) => {
    TaskStateManager.getInstance().addToQueue(item);
    taskTreeDataProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.removeFromQueue', (item: TaskItem) => {
    TaskStateManager.getInstance().removeFromQueue(item);
    taskTreeDataProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.clearQueue', () => {
    TaskStateManager.getInstance().clearQueue();
    taskTreeDataProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.runQueue', () => {
    TaskRunner.getInstance().runQueue();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.renameQueue', async (item?: TaskItem) => {
    const target = item || treeView.selection[0];
    if (!target || target.contextValue !== 'queue') {
      return;
    }

    const currentName = TaskStateManager.getInstance().getQueueName();
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter a name for the queue',
      value: currentName,
      placeHolder: 'Queue Name'
    });

    if (newName && newName.trim().length > 0) {
      TaskStateManager.getInstance().setQueueName(newName.trim());
      taskTreeDataProvider.refresh();
    }
  }));

  // Stop Task Command
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.stopTask', (item: TaskItem) => {
    const id = TaskStateManager.getInstance().getTaskId(item);
    const execution = TaskStateManager.getInstance().getExecution(id);
    if (execution) {
      execution.terminate();
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
      TaskStateManager.getInstance().addToQueue(taskToAdd);
      taskTreeDataProvider.refresh();
      vscode.window.showInformationMessage(`Added '${taskToAdd.label}' to Queue.`);
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
      TaskStateManager.getInstance().addToFavorites(taskToAdd);
      taskTreeDataProvider.refresh();
      vscode.window.showInformationMessage(`Added '${taskToAdd.label}' to Favorites.`);
    }
  }));

  // Favorites Commands
  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.addToFavorites', (item: TaskItem) => {
    TaskStateManager.getInstance().addToFavorites(item);
    taskTreeDataProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.removeFromFavorites', (item: TaskItem) => {
    TaskStateManager.getInstance().removeFromFavorites(item);
    taskTreeDataProvider.refresh();
  }));

  // Task Events
  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess((e) => {
    const stateManager = TaskStateManager.getInstance();
    const id = stateManager.getIdByExecution(e.execution);
    if (id) {
      const status = e.exitCode === 0 ? 'success' : 'failure';
      stateManager.setStatus(id, status);
      stateManager.clearExecution(id);
      taskTreeDataProvider.refresh();
    }
  }));

  context.subscriptions.push(vscode.tasks.onDidEndTask((e) => {
    // This fires when task ends, but onDidEndTaskProcess is better for exit code.
    // However, if the task was terminated (stopped), onDidEndTaskProcess might not give exit code same way or might fire differently.
    // We use onDidEndTaskProcess for success/fail judgment mostly.

    // Cleanup if missed?
  }));
}

export function deactivate() { }
