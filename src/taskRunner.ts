import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { TaskStateManager, TaskStatus } from './taskStateManager';
import { createTaskForItem } from './taskFactory';
import { QueueService } from './services/queueService';

export class TaskRunner {
  private static instance: TaskRunner;

  // We need to notify the tree provider to refresh when state changes,
  // but the provider is in extension.ts or similar.
  // We can use an event emitter or just access the state manager and let the caller refresh.
  // Ideally, StateManager fires events. For now, we'll return promises.

  private constructor() { }

  public static getInstance(): TaskRunner {
    if (!TaskRunner.instance) {
      TaskRunner.instance = new TaskRunner();
    }
    return TaskRunner.instance;
  }

  public async runTask(item: TaskItem, args?: string): Promise<void> {
    // Allow tasks that don't have a resourceUri (global workspace tasks).
    // Use file's folder as cwd when available, otherwise fall back to the first workspace folder or process.cwd().
    let task: vscode.Task | undefined;
    const cwd = item.resourceUri ? path.dirname(item.resourceUri.fsPath) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri.fsPath : process.cwd());

    // Fallback Uri for commands that need one
    // const fallbackWorkspaceUri = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file(cwd);
    // const resourceUri = item.resourceUri ?? fallbackWorkspaceUri;

    // Use originalLabel if available (for grouped tasks), otherwise label
    const taskLabel = item.originalLabel || item.label;

    // Delegate task creation to the Task Factory to centralize logic and make it testable
    const created = await createTaskForItem(item, args);
    if (!created || !created.task) {
      vscode.window.showWarningMessage(`No runnable task could be created for '${taskLabel}'.`);
      return;
    }
    task = created.task;
    task.presentationOptions = {
      ...task.presentationOptions,
      panel: vscode.TaskPanelKind.Dedicated
    };

    // Extra debug info for gulp tasks
    if (item.taskType === 'gulp') {
      console.log(`[TaskRunner] Running gulp task '${taskLabel}' from file: ${item.resourceUri?.fsPath} -- command: ${created.command}`);
    }

    const id = TaskStateManager.getInstance().getTaskId(item);
    TaskStateManager.getInstance().setStatus(id, 'running');
    vscode.commands.executeCommand('workspaceTasks.refreshTree'); // Trigger refresh

    try {
      const execution = await vscode.tasks.executeTask(task);
      TaskStateManager.getInstance().setExecution(id, execution);
    } catch (e) {
      console.error('[TaskRunner] executeTask failed:', e);
      TaskStateManager.getInstance().setStatus(id, 'failure');
      vscode.commands.executeCommand('workspaceTasks.refreshTree');
      vscode.window.showErrorMessage(`Failed to run task: ${e}`);
      throw e;
    }
  }

  public async runQueue(queueName: string, startItem?: TaskItem) {
    const queue = QueueService.getInstance().getQueue(queueName);
    if (!queue || queue.length === 0) {
      vscode.window.showInformationMessage(`Queue '${queueName}' is empty or does not exist.`);
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
        await this.runTask(item);
        // runTask starts execution but returns effectively immediately after launch.
        // We need to WAIT for the task to finish.
        const status = await this.waitForTask(item);

        // Check status
        if (status === 'failure') {
          vscode.window.showErrorMessage(`Queue '${queueName}' stopped: Task '${item.label}' failed.`);
          break;
        }
      } catch (e) {
        // If launch failed
        vscode.window.showErrorMessage(`Queue stopped: Failed to launch '${item.label}'.`);
        break;
      }
    }
  }

  private waitForTask(item: TaskItem): Promise<TaskStatus> {
    return new Promise((resolve) => {
      const id = TaskStateManager.getInstance().getTaskId(item);
      const maxWaitMs = 5 * 60 * 1000; // 5 minutes

      // Check immediate status
      const currentStatus = TaskStateManager.getInstance().getStatus(id);
      if (currentStatus === 'success' || currentStatus === 'failure' || currentStatus === 'idle') {
        return resolve(currentStatus);
      }

      const disposable = TaskStateManager.getInstance().onDidStateChange(e => {
        if (e.id === id) {
          if (e.status === 'success' || e.status === 'failure' || e.status === 'idle') {
            disposable.dispose();
            resolve(e.status);
          }
        }
      });

      // Safety timeout
      setTimeout(() => {
        disposable.dispose();
        resolve(TaskStateManager.getInstance().getStatus(id));
      }, maxWaitMs);
    });
  }
}
