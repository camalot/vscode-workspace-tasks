import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskStateManager, TaskStatus } from './taskStateManager';
import { createTaskForItem } from './taskFactory';
import { CompoundTaskService } from './services/compoundTaskService';
import { configuration } from './libs/configuration';
import { IPresentationOptions } from './taskDefinition';
import { LoggerService } from './services/loggerService';
import { RecentTasksService } from './services/recentTasksService';
import { TaskDurationEstimateService } from './services/taskDurationEstimateService';
import { TaskRunGuardService } from './services/taskRunGuardService';
import { getCircleCiWorkflowRunId } from './libs/circleCiWorkflowRunId';

export class TaskRunner {
  private static instance: TaskRunner;
  private readonly logger = LoggerService.getInstance();
  // We need to notify the tree provider to refresh when state changes,
  // but the provider is in extension.ts or similar.
  // We can use an event emitter or just access the state manager and let the caller refresh.
  // Ideally, StateManager fires events. For now, we'll return promises.

  /** Maximum milliseconds to wait for a task to finish. Overridable for tests. */
  public taskWaitTimeoutMs = 60 * 60 * 1000; // 1 hour

  private constructor() { }

  public static getInstance(): TaskRunner {
    if (!TaskRunner.instance) {
      TaskRunner.instance = new TaskRunner();
    }
    return TaskRunner.instance;
  }

  public async runTask(item: TaskItem, args?: string, skipGuard = false): Promise<boolean> {
    // Guard check (must be before any state mutations)
    if (!skipGuard) {
      const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
      if (!confirmed) {
        return false; // User declined — task not run, state unchanged
      }
    }

    if (item.taskType === 'circleci' && item.metadata?.type === 'workflow') {
      return this.runCircleCiWorkflow(item);
    }

    // Allow tasks that don't have a resourceUri (global workspace tasks).
    // Use file's folder as cwd when available, otherwise fall back to the first workspace folder or process.cwd().
    let task: vscode.Task | undefined;
    // const cwd = item.resourceUri
    //   ? path.dirname(item.resourceUri.fsPath)
    //   : vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
    //     ? vscode.workspace.workspaceFolders[0].uri.fsPath
    //     : process.cwd();

    // Fallback Uri for commands that need one
    // const fallbackWorkspaceUri = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file(cwd);
    // const resourceUri = item.resourceUri ?? fallbackWorkspaceUri;

    // Use originalLabel if available (for grouped tasks), otherwise label
    const taskLabel = item.originalLabel || item.label;

    // Delegate task creation to the Task Factory to centralize logic and make it testable
    const created = await createTaskForItem(item, args);
    if (!created || !created.task) {
      const itemUri = (item.taskFileUri || item.resourceUri)?.toString() ?? '(none)';
      this.logger.debug(`[TaskRunner] Could not create runnable task for '${taskLabel}': taskType='${item.taskType}', id='${item.id ?? '(none)'}', uri='${itemUri}', contextValue='${item.contextValue ?? '(none)'}'`);
      vscode.window.showWarningMessage(`No runnable task could be created for '${taskLabel}'.`);
      return false;
    }
    task = created.task;

    // Check if the task is a compound task (has dependsOn but no execution)
    // modifying the task object in any way (including presentationOptions) causes executeTask to fail
    // with "Tasks to execute must include an execution"
    const isNative = task.execution === undefined || created.native;

    if (!isNative) {
      const presentationOptionsSetting = configuration.get<IPresentationOptions>('task.presentationOptions', {});

      let reveal: vscode.TaskRevealKind;
      switch (presentationOptionsSetting.reveal) {
        case 'always':
          reveal = vscode.TaskRevealKind.Always;
          break;
        case 'silent':
          reveal = vscode.TaskRevealKind.Silent;
          break;
        case 'never':
          reveal = vscode.TaskRevealKind.Never;
          break;
        default:
          reveal = vscode.TaskRevealKind.Always;
          break;
      }
      let panel: vscode.TaskPanelKind;
      switch (presentationOptionsSetting.panel) {
        case 'dedicated':
          panel = vscode.TaskPanelKind.Dedicated;
          break;
        case 'shared':
          panel = vscode.TaskPanelKind.Shared;
          break;
        case 'new':
          panel = vscode.TaskPanelKind.New;
          break;
        default:
          panel = vscode.TaskPanelKind.Shared;
          break;
      }

      const presentation: vscode.TaskPresentationOptions = {
        reveal: reveal,
        clear: presentationOptionsSetting.clear ?? false,
        close: presentationOptionsSetting.close ?? false,
        echo: presentationOptionsSetting.echo ?? true,
        focus: presentationOptionsSetting.focus ?? false,
        panel: panel,
      };

      // merge the existing task presentation options with the new ones. the task's existing options take precedence
      task.presentationOptions = {
        ...presentation,
        ...task.presentationOptions,
      };
    }

    const id = TaskStateManager.getInstance().getTaskId(item);
    // Clear all stale blocks from any previous compound-task stop so that
    // dependency tasks are free to run in the new execution sequence.
    TaskStateManager.getInstance().clearAllBlocks();
    TaskStateManager.getInstance().setStatus(id, 'running');

    try {
      TaskDurationEstimateService.getInstance().startTracking(item, task);
      const execution = await vscode.tasks.executeTask(task);
      TaskStateManager.getInstance().setExecution(id, execution);
    } catch (e) {
      this.logger.error('[TaskRunner] executeTask failed:', e);
      TaskStateManager.getInstance().setStatus(id, 'failure');
      // await vscode.commands.executeCommand('workspaceTasks.refreshTree'); // Trigger refresh
      vscode.window.showErrorMessage(`Failed to run task: ${e}`);
      throw e;
    }
    return true;
  }

  private async runCircleCiWorkflow(item: TaskItem): Promise<boolean> {
    const compoundTaskService = CompoundTaskService.getInstance();
    const workflowRunId = getCircleCiWorkflowRunId(item);
    if (!workflowRunId) {
      vscode.window.showWarningMessage(`Unable to run workflow '${item.label}': missing workflow context.`);
      return false;
    }

    const workflowJobs = Array.isArray(item.metadata?.workflowJobs)
      ? (item.metadata.workflowJobs as string[])
      : [];

    const childJobs = item.children.filter((child) => child.taskType === 'circleci' && child.metadata?.type === 'job');
    let jobsToRun = childJobs;

    if (jobsToRun.length === 0 && workflowJobs.length > 0 && item.taskFileUri) {
      jobsToRun = workflowJobs.map((jobName) => {
        const jobItem = new TaskItem(
          jobName,
          vscode.TreeItemCollapsibleState.None,
          'circleci',
          item.taskFileUri,
        );
        jobItem.taskFileUri = item.taskFileUri;
        jobItem.metadata = { type: 'job', jobName, workflowName: item.metadata?.workflowName };
        return jobItem;
      });
    }

    if (jobsToRun.length === 0) {
      vscode.window.showWarningMessage(`Workflow '${item.label}' has no runnable jobs.`);
      return false;
    }

    item.metadata = {
      ...(item.metadata ?? {}),
      workflowRunId,
    };

    const stateManager = TaskStateManager.getInstance();
    const workflowId = stateManager.getTaskId(item);
    stateManager.clearAllBlocks();
    RecentTasksService.getInstance().addRecentTask(workflowId);
    stateManager.setStatus(workflowId, 'running');

    try {
      compoundTaskService.createTransientCompoundTask(workflowRunId, jobsToRun, 'sequential');
      await this.runCompoundTask(workflowRunId);
    } finally {
      compoundTaskService.clearTransientCompoundTask(workflowRunId);
      stateManager.setStatus(workflowId, 'idle');
    }

    return true;
  }

  public async runCompoundTask(compoundTaskName: string, startItem?: TaskItem) {
    const compoundTask = CompoundTaskService.getInstance().getCompoundTask(compoundTaskName);
    if (!compoundTask || compoundTask.length === 0) {
      vscode.window.showInformationMessage(`Compound task '${compoundTaskName}' is empty or does not exist.`);
      return;
    }

    const executionType = CompoundTaskService.getInstance().getCompoundTaskExecutionType(compoundTaskName);

    this.logger.debug(`[TaskRunner] Running compound task '${compoundTaskName}' (${executionType}) with ${compoundTask.length} item(s):`);
    compoundTask.forEach((item, idx) => {
      const uri = (item.taskFileUri || item.resourceUri)?.toString() ?? '(none)';
      this.logger.debug(`[TaskRunner]   Item[${idx}]: label='${item.originalLabel || item.label}', taskType='${item.taskType}', id='${item.id ?? '(none)'}', uri='${uri}'`);
    });

    let startIndex = 0;
    if (startItem) {
      const startId = TaskStateManager.getInstance().getTaskId(startItem);
      startIndex = compoundTask.findIndex((t) => TaskStateManager.getInstance().getTaskId(t) === startId);
      if (startIndex === -1) {
        startIndex = 0;
      }
    }

    const tasksToRun = compoundTask.slice(startIndex);
    const token = CompoundTaskService.getInstance().markCompoundTaskRunning(compoundTaskName);

    try {
      if (executionType === 'parallel') {
        await Promise.all(
          tasksToRun.map(async (item) => {
            if (token.cancelled) { return; }
            if (CompoundTaskService.getInstance().isItemDefinitelyNotRunnable(item)) {
              const itemLabel = item.originalLabel || item.label;
              this.logger.warn(`[TaskRunner] Skipping unrunnable item '${itemLabel}' in compound task '${compoundTaskName}': taskType='${item.taskType || '(empty)'}'.`);
              vscode.window.showWarningMessage(
                `Compound task '${compoundTaskName}': item '${itemLabel}' has an unrecognized task type and will be skipped. Run "Purge Invalid Compound Tasks" from the Command Palette to clean up storage.`,
              );
              return;
            }
            try {
              const ran = await this.runTask(item);
              if (ran === false) { return; } // guard cancelled → skip this item
              await this.waitForTask(item);
            } catch (e) {
              vscode.window.showErrorMessage(`Compound task '${compoundTaskName}': Failed to launch '${item.label}'.`);
            }
          }),
        );
      } else {
        for (const item of tasksToRun) {
          if (token.cancelled) { break; }
          if (CompoundTaskService.getInstance().isItemDefinitelyNotRunnable(item)) {
            const itemLabel = item.originalLabel || item.label;
            this.logger.warn(`[TaskRunner] Skipping unrunnable item '${itemLabel}' in compound task '${compoundTaskName}': taskType='${item.taskType || '(empty)'}'.`);
            vscode.window.showWarningMessage(
              `Compound task '${compoundTaskName}': item '${itemLabel}' has an unrecognized task type and will be skipped. Run "Purge Invalid Compound Tasks" from the Command Palette to clean up storage.`,
            );
            continue;
          }
          try {
            const ran = await this.runTask(item);
            if (ran === false) { break; } // guard cancelled → stop sequence
            // runTask starts execution but returns effectively immediately after launch.
            // We need to WAIT for the task to finish.
            const status = await this.waitForTask(item);

            // Check status
            if (status === 'failure') {
              vscode.window.showErrorMessage(`Compound task '${compoundTaskName}' stopped: Task '${item.label}' failed.`);
              break;
            }
          } catch (e) {
            // If launch failed
            vscode.window.showErrorMessage(`Compound task '${compoundTaskName}' stopped: Failed to launch '${item.label}'.`);
            break;
          }
        }
      }
    } finally {
      CompoundTaskService.getInstance().markCompoundTaskStopped(compoundTaskName);
    }
  }

  private waitForTask(item: TaskItem): Promise<TaskStatus> {
    return new Promise((resolve) => {
      const id = TaskStateManager.getInstance().getTaskId(item);
      const maxWaitMs = this.taskWaitTimeoutMs;

      // Check immediate status
      const currentStatus = TaskStateManager.getInstance().getStatus(id);
      if (currentStatus === 'success' || currentStatus === 'failure' || currentStatus === 'idle') {
        return resolve(currentStatus);
      }

      let timer: NodeJS.Timeout;

      const disposable = TaskStateManager.getInstance().onDidStateChange((e) => {
        if (e.id === id) {
          if (e.status === 'success' || e.status === 'failure' || e.status === 'idle') {
            if (timer) {
              clearTimeout(timer);
            }
            disposable.dispose();
            resolve(e.status);
          }
        }
      });

      // Safety timeout
      // In case something goes wrong and we never get a success/failure/idle event, we don't want to wait indefinitely.
      timer = setTimeout(() => {
        disposable.dispose();
        resolve(TaskStateManager.getInstance().getStatus(id));
      }, maxWaitMs);
    });
  }
}
