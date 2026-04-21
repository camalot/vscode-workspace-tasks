import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { TaskEnvService } from './services/taskEnvService';
import { TaskSecretWarningService } from './services/taskSecretWarningService';
import { NpmTaskProvider } from './providers/npmTaskProvider';
import { resolveTaskContext, CreatedTask } from './libs/taskCreationUtils';
import { TaskProviderRegistry } from './taskProviderRegistry';
import { LoggerService } from './services/loggerService';
import { ensureTaskProviderRegistryPopulated } from './providers';

// Re-exported for backward compatibility — CreatedTask is defined in taskCreationUtils.
export type { CreatedTask } from './libs/taskCreationUtils';

/**
 * The complete set of task types with a case-handler in createTaskForItem.
 * Any item whose taskType is NOT in this set (and has no taskSource or native task) will
 * return undefined from createTaskForItem and cannot be run.
 */
export const KNOWN_TASK_TYPES: ReadonlySet<string> = new Set([
  'npm', 'yarn', 'bun', 'pnpm', 'deno', 'mise', 'jupyter',
  'maven', 'gradle', 'composer', 'shell', 'grunt', 'gulp', 'ant',
  'workspace-task', 'github-actions', 'vscode', 'makefile', 'dockerfile',
  'pipenv', 'venv', 'msbuild', 'justfile', 'cmake', 'cake',
  'poe', 'poetry', 'cargo-make', 'taskfile', 'gitlab-ci',
  'circleci', 'bitbucket',
]);

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

  const effectiveResourceUri = item.taskFileUri;
  const cwd = effectiveResourceUri
    ? path.dirname(effectiveResourceUri.fsPath)
    : vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : process.cwd();
  const fallbackWorkspaceUri =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? vscode.workspace.workspaceFolders[0].uri
      : vscode.Uri.file(cwd);
  const resourceUri = effectiveResourceUri ?? fallbackWorkspaceUri;
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

  // Track 2: legacy switch — handles providers not yet migrated to createTask(),
  // plus special-case types (shell, jupyter, vscode, venv, dockerfile) that will
  // remain here as private helpers after the full refactor is complete.
  // npm is handled by NpmTaskProvider.createTask() via Track 1 when the registry is
  // populated (normal runtime). This case is a fallback for test environments where
  // the extension may not have fully activated before the factory is called.
  switch (item.taskType) {
    case 'npm': {
      return new NpmTaskProvider().createTask(item, args);
    }
    case 'jupyter': {
      // Use CustomExecution to run Jupyter cell via Visual Studio Code command
      const task = new vscode.Task(
        { type: 'jupyter', task: taskLabel, path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'jupyter',
        new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
          return new JupyterTerm(resourceUri, item.metadata?.cellIndex, taskLabel);
        }),
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
    case 'workspace-task': {
      // This case occurs when a workspace task exists without file association
      const configType = item.taskSource || 'shell';
      const declared = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, configType, resourceUri);
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
      return undefined;
    }
    case 'vscode': {
      // Use existing Visual Studio Code task defined in .vscode/tasks.json
      const tasks = await vscode.tasks.fetchTasks();
      const taskUri = item.taskFileUri || item.resourceUri;
      const targetWorkspaceFolder = taskUri
        ? vscode.workspace.getWorkspaceFolder(taskUri)
        : undefined;

      const found = tasks.find((t) => {
        // Accept both workspace tasks and user-level tasks (source === 'User')
        const nameMatch = t.name === taskLabel && (t.source === 'Workspace' || t.source === 'User');
        if (!nameMatch) {
          return false;
        }

        // If we know the target workspace folder, ensure the task belongs to it
        if (targetWorkspaceFolder && typeof t.scope === 'object' && 'uri' in t.scope) {
          return t.scope.uri.toString() === targetWorkspaceFolder.uri.toString();
        }

        // If we don't know the folder, or the task has global/workspace scope, accepts it as fallback
        return true;
      });

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
    case 'venv': {
      const taskUri = item.taskFileUri || item.resourceUri;
      if (!taskUri) {
        return undefined;
      }
      let scriptPath = taskUri.fsPath;

      let shellExec: vscode.ShellExecution;
      let commandString: string;

      if (process.platform === 'win32' && scriptPath.toLowerCase().endsWith('.ps1')) {
        // Use array form to properly handle paths with spaces
        const shellArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
        if (args) {
          shellArgs.push(...args.split(' '));
        }
        shellExec = new vscode.ShellExecution('powershell', shellArgs, { cwd });
        commandString = `powershell ${shellArgs.join(' ')}`;
      } else {
        // For non-PowerShell scripts, keep the quoted string approach
        commandString = `"${scriptPath}" ${args || ''}`.trim();
        shellExec = new vscode.ShellExecution(commandString, { cwd });
      }

      const task = new vscode.Task(
        { type: 'venv', task: taskLabel, path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'venv',
        shellExec,
      );
      return { task, command: commandString, cwd, native: false };
    }
    default: {
      // Generic: run as shell command if workspace has a declared task
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

class JupyterTerm implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  constructor(
    private resourceUri: vscode.Uri,
    private cellIndex: number | undefined,
    private label: string,
  ) {}

  /*initialDimensions: vscode.TerminalDimensions | undefined*/
  open(): void {
    this.doRun();
  }

  close(): void {}

  private async doRun(): Promise<void> {
    this.writeEmitter.fire(`Executing Jupyter Cell in ${this.label}...\r\n`);

    try {
      // If we have a cell index, we try to run that specific cell
      if (this.cellIndex !== undefined && this.cellIndex >= 0) {
        // 1. Ensure document is open
        const doc = await vscode.workspace.openNotebookDocument(this.resourceUri);
        await vscode.window.showNotebookDocument(doc);

        // 2. Find the cell
        if (this.cellIndex < doc.cellCount) {
          //const cell = doc.cellAt(this.cellIndex);

          // 3. Execute
          // Using generic notebook command as jupyter.runcell behavior on ipynb is ambiguous
          // However, user requested jupyter.runcell.
          // If that command takes a range, we can try passing the cell range.

          // Try standard notebook execution first which is robust
          try {
            // This is the Visual Studio Code API way
            const execution = vscode.commands.executeCommand('notebook.cell.execute', {
              ranges: [{ start: this.cellIndex, end: this.cellIndex + 1 }],
              document: doc.uri,
            });
            await execution;
            this.writeEmitter.fire(`\r\nCell sent to execution.\r\n`);
          } catch (e) {
            // Fallback to user requested command if standard fails, or if they meant the older way?
            // jupyter.runcell(file, startLine, startChar, endLine, endChar)
            // converting cell range to what? 0,0,0,0?
            this.writeEmitter.fire(`Error executing cell: ${e}\r\n`);
            this.closeEmitter.fire(1);
            return;
          }
        } else {
          this.writeEmitter.fire(`Cell index ${this.cellIndex} out of bounds.\r\n`);
          this.closeEmitter.fire(1);
          return;
        }
      } else {
        this.writeEmitter.fire(`No cell index provided. Cannot execute.\r\n`);
        this.closeEmitter.fire(1);
        return;
      }

      this.closeEmitter.fire(0);
    } catch (e) {
      this.writeEmitter.fire(`Error: ${e}\r\n`);
      this.closeEmitter.fire(1);
    }
  }
}
