import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { TaskEnvService } from './services/taskEnvService';
import { TaskSecretWarningService } from './services/taskSecretWarningService';
import { resolveTaskContext, CreatedTask } from './libs/taskCreationUtils';
import { TaskProviderRegistry } from './taskProviderRegistry';
import { LoggerService } from './services/loggerService';
import { ensureTaskProviderRegistryPopulated } from './providers';
import { JupyterTerm } from './providers/jupyterTaskProvider';

// Re-exported for backward compatibility — CreatedTask is defined in taskCreationUtils.
export type { CreatedTask } from './libs/taskCreationUtils';

const SPECIAL_CASE_TASK_TYPES = ['shell', 'jupyter', 'vscode', 'dockerfile'] as const;

/**
 * The complete set of task types supported by createTaskForItem.
 * Any item whose taskType is NOT in this set (and has no taskSource or native task)
 * will return undefined from createTaskForItem and cannot be run.
 */
function buildKnownTaskTypes(): ReadonlySet<string> {
  ensureTaskProviderRegistryPopulated();
  const knownTypes = new Set(TaskProviderRegistry.getInstance().getKnownTypes());
  for (const taskType of SPECIAL_CASE_TASK_TYPES) {
    knownTypes.add(taskType);
  }
  return knownTypes;
}

export const KNOWN_TASK_TYPES: ReadonlySet<string> = buildKnownTaskTypes();

/**
 * Injects runtime args into a command.
 * If ${args} exists, all occurrences are replaced; otherwise args are appended.
 */
export function injectArgs(command: string, args?: string): string {
  if (!args) {
    return command;
  }

  if (command.includes('${args}')) {
    return command.replaceAll('${args}', () => args);
  }

  return `${command} ${args}`;
}

export function createJupyterPseudoterminal(
  resourceUri: vscode.Uri,
  cellIndex: number | undefined,
  taskLabel: string,
): vscode.Pseudoterminal {
  return new JupyterTerm(resourceUri, cellIndex, taskLabel);
}

export function createJupyterExecutionCallback(
  resourceUri: vscode.Uri,
  cellIndex: number | undefined,
  taskLabel: string,
): () => Promise<vscode.Pseudoterminal> {
  return async (): Promise<vscode.Pseudoterminal> => createJupyterPseudoterminal(resourceUri, cellIndex, taskLabel);
}

export function isMatchingVscodeTask(
  task: vscode.Task,
  taskLabel: string,
  targetWorkspaceFolder?: vscode.WorkspaceFolder,
): boolean {
  // Accept both workspace tasks and user-level tasks (source === 'User')
  const nameMatch = task.name === taskLabel && (task.source === 'Workspace' || task.source === 'User');
  if (!nameMatch) {
    return false;
  }

  // If we know the target workspace folder, ensure the task belongs to it
  if (targetWorkspaceFolder && typeof task.scope === 'object' && 'uri' in task.scope) {
    return task.scope.uri.toString() === targetWorkspaceFolder.uri.toString();
  }

  // If we don't know the folder, or the task has global/workspace scope, accept it as fallback
  return true;
}

/**
 * Builds the raw task without env injection. Used internally by `createTaskForItem`.
 */
async function _buildTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
  if (!item) {
    return undefined;
  }

  if (item.task && item.task instanceof vscode.Task) {
    // Only use item.task directly when it is a proper vscode.Task instance (e.g. from getSystemTasks).
    // Raw JSON objects set on item.task during JSON file parsing are not vscode.Task instances
    // and have no execution — returning them would cause "Tasks to execute must include an execution".
    return { task: item.task, native: true };
  }

  const context = resolveTaskContext(item);
  const { effectiveResourceUri, cwd, resourceUri } = context;
  const taskLabel = item.originalLabel || item.label;

  // Prefer workspace-declared task when available
  if (item.taskSource) {
    const declared = await WorkspaceTasksService.getInstance().resolveTaskCommand(
      taskLabel,
      item.taskSource || 'shell',
      resourceUri,
    );
    if (declared) {
      const fullCommand = injectArgs(declared, args);
      const task = new vscode.Task(
        { type: 'workspace-task', task: taskLabel, path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'workspace-task',
        new vscode.ShellExecution(fullCommand, { cwd }),
      );

      return { task, command: fullCommand, cwd, native: false };
    }
  }

  // Track 1: registry-based providers.
  // If the provider has implemented createTask() and it returns a non-undefined result,
  // use that. If it returns undefined (either the base-class default for not-yet-migrated
  // providers, or a legitimate "cannot build" signal), fall through to Track 2.
  ensureTaskProviderRegistryPopulated();
  const registry = TaskProviderRegistry.getInstance();
  const registryProvider = registry.get(item.taskType);
  if (registryProvider) {
    try {
      const registryResult = await registryProvider.createTask(item, args);
      if (registryResult !== undefined) {
        return registryResult;
      }
    } catch (err) {
      LoggerService.getInstance().error(
        `[taskFactory] provider.createTask failed for '${item.taskType}': ${err}`,
      );
      return undefined;
    }
  }

  // Track 2: special-case helper logic that does not map to provider getCommand/createTask.
  switch (item.taskType) {
    case 'jupyter': {
      // Use CustomExecution to run Jupyter cell via Visual Studio Code command
      const task = new vscode.Task(
        { type: 'jupyter', task: taskLabel, path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'jupyter',
        new vscode.CustomExecution(createJupyterExecutionCallback(resourceUri, item.metadata?.cellIndex, taskLabel)),
      );
      return { task, command: 'jupyter.runcell', cwd: path.dirname(resourceUri.fsPath), native: false };
    }
    case 'shell': {
      // item.taskFileUri is the actual script file URI. item.resourceUri is always a
      // synthetic workspace-tasks:// URI set by updateContextValue(), so it cannot be
      // used as a guard. When no real file is associated, return undefined instead of
      // falling through with the workspace root as a script path.
      if (!effectiveResourceUri) {
        return undefined;
      }
      const interpreter = item.metadata?.interpreter || '';

      // If interpreter is provided, construct command
      // e.g. "python", "script.py" -> "python script.py"
      // e.g. "wsl.exe /bin/bash", "script.sh" -> "wsl.exe /bin/bash script.sh"
      //
      // When interpreter is empty the script is executed directly, which allows
      // the OS to honour the shebang line (e.g. "#!/usr/bin/env python3").
      // The file must be executable for this to work on Unix-like systems.

      let shellExec: vscode.ShellExecution;
      let commandString: string;

      // Use array form to properly handle paths with spaces in both interpreter and script
      const shellArgs = [resourceUri.fsPath];
      if (args) {
        shellArgs.push(...args.split(' '));
      }

      if (interpreter) {
        shellExec = new vscode.ShellExecution(interpreter, shellArgs, { cwd });
        commandString = `${interpreter} ${shellArgs.join(' ')}`;
      } else {
        // Execute directly — the OS will use the shebang interpreter (if present)
        commandString = `"${resourceUri.fsPath}"`;
        if (args) {
          commandString += ` ${shellArgs.slice(1).join(' ')}`;
        }
        shellExec = new vscode.ShellExecution(commandString, { cwd });
      }

      // Use relative path as task name to ensure uniqueness and prevent terminal reuse conflicts
      const uniqueTaskName = vscode.workspace.asRelativePath(resourceUri);

      const task = new vscode.Task(
        { type: 'shell', script: taskLabel, path: resourceUri.fsPath, id: item.id || undefined },
        vscode.TaskScope.Workspace,
        uniqueTaskName,
        'shell',
        shellExec,
      );
      return { task, command: commandString, cwd, native: false };
    }
    case 'vscode': {
      // Use existing Visual Studio Code task defined in .vscode/tasks.json
      const tasks = await vscode.tasks.fetchTasks();
      const taskUri = item.taskFileUri || item.resourceUri;
      const targetWorkspaceFolder = taskUri
        ? vscode.workspace.getWorkspaceFolder(taskUri)
        : undefined;

      const found = tasks.find((t) => isMatchingVscodeTask(t, taskLabel, targetWorkspaceFolder));

      if (found) {
        return { task: found, cwd: undefined, native: true };
      }
      return undefined;
    }
    case 'dockerfile': {
      const command = await WorkspaceTasksService.getInstance().resolveTaskCommand(
        taskLabel,
        'DockerFile',
        resourceUri,
      );
      if (command) {
        // Dockerfile provider uses resolveTaskCommand which returns a string presumably from user config map?
        // It does not use ExecutableService.getCommand directly here on taskFactory level.
        // So we leave it as is.
        const fullCommand = args ? `${command} ${args}` : command;
        const task = new vscode.Task(
          { type: 'dockerfile', task: taskLabel, path: resourceUri.fsPath },
          vscode.TaskScope.Workspace,
          taskLabel,
          'dockerfile',
          new vscode.ShellExecution(fullCommand, { cwd }),
        );
        return { task, command: fullCommand, cwd, native: false };
      }
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Creates a `vscode.Task` for the given `TaskItem`, injecting resolved environment
 * variables (from `TaskEnvService`) into the task's `ShellExecution` options.
 *
 * @param item  The task item to build a task for.
 * @param args  Optional extra CLI arguments to append to the command.
 */
export async function createTaskForItem(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
  const result = await _buildTask(item, args);

  if (result && !result.native && result.task.execution instanceof vscode.ShellExecution) {
    const envService = TaskEnvService.getInstance();
    const envMap = await envService.resolveTaskEnv(item);
    if (envMap.size > 0) {
      const env: Record<string, string> = {};
      for (const [key, entry] of envMap) {
        env[key] = entry.value;
      }
      const existingEnv = result.task.execution.options?.env ?? {};
      result.task.execution.options = {
        ...result.task.execution.options,
        env: { ...existingEnv, ...env },
      };
    }

    // Phase 4: warn about suspicious keys in git-tracked files (fire-and-forget)
    const taskLabel = (item.originalLabel || item.label) as string;
    void TaskSecretWarningService.getInstance().checkAndWarn(
      taskLabel,
      envMap,
      envService.currentSecretPatterns,
    );
  }

  return result;
}
