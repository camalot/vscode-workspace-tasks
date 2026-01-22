import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';

export interface CreatedTask {
  task: vscode.Task;
  command?: string; // the resolved shell command string (if any)
  cwd: string;
}

export async function createTaskForItem(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
  if (!item) { return undefined; }

  const cwd = item.resourceUri ? path.dirname(item.resourceUri.fsPath) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri.fsPath : process.cwd());
  const fallbackWorkspaceUri = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file(cwd);
  const resourceUri = item.resourceUri ?? fallbackWorkspaceUri;
  const taskLabel = item.originalLabel || item.label;

  // Prefer workspace-declared task when available
  if (item.taskSource) {
    const declared = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, item.taskSource || 'shell', resourceUri);
    if (declared) {
      const fullCommand = args ? `${declared} ${args}` : declared;
      const task = new vscode.Task(
        { type: 'workspace-task', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'workspace-task',
        new vscode.ShellExecution(fullCommand, { cwd })
      );

      return { task, command: fullCommand, cwd };
    }
  }

  // Fallbacks by task type
  switch (item.taskType) {
    case 'npm': {
      const full = `npm run "${taskLabel}" ${args || ''}`.trim();
      const task = new vscode.Task(
        { type: 'npm', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'npm',
        new vscode.ShellExecution(full, { cwd })
      );
      return { task, command: full, cwd };
    }
    case 'script': {
      if (!item.resourceUri) { return undefined; }
      let command = item.resourceUri.fsPath;
      if (process.platform === 'win32' && (command.endsWith('.ps1'))) {
        command = `powershell -ExecutionPolicy Bypass -File "${command}" ${args || ''}`.trim();
      } else if (process.platform !== 'win32' && command.endsWith('.sh')) {
        command = `bash "${command}" ${args || ''}`.trim();
      } else {
        command = `"${command}" ${args || ''}`.trim();
      }

      const task = new vscode.Task(
        { type: 'script', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'script',
        new vscode.ShellExecution(command, { cwd })
      );
      return { task, command, cwd };
    }
    case 'grunt': {
      const gruntCmd = process.platform === 'win32' ? 'grunt.cmd' : 'grunt';
      const gruntArgs: string[] = [];
      if (taskLabel && taskLabel.length > 0) { gruntArgs.push(taskLabel); }
      const fileName = resourceUri ? path.basename(resourceUri.fsPath).toLowerCase() : undefined;
      if (fileName && fileName !== 'gruntfile.js' && item.resourceUri) {
        gruntArgs.push('--gruntfile', item.resourceUri.fsPath);
      }
      if (args) { gruntArgs.push(...args.split(' ')); }

      const task = new vscode.Task(
        { type: 'grunt', target: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'grunt',
        new vscode.ShellExecution(gruntCmd, gruntArgs, { cwd })
      );
      return { task, command: `${gruntCmd} ${gruntArgs.join(' ')}`.trim(), cwd };
    }
    case 'gulp': {
      // Use npx to prefer workspace-local gulp if available
      const gulpCmd = 'npx';
      // We'll build the args carefully so --gulpfile appears before the task name if needed
      let gulpArgs: string[] = ['gulp'];

      // Prefer workspace folder root as cwd so local install (node_modules) is resolved correctly
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const gulpCwd = workspaceFolder?.uri.fsPath || cwd;

      // If the gulpfile is not located in the cwd, ensure we pass it explicitly right after 'gulp'
      if (item.resourceUri && path.dirname(item.resourceUri.fsPath) !== gulpCwd) {
        gulpArgs = ['gulp', '--gulpfile', item.resourceUri.fsPath];
        if (taskLabel && taskLabel.length > 0) { gulpArgs.push(taskLabel); }
      } else {
        if (taskLabel && taskLabel.length > 0) { gulpArgs.push(taskLabel); }
      }

      if (args) { gulpArgs.push(...args.split(' ')); }

      const task = new vscode.Task(
        { type: 'gulp', target: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'gulp',
        new vscode.ShellExecution(gulpCmd, gulpArgs, { cwd: gulpCwd })
      );

      // Debug info to help diagnose incorrect gulpfile selection
      console.log(`[TaskFactory] Gulp task created. cwd=${gulpCwd}, args=${JSON.stringify(gulpArgs)}`);

      return { task, command: `${gulpCmd} ${gulpArgs.join(' ')}`.trim(), cwd: gulpCwd };
    }
    case 'ant': {
      const antProvider = new AntTaskProvider();
      const useAnsicon = antProvider.shouldUseAnsicon();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const workspaceUri = workspaceFolder?.uri;

      let command: string;
      let commandArgs: string[];
      let antCommand: string;

      if (useAnsicon) {
        command = antProvider.getAnsiconPath();
        antCommand = antProvider.getCommand(workspaceUri);
        commandArgs = [antCommand].concat(antProvider.getCommandArgs(taskLabel, true, item.resourceUri?.fsPath));
      } else {
        antCommand = antProvider.getCommand(workspaceUri);
        command = antCommand;
        commandArgs = antProvider.getCommandArgs(taskLabel, false, item.resourceUri?.fsPath);
      }

      if (args) { commandArgs.push(...args.split(' ')); }

      if (useAnsicon) {
        const ansiconArgs = commandArgs.map(arg => `"${arg}"`).join(' ');
        const fullCommand = `"${command}" ${ansiconArgs}`;
        const task = new vscode.Task(
          { type: 'ant', target: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'ant',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
        return { task, command: fullCommand, cwd };
      } else {
        const task = new vscode.Task(
          { type: 'ant', target: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'ant',
          new vscode.ShellExecution(command, commandArgs, { cwd })
        );
        return { task, command: `${command} ${commandArgs.join(' ')}`, cwd };
      }
    }
    case 'workspace-task': {
      // This case occurs when a workspace task exists without file association
      const configType = item.taskSource || 'shell';
      const declared = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, configType, resourceUri);
      if (declared) {
        const fullCommand = args ? `${declared} ${args}` : declared;
        const task = new vscode.Task(
          { type: 'workspace-task', task: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'workspace-task',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
        return { task, command: fullCommand, cwd };
      }
      return undefined;
    }
    case 'vscode': {
      // Use existing VS Code task defined in .vscode/tasks.json
      const tasks = await vscode.tasks.fetchTasks();
      const found = tasks.find(t => t.name === taskLabel && t.source === 'Workspace');
      if (found) {
        return { task: found, cwd };
      }
      return undefined;
    }
    case 'makefile': {
      const full = `make "${taskLabel}" ${args || ''}`.trim();
      const task = new vscode.Task(
        { type: 'makefile', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'makefile',
        new vscode.ShellExecution(full, { cwd })
      );
      return { task, command: full, cwd };
    }
    case 'dockerfile': {
      const command = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, 'DockerFile', resourceUri);
      if (command) {
        const fullCommand = args ? `${command} ${args}` : command;
        const task = new vscode.Task(
          { type: 'dockerfile', task: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'dockerfile',
          new vscode.ShellExecution(fullCommand, { cwd })
        );
        return { task, command: fullCommand, cwd };
      }
      return undefined;
    }
    case 'venv': {
      if (!item.resourceUri) { return undefined; }
      let command = item.resourceUri.fsPath;
      if (command.endsWith('.py') && (command.includes('activate') || command.includes('deactivate'))) {
        command = command.substring(0, command.length - 3);
      }
      if (process.platform === 'win32' && (command.toLowerCase().endsWith('.ps1'))) {
        command = `powershell -ExecutionPolicy Bypass -File "${command}" ${args || ''}`.trim();
      } else if (process.platform !== 'win32' && (command.endsWith('.fish'))) {
        command = `fish "${command}" ${args || ''}`.trim();
      } else {
        command = `"${command}" ${args || ''}`.trim();
      }
      const task = new vscode.Task(
        { type: 'venv', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'venv',
        new vscode.ShellExecution(command, { cwd })
      );
      return { task, command, cwd };
    }
    case 'msbuild': {
      if (!item.resourceUri) { return undefined; }
      const msbuildProvider = new MsBuildTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
      const workspaceUri = workspaceFolder?.uri;
      const command = msbuildProvider.getCommand(workspaceUri);
      const commandArgs = msbuildProvider.getCommandArgs(taskLabel, item.resourceUri.fsPath);
      if (args) { commandArgs.push(...args.split(' ')); }
      const task = new vscode.Task(
        { type: 'msbuild', target: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'msbuild',
        new vscode.ShellExecution(command, commandArgs, { cwd })
      );
      return { task, command: `${command} ${commandArgs.join(' ')}`, cwd };
    }
    case 'justfile': {
      const full = `just "${taskLabel}" ${args || ''}`.trim();
      const task = new vscode.Task(
        { type: 'justfile', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'just',
        new vscode.ShellExecution(full, { cwd })
      );
      return { task, command: full, cwd };
    }
    default: {
      // Generic: run as shell command if workspace has a declared task
      return undefined;
    }
  }
}
