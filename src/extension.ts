import * as vscode from 'vscode';
import * as path from 'path';
import { TaskTreeDataProvider } from './taskTreeDataProvider';
import { PackageJsonTaskProvider } from './providers/packageJsonTaskProvider';
import { ScriptTaskProvider } from './providers/scriptTaskProvider';
import { VscodeTaskProvider } from './providers/vscodeTaskProvider';
import { MakefileTaskProvider } from './providers/makefileTaskProvider';
import { DockerfileTaskProvider } from './providers/dockerfileTaskProvider';
import { JustfileTaskProvider } from './providers/justfileTaskProvider';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { TaskRunner } from './taskRunner';
import { TaskIgnoreService } from './services/taskIgnoreService';
import { TaskCacheService } from './services/taskCacheService';

export function activate(context: vscode.ExtensionContext) {
    TaskStateManager.getInstance().initialize(context);
    TaskIgnoreService.getInstance().initialize(); // Initialize ignore service
	const taskTreeDataProvider = new TaskTreeDataProvider();

    // Register Providers
    taskTreeDataProvider.registerProvider(new PackageJsonTaskProvider());
    taskTreeDataProvider.registerProvider(new ScriptTaskProvider());
    taskTreeDataProvider.registerProvider(new VscodeTaskProvider());
    taskTreeDataProvider.registerProvider(new MakefileTaskProvider());
    taskTreeDataProvider.registerProvider(new DockerfileTaskProvider());
    taskTreeDataProvider.registerProvider(new JustfileTaskProvider());

    // Initial refresh
    taskTreeDataProvider.refresh();

    // Register Tree Data Provider
	const treeView = vscode.window.createTreeView('workspaceTasksView', {
        treeDataProvider: taskTreeDataProvider,
        dragAndDropController: taskTreeDataProvider.dragAndDropController
    });
    context.subscriptions.push(treeView);

    // Refresh command
    context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.refresh', () => {
        taskTreeDataProvider.refresh();
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
            const id = TaskStateManager.getInstance().getTaskId(taskToAdd);
            TaskStateManager.getInstance().toggleFavorite(id);
            taskTreeDataProvider.refresh();
            vscode.window.showInformationMessage(`Added '${taskToAdd.label}' to Favorites.`);
        }
    }));

    // Favorites Commands
    context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.addToFavorites', (item: TaskItem) => {
        const id = TaskStateManager.getInstance().getTaskId(item);
        TaskStateManager.getInstance().toggleFavorite(id);
        taskTreeDataProvider.refresh();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('workspaceTasks.removeFromFavorites', (item: TaskItem) => {
        const id = TaskStateManager.getInstance().getTaskId(item);
        TaskStateManager.getInstance().toggleFavorite(id);
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

export function deactivate() {}
