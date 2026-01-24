import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskItem } from './taskItem';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';
import { ComposerTaskProvider } from './providers/composerTaskProvider';
import { GradleTaskProvider } from './providers/gradleTaskProvider';
import { JustfileTaskProvider } from './providers/justfileTaskProvider';
import { ExecutableService } from './services/executableService';

export interface CreatedTask {
  task: vscode.Task;
  command?: string; // the resolved shell command string (if any)
  cwd: string;
}

export async function createTaskForItem(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
  if (!item) { return undefined; }

  const effectiveResourceUri = item.taskFileUri || item.resourceUri;
  const cwd = effectiveResourceUri ? path.dirname(effectiveResourceUri.fsPath) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri.fsPath : process.cwd());
  const fallbackWorkspaceUri = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri : vscode.Uri.file(cwd);
  const resourceUri = effectiveResourceUri ?? fallbackWorkspaceUri;
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
    case 'gradle': {
      // gradle [task] [args]
      const gradleProvider = new GradleTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const gradleCmd = gradleProvider.getCommand(workspaceFolder?.uri);

      const gradleArgs = [taskLabel];
      if (args) {
        gradleArgs.push(...args.split(' '));
      }

      let full: string;
      let shellExec: vscode.ShellExecution;

      // Check if command is a path with spaces
      if (gradleCmd.includes(' ')) {
        shellExec = new vscode.ShellExecution(gradleCmd, gradleArgs, { cwd });
        full = `"${gradleCmd}" ${gradleArgs.join(' ')}`;
      } else {
        full = `${gradleCmd} ${gradleArgs.join(' ')}`;
        shellExec = new vscode.ShellExecution(full, { cwd });
      }

      const task = new vscode.Task(
        { type: 'gradle', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'gradle',
        shellExec
      );
      return { task, command: full, cwd };
    }
    case 'composer': {
      // composer run-script [script] [args]
      const composerProvider = new ComposerTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const composerCmd = composerProvider.getCommand(workspaceFolder?.uri);

      const composerArgs = ['run-script', taskLabel];
      if (args) {
        composerArgs.push('--');
        composerArgs.push(...args.split(' '));
      }

      // If composerCmd has spaces and is not quoted, quote it? ShellExecution handles args, but command string...
      // If we use array form ShellExecution, we separate cmd and args.

      let full: string;
      let shellExec: vscode.ShellExecution;

      // Check if command is a path with spaces
      if (composerCmd.includes(' ')) {
        // Use formatted command string for ShellExecution if we want to be safe or just pass executable and args array
        shellExec = new vscode.ShellExecution(composerCmd, composerArgs, { cwd });
        full = `"${composerCmd}" ${composerArgs.join(' ')}`;
      } else {
        full = `${composerCmd} ${composerArgs.join(' ')}`;
        shellExec = new vscode.ShellExecution(full, { cwd });
      }

      const task = new vscode.Task(
        { type: 'composer', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'composer',
        shellExec
      );
      return { task, command: full, cwd };
    }
    case 'shell': {
      if (!item.resourceUri) { return undefined; }
      const interpreter = item.metadata?.interpreter || '';

      // If interpreter is provided, construct command
      // e.g. "python", "script.py" -> "python script.py"
      // e.g. "wsl.exe /bin/bash", "script.sh" -> "wsl.exe /bin/bash script.sh"

      let command: string;

      if (interpreter) {
          // Check if we need to append .exe on Windows for the interpreter binary?
          // The user said: "The paths to the interpreters should not be changed... On windows, it might need to change the executable to end in .exe"
          // We'll trust the ShellExecution to handle path resolution for the binary.

          command = `${interpreter} "${item.resourceUri.fsPath}"`;
      } else {
        // Legacy fallback or just execute file directly
         command = `"${item.resourceUri.fsPath}"`;
      }

      if (args) {
          command += ` ${args}`;
      }

      const task = new vscode.Task(
        { type: 'shell', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'shell',
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
      // Use the workspace root (first workspace folder) as the default cwd so we prefer the workspace-local gulp installation
      const defaultWorkspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
      const gulpCwd = defaultWorkspaceRoot || cwd;

      // If the gulpfile is not located in the cwd, ensure we pass it explicitly right after 'gulp'
      if (resourceUri && path.dirname(resourceUri.fsPath) !== gulpCwd) {
        gulpArgs = ['gulp', '--gulpfile', resourceUri.fsPath];
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
    case 'github-actions': {
      let actPath = vscode.workspace.getConfiguration('workspaceTasks').get<string>('applicationPath.act') || 'act';
      // if the path is relative, set the working directory to the root of the workspace.
      let actCwd = cwd;
      if (!path.isAbsolute(actPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          actPath = path.join(workspaceFolders[0].uri.fsPath, actPath);
          actCwd = workspaceFolders[0].uri.fsPath;
        }
      }

      if (process.platform === 'win32' && actPath.endsWith('act')) {
        // On Windows, if user specified 'act' without .exe, append it
        if (!actPath.toLowerCase().endsWith('.exe')) {
          // Check if act.exe exists in the same directory
          const actExePath = actPath + '.exe';
          actPath = actExePath;
        }
      }


      const meta = item.metadata;
      const actArgs: string[] = [];
      const config = vscode.workspace.getConfiguration('workspaceTasks');
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);


      // this should be the first argument.
      if (meta?.type === 'workflow') {
        if (meta.event === 'workflow_dispatch' && meta.inputs) {
          const inputsObj = meta.inputs as Record<string, any>;
          // Handle both old string[] interface (fallback) and new Record interface
          if (Array.isArray(inputsObj)) {
            for (const input of inputsObj) {
              const val = await vscode.window.showInputBox({
                prompt: `Enter input for '${input}'`,
                placeHolder: 'Value',
                ignoreFocusOut: true
              });
              if (val) {
                actArgs.push('--input', `${input}=${val}`);
              }
            }
          } else {
            for (const [key, details] of Object.entries(inputsObj)) {
              const desc = details.description || `Enter value for ${key}`;
              const defaultVal = details.default !== undefined ? String(details.default) : '';
              const required = details.required || false;
              // type: string, boolean, choice, environment, ...
              // For now treat all as string input

              const val = await vscode.window.showInputBox({
                prompt: desc,
                placeHolder: `${key} (${details.type || 'string'})`,
                value: defaultVal,
                ignoreFocusOut: true,
                validateInput: (text) => {
                  if (required && !text) {
                    return "This input is required";
                  }
                  return null;
                }
              });

              if (val) {
                actArgs.push('--input', `${key}=${val}`);
              }
            }
          }
          actArgs.push('workflow_dispatch');
        } else {
          actArgs.push(meta.event || 'push');
        }

        // Handle Env File
        let envFile = config.get<string>('act.envFile');
        if (envFile) {
          actArgs.push('--env-file', envFile as string);
        }

        // Handle Variables File
        let varsFile = config.get<string>('act.variablesFile');
        if (varsFile) {
          actArgs.push('--var-file', varsFile as string);
        }

        // Handle Secrets File
        let secretsFile = config.get<string>('act.secretsFile');
        if (secretsFile) {
          actArgs.push('--secret-file', secretsFile as string);
        }

        // Handle Variables
        const vars = config.get<Record<string, string>>('act.variables');
        if (vars) {
          for (const [key, value] of Object.entries(vars)) {
            actArgs.push('--var', `${key}=${value}`);
          }
        }

        const wf = vscode.workspace.getWorkspaceFolder(resourceUri);
        if (wf) {
          const relPath = path.relative(wf.uri.fsPath, resourceUri.fsPath);
          actArgs.push('-W', relPath);
        } else {
          actArgs.push('-W', resourceUri.fsPath);
        }

      } else if (meta?.type === 'job') {
        actArgs.push('-j', meta.jobId);
        const wf = vscode.workspace.getWorkspaceFolder(resourceUri);
        if (wf) {
          const relPath = path.relative(wf.uri.fsPath, resourceUri.fsPath);
          actArgs.push('-W', relPath);
        }
      } else {
        actArgs.push('push');
        const wf = vscode.workspace.getWorkspaceFolder(resourceUri);
        if (wf) {
          const relPath = path.relative(wf.uri.fsPath, resourceUri.fsPath);
          actArgs.push('-W', relPath);
        }
      }

      if (args) {
        actArgs.push(...args.split(' '));
      }

      const task = new vscode.Task(
        { type: 'github-actions', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'github-actions',
        new vscode.ShellExecution(actPath, actArgs, { cwd: actCwd })
      );
      // Reconstruct command string for display/logging purposes mostly
      const safeCmd = /\s/.test(actPath) ? `"${actPath}"` : actPath;
      const full = `${safeCmd} ${actArgs.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')}`;

      return { task, command: full, cwd: actCwd };
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
    case 'pipenv': {
      const full = `pipenv run ${taskLabel} ${args || ''}`.trim();
      const task = new vscode.Task(
        { type: 'pipenv', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'pipenv',
        new vscode.ShellExecution(full, { cwd })
      );
      return { task, command: full, cwd };
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
      const justProvider = new JustfileTaskProvider();
      const { command: justCommand, cwd: justCwd } = justProvider.getCommand(resourceUri);

      const safeCommand = justCommand.includes(' ') ? `"${justCommand}"` : justCommand;
      const fullCmd = `${safeCommand} "${taskLabel}" ${args || ''}`.trim();

      const task = new vscode.Task(
        { type: 'justfile', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'just',
        new vscode.ShellExecution(fullCmd, { cwd: justCwd })
      );
      return { task, command: fullCmd, cwd: justCwd };
    }
    default: {
      // Generic: run as shell command if workspace has a declared task
      return undefined;
    }
  }
}
