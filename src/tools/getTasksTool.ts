import * as vscode from 'vscode';
import { TaskCacheService } from '../services/taskCacheService';
import { collectLeafTasks, toSummary, TaskSummary } from './taskToolsUtils';

/** Maximum number of tasks returned in a single invocation. */
const MAX_TASKS_RETURNED = 500;

/** Input parameters accepted by the GetTasksTool. */
export interface IGetTasksParameters {
  /** Case-insensitive label substring filter. */
  query?: string;
  /** Task type filter (e.g. 'npm', 'shell'). */
  taskType?: string;
}

/** JSON payload returned from the GetTasksTool. */
interface GetTasksResult {
  isTrusted: boolean;
  isLoading: boolean;
  tasks: TaskSummary[];
  truncated: boolean;
  totalBeforeTruncation: number;
  explanation?: string;
}

/**
 * Language model tool that lists all runnable tasks in the current workspace.
 * Read-only — does not execute any tasks.
 */
export class GetTasksTool implements vscode.LanguageModelTool<IGetTasksParameters> {
  public prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IGetTasksParameters>,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Fetching available workspace tasks...',
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetTasksParameters>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({ isTrusted: vscode.workspace.isTrusted, isLoading: false, tasks: [], truncated: false, totalBeforeTruncation: 0, explanation: 'Cancelled.' })),
      ]);
    }

    try {
      if (!vscode.workspace.isTrusted) {
        const result: GetTasksResult = {
          isTrusted: false,
          isLoading: false,
          tasks: [],
          truncated: false,
          totalBeforeTruncation: 0,
          explanation: 'This workspace is not trusted. Task discovery is disabled in untrusted workspaces.',
        };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      const cache = TaskCacheService.getInstance();

      if (cache.isLoading()) {
        const result: GetTasksResult = {
          isTrusted: true,
          isLoading: true,
          tasks: [],
          truncated: false,
          totalBeforeTruncation: 0,
          explanation: 'Task discovery is still in progress. Re-invoke after a short delay.',
        };
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
      }

      let leafTasks = collectLeafTasks(cache.getAllTasks());

      // Apply filters
      const query = options.input?.query?.toLowerCase();
      const taskType = options.input?.taskType?.toLowerCase();

      if (query) {
        leafTasks = leafTasks.filter((item) => {
          const label = typeof item.label === 'string' ? item.label : item.originalLabel ?? '';
          return label.toLowerCase().includes(query);
        });
      }

      if (taskType) {
        leafTasks = leafTasks.filter((item) => item.taskType.toLowerCase() === taskType);
      }

      // Sort deterministically by (type, label)
      leafTasks.sort((a, b) => {
        const typeComp = a.taskType.localeCompare(b.taskType);
        if (typeComp !== 0) {
          return typeComp;
        }
        const labelA = typeof a.label === 'string' ? a.label : a.originalLabel ?? '';
        const labelB = typeof b.label === 'string' ? b.label : b.originalLabel ?? '';
        return labelA.localeCompare(labelB);
      });

      const totalBeforeTruncation = leafTasks.length;
      const truncated = leafTasks.length > MAX_TASKS_RETURNED;
      if (truncated) {
        leafTasks = leafTasks.slice(0, MAX_TASKS_RETURNED);
      }

      const result: GetTasksResult = {
        isTrusted: true,
        isLoading: false,
        tasks: leafTasks.map(toSummary),
        truncated,
        totalBeforeTruncation,
      };

      if (leafTasks.length === 0) {
        result.explanation = 'No tasks found matching the given filters.';
      } else if (truncated) {
        result.explanation = `Result truncated to ${MAX_TASKS_RETURNED} of ${totalBeforeTruncation} tasks. Apply 'query' or 'taskType' filters to narrow results.`;
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    } catch (err) {
      const result: GetTasksResult = {
        isTrusted: vscode.workspace.isTrusted,
        isLoading: false,
        tasks: [],
        truncated: false,
        totalBeforeTruncation: 0,
        explanation: `An error occurred while fetching tasks: ${err instanceof Error ? err.message : String(err)}`,
      };
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result))]);
    }
  }
}
