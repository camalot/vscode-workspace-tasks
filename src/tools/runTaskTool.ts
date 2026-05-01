import * as vscode from 'vscode';
import { TaskCacheService } from '../services/taskCacheService';
import { TaskRunner } from '../taskRunner';
import { TaskRunGuardService } from '../services/taskRunGuardService';
import { collectLeafTasks, toSummary, TaskSummary } from './taskToolsUtils';
import { TaskItem } from '../taskItem';

/** Input parameters accepted by the RunTaskTool. */
export interface IRunTaskParameters {
  /** Stable task ID from workspaceTasks_getTasks. Preferred for precise lookup. */
  id?: string;
  /** Task label. May match multiple tasks; use 'id' when possible. */
  label?: string;
  /** Task type to narrow label-based matches (e.g. 'npm', 'shell'). */
  taskType?: string;
}

/** JSON payload returned from the RunTaskTool. */
interface RunTaskResult {
  started: boolean;
  message: string;
  task?: TaskSummary;
  candidates?: TaskSummary[];
}

/**
 * Language model tool that executes a workspace task by ID or label.
 *
 * Security design:
 * - `prepareInvocation` resolves the task (best effort) and stores its ID in
 *   `_pendingTaskId` so `invoke` can detect whether a proper per-task confirmation
 *   was already presented to the user.
 * - `invoke` determines `skipGuard` based on whether `_pendingTaskId` matches the
 *   resolved item's ID. When they match the confirmation message in
 *   `prepareInvocation` already surfaced any guard warning, so the guard modal is
 *   suppressed. When they don't match (TOCTOU, programmatic invocation, fallback
 *   path) `skipGuard = false` so `TaskRunner` applies its own guard confirmation.
 */
export class RunTaskTool implements vscode.LanguageModelTool<IRunTaskParameters> {
  /** The task ID resolved during `prepareInvocation`, if any. */
  private _pendingTaskId: string | undefined;

  public prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IRunTaskParameters>,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    this._pendingTaskId = undefined;

    const item = this._resolveTask(options.input);

    if (!item) {
      // Generic fallback — authoritative lookup happens in invoke
      return {
        invocationMessage: 'Running workspace task...',
        confirmationMessages: {
          title: 'Run Workspace Task',
          message: new vscode.MarkdownString('Run the requested workspace task?'),
        },
      };
    }

    this._pendingTaskId = item.id;
    const label = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';
    const isGuarded = TaskRunGuardService.getInstance().isGuarded(item);

    const details = [
      `**Type:** ${item.taskType}`,
      item.taskFileUri ? `**Source:** ${vscode.workspace.asRelativePath(item.taskFileUri, true)}` : null,
      isGuarded ? `⚠️ This task is marked as guarded.` : null,
    ].filter(Boolean).join('\n\n');

    return {
      invocationMessage: `Running task '${label}'...`,
      confirmationMessages: {
        title: `Run task '${label}'?`,
        message: new vscode.MarkdownString(details),
      },
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRunTaskParameters>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) {
      const result: RunTaskResult = { started: false, message: 'Cancelled.' };
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    }

    try {
      if (!vscode.workspace.isTrusted) {
        const result: RunTaskResult = { started: false, message: 'This workspace is not trusted. Task execution is disabled in untrusted workspaces.' };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      // Authoritative task resolution
      const resolution = this._resolveTaskWithError(options.input);

      if ('error' in resolution) {
        const result: RunTaskResult = { started: false, message: resolution.error, candidates: resolution.candidates };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      const item = resolution.item;
      const itemLabel = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';

      // Wildcard tasks cannot be run in the non-interactive LM tool context.
      if (item.metadata?.isWildcardTask === true) {
        const result: RunTaskResult = {
          started: false,
          message: `This task requires wildcard values but none were provided. Please specify the wildcard values to run "${itemLabel}".`,
          task: toSummary(item),
        };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      // Determine whether to skip the guard modal.
      // If prepareInvocation resolved this exact task (IDs match), the confirmation
      // message already surfaced any guard warning → skip the guard.
      // Otherwise (TOCTOU, programmatic call, fallback) let TaskRunner decide.
      const skipGuard = this._pendingTaskId !== undefined && this._pendingTaskId === item.id;

      const started = await TaskRunner.getInstance().runTask(item, undefined, skipGuard);

      if (!started) {
        const result: RunTaskResult = {
          started: false,
          message: `Task '${itemLabel}' was not started. It may have been blocked by a guard or declined by the user.`,
          task: toSummary(item),
        };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      const result: RunTaskResult = {
        started: true,
        message: `Task '${itemLabel}' has been started. It runs asynchronously; completion is not reported here.`,
        task: toSummary(item),
      };
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    } catch (err) {
      const result: RunTaskResult = {
        started: false,
        message: `An error occurred while running the task: ${err instanceof Error ? err.message : String(err)}`,
      };
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    }
  }

  /**
   * Attempts to resolve a single `TaskItem` from the input parameters.
   * Returns `undefined` when the task cannot be found (e.g. during `prepareInvocation`).
   */
  private _resolveTask(input: IRunTaskParameters): TaskItem | undefined {
    if (!input) {
      return undefined;
    }

    if (input.id) {
      return TaskCacheService.getInstance().getTask(input.id);
    }

    if (input.label) {
      const leafTasks = collectLeafTasks(TaskCacheService.getInstance().getAllTasks());
      const lowerLabel = input.label.toLowerCase();
      const taskType = input.taskType?.toLowerCase();

      let candidates = leafTasks.filter((item) => {
        const itemLabel = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';
        return itemLabel.toLowerCase() === lowerLabel;
      });

      if (taskType) {
        candidates = candidates.filter((item) => item.taskType.toLowerCase() === taskType);
      }

      if (candidates.length === 1) {
        return candidates[0];
      }
    }

    return undefined;
  }

  /**
   * Resolves a task from the input parameters, returning either a resolved item or
   * a structured error (with optional candidates list).
   */
  private _resolveTaskWithError(
    input: IRunTaskParameters,
  ): { item: TaskItem } | { error: string; candidates?: TaskSummary[] } {
    if (!input) {
      return { error: 'No task specified. Provide either an \'id\' (from #wTasks) or a \'label\'.' };
    }

    if (input.id) {
      const item = TaskCacheService.getInstance().getTask(input.id);
      if (item) {
        return { item };
      }
      if (!input.label) {
        return {
          error: `Task with ID '${input.id}' not found. The cache may still be loading or the task may have been removed. Use #wTasks to discover current IDs.`,
        };
      }
      // Fall through to label lookup when id not found but label is provided
    }

    if (input.label) {
      const leafTasks = collectLeafTasks(TaskCacheService.getInstance().getAllTasks());
      const lowerLabel = input.label.toLowerCase();
      const taskType = input.taskType?.toLowerCase();

      // Exact label match (case-insensitive)
      let exactMatches = leafTasks.filter((item) => {
        const itemLabel = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';
        return itemLabel.toLowerCase() === lowerLabel;
      });

      if (taskType) {
        exactMatches = exactMatches.filter((item) => item.taskType.toLowerCase() === taskType);
      }

      if (exactMatches.length === 1) {
        return { item: exactMatches[0] };
      }

      if (exactMatches.length > 1) {
        return {
          error: `Multiple tasks match the label '${input.label}'. Provide an 'id' for precision.`,
          candidates: exactMatches.map(toSummary),
        };
      }

      // No exact match — try substring match and return candidates, do NOT silently run
      let substringMatches = leafTasks.filter((item) => {
        const itemLabel = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';
        return itemLabel.toLowerCase().includes(lowerLabel);
      });

      if (taskType) {
        substringMatches = substringMatches.filter((item) => item.taskType.toLowerCase() === taskType);
      }

      if (substringMatches.length > 0) {
        return {
          error: `No exact match for '${input.label}'. Did you mean one of these? Provide the 'id' for precision.`,
          candidates: substringMatches.map(toSummary),
        };
      }

      return {
        error: `No task found matching label '${input.label}'${taskType ? ` with type '${input.taskType}'` : ''}. Use #wTasks to discover available tasks.`,
      };
    }

    return { error: 'No task specified. Provide either an \'id\' (from #wTasks) or a \'label\'.' };
  }
}
