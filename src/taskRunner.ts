import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { FileTaskService } from './services/fileTaskService';

export class TaskRunner {
    private static instance: TaskRunner;

    // We need to notify the tree provider to refresh when state changes,
    // but the provider is in extension.ts or similar.
    // We can use an event emitter or just access the state manager and let the caller refresh.
    // Ideally, StateManager fires events. For now, we'll return promises.

    private constructor() {}

    public static getInstance(): TaskRunner {
        if (!TaskRunner.instance) {
            TaskRunner.instance = new TaskRunner();
        }
        return TaskRunner.instance;
    }

    public async runTask(item: TaskItem): Promise<void> {
        if (!item.resourceUri) { return; }

        let task: vscode.Task | undefined;
        const cwd = path.dirname(item.resourceUri.fsPath);

        if (item.taskType === 'npm') {
            task = new vscode.Task(
                { type: 'npm', script: item.label },
                vscode.TaskScope.Workspace,
                item.label,
                'npm',
                new vscode.ShellExecution(`npm run "${item.label}"`, { cwd })
            );
        } else if (item.taskType === 'script') {
            let command = item.resourceUri.fsPath;
            if (process.platform === 'win32' && (command.endsWith('.ps1'))) {
                command = `powershell -ExecutionPolicy Bypass -File "${command}"`;
            } else if (process.platform !== 'win32' && command.endsWith('.sh')) {
               command = `bash "${command}"`;
            } else {
               command = `"${command}"`;
            }

            task = new vscode.Task(
                { type: 'script', script: item.label },
                vscode.TaskScope.Workspace,
                item.label,
                'script',
                new vscode.ShellExecution(command, { cwd })
            );
        } else if (item.taskType === 'vscode') {
             const tasks = await vscode.tasks.fetchTasks();
             task = tasks.find(t => t.name === item.label && t.source === 'Workspace');
             if (!task) {
                 vscode.window.showWarningMessage(`Could not find VS Code task '${item.label}'. Make sure it is valid.`);
                 return;
             }
        } else if (item.taskType === 'makefile') {
            task = new vscode.Task(
                { type: 'makefile', script: item.label },
                vscode.TaskScope.Workspace,
                item.label,
                'makefile',
                new vscode.ShellExecution(`make "${item.label}"`, { cwd })
            );
        } else if (item.taskType === 'dockerfile') {
            const command = await FileTaskService.getInstance().resolveTaskCommand(item.label, 'DockerFile', item.resourceUri);
            if (command) {
                task = new vscode.Task(
                    { type: 'dockerfile', task: item.label },
                    vscode.TaskScope.Workspace,
                    item.label,
                    'dockerfile',
                    new vscode.ShellExecution(command, { cwd })
                );
            }
        } else if (item.taskType === 'justfile') {
             task = new vscode.Task(
                { type: 'justfile', task: item.label },
                vscode.TaskScope.Workspace,
                item.label,
                'just',
                new vscode.ShellExecution(`just "${item.label}"`, { cwd })
            );
        }

        if (task) {
            const id = TaskStateManager.getInstance().getTaskId(item);
            TaskStateManager.getInstance().setStatus(id, 'running');
            vscode.commands.executeCommand('workspaceTasks.refresh'); // Trigger refresh

            try {
                const execution = await vscode.tasks.executeTask(task);
                TaskStateManager.getInstance().setExecution(id, execution);
            } catch (e) {
                TaskStateManager.getInstance().setStatus(id, 'failure');
                vscode.commands.executeCommand('workspaceTasks.refresh');
                vscode.window.showErrorMessage(`Failed to run task: ${e}`);
                throw e; // Re-throw for queue handling
            }
        }
    }

    public async runQueue(startItem?: TaskItem) {
        const queue = TaskStateManager.getInstance().getQueue();
        if (queue.length === 0) {
            vscode.window.showInformationMessage("Queue is empty.");
            return;
        }

        let startIndex = 0;
        if (startItem) {
             const startId = TaskStateManager.getInstance().getTaskId(startItem);
             startIndex = queue.findIndex(t => TaskStateManager.getInstance().getTaskId(t) === startId);
             if (startIndex === -1) { startIndex = 0; }
        }

        const tasksToRun = queue.slice(startIndex);

        for (const item of tasksToRun) {
            try {
                 this.runTask(item);
                 // runTask starts execution but returns effectively immediately after launch.
                 // We need to WAIT for the task to finish.
                 await this.waitForTask(item);

                 // Check status
                 const id = TaskStateManager.getInstance().getTaskId(item);
                 const status = TaskStateManager.getInstance().getStatus(id);
                 if (status === 'failure') {
                     vscode.window.showErrorMessage(`Queue stopped: Task '${item.label}' failed.`);
                     break;
                 }
            } catch (e) {
                // If launch failed
                vscode.window.showErrorMessage(`Queue stopped: Failed to launch '${item.label}'.`);
                break;
            }
        }
    }

    private waitForTask(item: TaskItem): Promise<void> {
        return new Promise((resolve) => {
            const id = TaskStateManager.getInstance().getTaskId(item);

            // Poll for status change (simple but effective for this context)
            // Or ideally use an event listener.
            // Since we can't easily hook into the exact onDidEndTaskProcess here without passing it around,
            // let's rely on checking the StateManager which is updated by the extension via event.

            const interval = setInterval(() => {
                const status = TaskStateManager.getInstance().getStatus(id);
                if (status === 'success' || status === 'failure' || status === 'idle') {
                    // 'idle' might mean it was stopped or reset
                    clearInterval(interval);
                    resolve();
                }
            }, 500);
        });
    }
}
