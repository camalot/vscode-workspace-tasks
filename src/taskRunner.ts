import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { TaskStateManager } from './taskStateManager';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';

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
    if (!item.resourceUri) { return; }

    let task: vscode.Task | undefined;
    const cwd = path.dirname(item.resourceUri.fsPath);

    // Use originalLabel if available (for grouped tasks), otherwise label
    const taskLabel = item.originalLabel || item.label;

    if (item.taskType === 'npm') {
      task = new vscode.Task(
        { type: 'npm', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'npm',
        new vscode.ShellExecution(`npm run "${taskLabel}" ${args || ''}`.trim(), { cwd })
      );
    } else if (item.taskType === 'script') {
      let command = item.resourceUri.fsPath;
      if (process.platform === 'win32' && (command.endsWith('.ps1'))) {
        command = `powershell -ExecutionPolicy Bypass -File "${command}" ${args || ''}`.trim();
      } else if (process.platform !== 'win32' && command.endsWith('.sh')) {
        command = `bash "${command}" ${args || ''}`.trim();
      } else {
        command = `"${command}" ${args || ''}`.trim();
      }

      task = new vscode.Task(
        { type: 'script', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'script',
        new vscode.ShellExecution(command, { cwd })
      );
    } else if (item.taskType === 'vscode') {
      const tasks = await vscode.tasks.fetchTasks();
      task = tasks.find(t => t.name === taskLabel && t.source === 'Workspace');
      if (!task) {
        vscode.window.showWarningMessage(`Could not find VS Code task '${taskLabel}'. Make sure it is valid.`);
        return;
      }
    } else if (item.taskType === 'makefile') {
      task = new vscode.Task(
        { type: 'makefile', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'makefile',
        new vscode.ShellExecution(`make "${taskLabel}" ${args || ''}`.trim(), { cwd })
      );
    } else if (item.taskType === 'dockerfile') {
      const command = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, 'DockerFile', item.resourceUri);
      if (command) {
        const fullCommand = args ? `${command} ${args}` : command;
        task = new vscode.Task(
          { type: 'dockerfile', task: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'dockerfile',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
      }
    } else if (item.taskType === 'workspace-task') {
      const configType = item.taskSource || 'shell';
      const command = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, configType, item.resourceUri);
      if (command) {
        const fullCommand = args ? `${command} ${args}` : command;
        task = new vscode.Task(
          { type: 'workspace-task', task: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'workspace-task',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
      }
    } else if (item.taskType === 'justfile') {
      task = new vscode.Task(
        { type: 'justfile', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'just',
        new vscode.ShellExecution(`just "${taskLabel}" ${args || ''}`.trim(), { cwd })
      );
    } else if (item.taskType === 'venv') {
      let command = item.resourceUri.fsPath;
      // Recover real path if we faked it for the icon
      if (command.endsWith('.py') && (command.includes('activate') || command.includes('deactivate'))) {
        command = command.substring(0, command.length - 3);
      }

      // Script execution logic similar to 'script' type but simpler as we know extensions
      if (process.platform === 'win32' && (command.toLowerCase().endsWith('.ps1'))) {
        command = `powershell -ExecutionPolicy Bypass -File "${command}" ${args || ''}`.trim();
      } else if (process.platform !== 'win32' && (command.endsWith('.fish'))) {
        command = `fish "${command}" ${args || ''}`.trim();
      } else if (process.platform !== 'win32' && (command.endsWith('.bat'))) {
        // Bat on non-windows? Unlikely to work, but proceed.
        command = `"${command}" ${args || ''}`.trim();
      } else {
        command = `"${command}" ${args || ''}`.trim();
      }

      task = new vscode.Task(
        { type: 'venv', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'venv',
        new vscode.ShellExecution(command, { cwd })
      );
    } else if (item.taskType === 'ant') {
      const antProvider = new AntTaskProvider();
      const useAnsicon = antProvider.shouldUseAnsicon();

      // Get workspace folder for resolving relative paths
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
      const workspaceUri = workspaceFolder?.uri;

      let command: string;
      let commandArgs: string[];
      let antCommand: string;

      if (useAnsicon) {
        // Use ansicon as wrapper
        command = antProvider.getAnsiconPath();
        antCommand = antProvider.getCommand(workspaceUri);
        console.log(`[TaskRunner] Ant command for ansicon: "${antCommand}"`);
        // Pass the build file path explicitly to avoid "Buildfile: build.xml does not exist!" if file is named differently
        // or if typical cwd inheritance issues occur
        commandArgs = [antCommand].concat(antProvider.getCommandArgs(taskLabel, true, item.resourceUri.fsPath));
      } else {
        // Use ant directly
        antCommand = antProvider.getCommand(workspaceUri);
        command = antCommand;
        commandArgs = antProvider.getCommandArgs(taskLabel, false, item.resourceUri.fsPath);
      }

      // Add user-provided args if any
      if (args) {
        commandArgs.push(...args.split(' '));
      }

      // Calculate ANT_HOME
      let antHome = path.dirname(antCommand);
      if (path.basename(antHome) === 'bin') {
        antHome = path.dirname(antHome);
      }

      if (useAnsicon) {
        // Use ansicon as wrapper
        // The user has verified that ANT_HOME is set correctly in their environment/package
        const ansiconArgs = commandArgs.map(arg => `"${arg}"`).join(' ');
        const fullCommand = `"${command}" ${ansiconArgs}`;
        console.log(`[TaskRunner] Using ansicon, full command: ${fullCommand}`);

        task = new vscode.Task(
          { type: 'ant', target: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'ant',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
      } else {
        task = new vscode.Task(
          { type: 'ant', target: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'ant',
          new vscode.ShellExecution(command, commandArgs, { cwd })
        );
      }    } else if (item.taskType === 'msbuild') {
        const msbuildProvider = new MsBuildTaskProvider();

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
        const workspaceUri = workspaceFolder?.uri;

        const command = msbuildProvider.getCommand(workspaceUri);
        const commandArgs = msbuildProvider.getCommandArgs(taskLabel, item.resourceUri.fsPath);

        if (args) {
            commandArgs.push(...args.split(' '));
        }

        task = new vscode.Task(
            { type: 'msbuild', target: taskLabel },
            vscode.TaskScope.Workspace,
            taskLabel,
            'msbuild',
            new vscode.ShellExecution(command, commandArgs, { cwd })
        );    }

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
        throw e;
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
        await this.runTask(item);
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
