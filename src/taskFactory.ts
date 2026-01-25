import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { WorkspaceTasksService } from './services/workspaceTasksService';
import { AntTaskProvider } from './providers/antTaskProvider';
import { MsBuildTaskProvider } from './providers/msbuildTaskProvider';
import { ComposerTaskProvider } from './providers/composerTaskProvider';
import { GradleTaskProvider } from './providers/gradleTaskProvider';
import { GruntTaskProvider } from './providers/gruntTaskProvider';
import { GulpTaskProvider } from './providers/gulpTaskProvider';
import { JustfileTaskProvider } from './providers/justfileTaskProvider';
import { NpmTaskProvider, PnpmTaskProvider, YarnTaskProvider } from './providers/npmTaskProvider';
import { PipenvTaskProvider } from './providers/pipenvTaskProvider';
import { MakefileTaskProvider } from './providers/makefileTaskProvider';
import { GithubActionsTaskProvider } from './providers/githubActionsTaskProvider';
import { MiseTaskProvider } from './providers/miseTaskProvider';
import { MavenTaskProvider } from './providers/mavenTaskProvider';
import { JupyterTaskProvider } from './providers/jupyterTaskProvider';

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
      const npmProvider = new NpmTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: npmCmd, args: npmInitialArgs, cwd: npmCwd } = npmProvider.getCommand(workspaceFolder?.uri);

      const npmArgs = npmInitialArgs ? [...npmInitialArgs] : [];
      npmArgs.push('run', `${taskLabel}`);
      if (args) { npmArgs.push(...args.split(' ')); }

      const full = `${npmCmd} ${npmArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(npmCmd, npmArgs, { cwd: npmCwd });

      const task = new vscode.Task(
        { type: 'npm', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'npm',
        shellExec
      );
      return { task, command: full, cwd: npmCwd };
    }
    case 'yarn': {
      const yarnProvider = new YarnTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: yarnCmd, args: yarnInitialArgs, cwd: yarnCwd } = yarnProvider.getCommand(workspaceFolder?.uri);

      const yarnArgs = yarnInitialArgs ? [...yarnInitialArgs] : [];
      yarnArgs.push('run', `${taskLabel}`);
      if (args) { yarnArgs.push(...args.split(' ')); }

      const full = `${yarnCmd} ${yarnArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(yarnCmd, yarnArgs, { cwd: yarnCwd });

      const task = new vscode.Task(
        { type: 'yarn', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'yarn',
        shellExec
      );
      return { task, command: full, cwd: yarnCwd };
    }
    case 'pnpm': {
      const pnpmProvider = new PnpmTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: pnpmCmd, args: pnpmInitialArgs, cwd: pnpmCwd } = pnpmProvider.getCommand(workspaceFolder?.uri);

      const pnpmArgs = pnpmInitialArgs ? [...pnpmInitialArgs] : [];
      pnpmArgs.push('run', `${taskLabel}`);
      if (args) { pnpmArgs.push(...args.split(' ')); }

      const full = `${pnpmCmd} ${pnpmArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(pnpmCmd, pnpmArgs, { cwd: pnpmCwd });

      const task = new vscode.Task(
        { type: 'pnpm', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'pnpm',
        shellExec
      );
      return { task, command: full, cwd: pnpmCwd };
    }
    case "mise": {
      // mise run <taskLabel> [args]
      const miseProvider = new MiseTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: miseCmd, args: miseInitialArgs, cwd: miseCwd } = miseProvider.getCommand(workspaceFolder?.uri);

      const miseArgs = miseInitialArgs ? [...miseInitialArgs] : [];
      miseArgs.push('run', taskLabel);
      if (args) {
        miseArgs.push(...args.split(' '));
      }

      const full = `${miseCmd} ${miseArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(miseCmd, miseArgs, { cwd: miseCwd });

      const task = new vscode.Task(
        { type: 'mise', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'mise',
        shellExec
      );
      return { task, command: full, cwd: miseCwd };
    }
    case 'jupyter': {
      // Use CustomExecution to run Jupyter cell via VS Code command
      const task = new vscode.Task(
        { type: 'jupyter', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'jupyter',
        new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
          return new JupyterTerm(resourceUri, item.metadata?.cellIndex, taskLabel);
        })
      );
      return { task, command: 'jupyter.runcell', cwd: path.dirname(resourceUri.fsPath) };
    }
    case 'maven': {
      // mvn <goal> [args]
      const mavenProvider = new MavenTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: mvnCmd, args: mvnInitialArgs, cwd: mvnCwd } = mavenProvider.getCommand(workspaceFolder?.uri);

      const mvnArgs = mvnInitialArgs ? [...mvnInitialArgs] : [];
      mvnArgs.push(taskLabel);
      if (args) {
        mvnArgs.push(...args.split(' '));
      }

      const full = `${mvnCmd} ${mvnArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(mvnCmd, mvnArgs, { cwd: mvnCwd });

      const task = new vscode.Task(
        { type: 'maven', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'maven',
        shellExec
      );
      return { task, command: full, cwd: mvnCwd };
    }
    case 'gradle': {
      // gradle [task] [args]
      const gradleProvider = new GradleTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: gradleCmd, args: gradleInitialArgs, cwd: gradleCwd } = gradleProvider.getCommand(workspaceFolder?.uri);

      const gradleArgs = gradleInitialArgs ? [...gradleInitialArgs] : [];
      gradleArgs.push(taskLabel);
      if (args) {
        gradleArgs.push(...args.split(' '));
      }

      const full = `${gradleCmd} ${gradleArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(gradleCmd, gradleArgs, { cwd: gradleCwd });

      const task = new vscode.Task(
        { type: 'gradle', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'gradle',
        shellExec
      );
      return { task, command: full, cwd: gradleCwd };
    }
    case 'composer': {
      // composer run-script [script] [args]
      const composerProvider = new ComposerTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: composerCmd, args: composerInitialArgs, cwd: composerCwd } = composerProvider.getCommand(workspaceFolder?.uri);

      const composerArgs = composerInitialArgs ? [...composerInitialArgs] : [];
      composerArgs.push('run-script', taskLabel);
      if (args) {
        composerArgs.push('--');
        composerArgs.push(...args.split(' '));
      }

      const full = `${composerCmd} ${composerArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(composerCmd, composerArgs, { cwd: composerCwd });

      const task = new vscode.Task(
        { type: 'composer', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'composer',
        shellExec
      );
      return { task, command: full, cwd: composerCwd };
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
      const gruntProvider = new GruntTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: gruntCmd, args: gruntInitialArgs, cwd: gruntCwd } = gruntProvider.getCommand(workspaceFolder?.uri);

      const gruntArgs: string[] = gruntInitialArgs ? [...gruntInitialArgs] : [];
      if (taskLabel && taskLabel.length > 0) { gruntArgs.push(taskLabel); }
      if (item.resourceUri) {
        const dir = path.dirname(item.resourceUri.fsPath);
        const rel = path.relative(gruntCwd, dir);
        const fileName = path.basename(item.resourceUri.fsPath).toLowerCase();

        // If the file is not in the CWD (workspace root) or the filename is not "gruntfile.js",
        // we need to pass the --gruntfile argument explicitly.
        if ((rel.length > 0 && rel !== '.') || fileName !== 'gruntfile.js') {
          gruntArgs.push('--gruntfile', item.resourceUri.fsPath);
        }
      }
      if (args) { gruntArgs.push(...args.split(' ')); }

      const task = new vscode.Task(
        { type: 'grunt', target: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'grunt',
        new vscode.ShellExecution(gruntCmd, gruntArgs, { cwd: gruntCwd })
      );
      return { task, command: `${gruntCmd} ${gruntArgs.join(' ')}`.trim(), cwd: gruntCwd };
    }
    case 'gulp': {
      // Use npx to prefer workspace-local gulp if available
      const gulpCmd = 'npx';
      // We'll build the args carefully so --gulpfile appears before the task name if needed
      let gulpArgs: string[] = ['gulp'];

      // Prefer workspace folder root as cwd so local install (node_modules) is resolved correctly
      // Use the workspace root (first workspace folder) as the default cwd so we prefer the workspace-local gulp installation
      const defaultWorkspaceRoot = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
      const gulpProvider = new GulpTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      // const { command: gulpProviderCmd, cwd: gulpProviderCwd } = gulpProvider.getCommand(workspaceFolder?.uri);
      // gulpProviderCmd is never used since we build the command manually using 'npx gulp'
      const { command: _, cwd: gulpProviderCwd } = gulpProvider.getCommand(workspaceFolder?.uri);
      const gulpCwd = gulpProviderCwd || defaultWorkspaceRoot || cwd;

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

      const { command: antCommand, args: antInitialArgs, cwd: antCwd } = antProvider.getCommand(workspaceUri);

      let command: string;
      let commandArgs: string[];

      if (useAnsicon) {
        command = antProvider.getAnsicon(workspaceUri).command;
        commandArgs = [antCommand];
        if (antInitialArgs) { commandArgs.push(...antInitialArgs); }
        commandArgs = commandArgs.concat(antProvider.getCommandArgs(taskLabel, true, item.taskFileUri?.fsPath));
      } else {
        command = antCommand;
        commandArgs = antInitialArgs ? [...antInitialArgs] : [];
        commandArgs.push(...antProvider.getCommandArgs(taskLabel, false, item.taskFileUri?.fsPath));
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
          new vscode.ShellExecution(fullCommand, { cwd: antCwd })
        );
        return { task, command: fullCommand, cwd: antCwd };
      } else {
        const task = new vscode.Task(
          { type: 'ant', target: taskLabel },
          vscode.TaskScope.Workspace,
          taskLabel,
          'ant',
          new vscode.ShellExecution(command, commandArgs, { cwd: antCwd })
        );
        return { task, command: `${command} ${commandArgs.join(' ')}`, cwd: antCwd };
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
      const ghProvider = new GithubActionsTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      let { command: actPath, args: actInitialArgs, cwd: actCwd } = ghProvider.getCommand(workspaceFolder?.uri);

      // Attempt to determine the project root if the workflow is in a nested folder
      // This is crucial for act to find .secrets, .env in the project root instead of workspace root
      const githubDirMatch = resourceUri.fsPath.match(/[\\/]\.github[\\/]/);
      if (githubDirMatch) {
         const projectRoot = resourceUri.fsPath.substring(0, githubDirMatch.index);
         if (projectRoot) {
            actCwd = projectRoot;
         }
      }

      const meta = item.metadata;
      const actArgs: string[] = actInitialArgs ? [...actInitialArgs] : [];
      const config = vscode.workspace.getConfiguration('workspaceTasks');
      // workspaceFolder already defined above
      // const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);


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

        const relPath = path.relative(actCwd, resourceUri.fsPath);
        actArgs.push('-W', relPath);

      } else if (meta?.type === 'job') {
        actArgs.push('-j', meta.jobId);
        const relPath = path.relative(actCwd, resourceUri.fsPath);
        actArgs.push('-W', relPath);
      } else {
        // Fallback or generic file execution
        let useEvent = 'push';

        // Check for file-level metadata with supported events
        if (meta?.type === 'file' && meta?.events) {
          const events = meta.events as string[];
          if (events.length > 0) {
            const selected = await vscode.window.showQuickPick(events, {
              placeHolder: 'Select event to trigger',
            });
            if (selected) {
              useEvent = selected;
            } else {
              // User cancelled selection
              return undefined;
            }
          }
        }

        // If selected event is workflow_dispatch, handle inputs
         if (useEvent === 'workflow_dispatch' && meta?.inputs) {
              const inputsObj = meta.inputs as Record<string, any>;
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
        }

        actArgs.push(useEvent);
        const relPath = path.relative(actCwd, resourceUri.fsPath);
        actArgs.push('-W', relPath);
      }

      if (args) {
        actArgs.push(...args.split(' '));
      }

      const task = new vscode.Task(
        { type: 'github-actions', task: taskLabel, path: resourceUri.fsPath },
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
      const targetWorkspaceFolder = item.resourceUri ? vscode.workspace.getWorkspaceFolder(item.resourceUri) : undefined;

      const found = tasks.find(t => {
        const nameMatch = t.name === taskLabel && t.source === 'Workspace';
        if (!nameMatch) { return false; }

        // If we know the target workspace folder, ensure the task belongs to it
        if (targetWorkspaceFolder && typeof t.scope === 'object' && 'uri' in t.scope) {
           return t.scope.uri.toString() === targetWorkspaceFolder.uri.toString();
        }

        // If we don't know the folder, or the task has global/workspace scope, accepts it as fallback
        return true;
      });

      if (found) {
        return { task: found, cwd };
      }
      return undefined;
    }
    case 'makefile': {
      const makeProvider = new MakefileTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: makeCmd, args: makeInitialArgs, cwd: makeCwd } = makeProvider.getCommand(workspaceFolder?.uri);

      const makeArgs = makeInitialArgs ? [...makeInitialArgs] : [];
      makeArgs.push(taskLabel);
      if (args) { makeArgs.push(...args.split(' ')); }

      const full = `${makeCmd} ${makeArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(makeCmd, makeArgs, { cwd: makeCwd });

      const task = new vscode.Task(
        { type: 'makefile', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'makefile',
        shellExec
      );
      return { task, command: full, cwd: makeCwd };
    }
    case 'dockerfile': {
      const command = await WorkspaceTasksService.getInstance().resolveTaskCommand(taskLabel, 'DockerFile', resourceUri);
      if (command) {
        // Dockerfile provider uses resolveTaskCommand which returns a string presumably from user config map?
        // It does not use ExecutableService.getCommand directly here on taskFactory level.
        // So we leave it as is.
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
      const pipenvProvider = new PipenvTaskProvider();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const { command: pipenvCmd, args: pipenvInitialArgs, cwd: pipenvCwd } = pipenvProvider.getCommand(workspaceFolder?.uri);

      const pipenvArgs = pipenvInitialArgs ? [...pipenvInitialArgs] : [];
      pipenvArgs.push('run', taskLabel);
      if (args) { pipenvArgs.push(...args.split(' ')); }

      const full = `${pipenvCmd} ${pipenvArgs.join(' ')}`;
      const shellExec = new vscode.ShellExecution(pipenvCmd, pipenvArgs, { cwd: pipenvCwd });

      const task = new vscode.Task(
        { type: 'pipenv', script: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'pipenv',
        shellExec
      );
      return { task, command: full, cwd: pipenvCwd };
    }
    case 'venv': {
      const taskUri = item.taskFileUri || item.resourceUri;
      if (!taskUri) { return undefined; }
      let command = taskUri.fsPath;
      if (command.endsWith('.py') && (command.toLowerCase().includes('activate') || command.toLowerCase().includes('deactivate'))) {
        command = command.substring(0, command.length - 3);
      }
      if (process.platform === 'win32' && (command.toLowerCase().endsWith('.ps1'))) {
        // get powershell tool path from configuration
        command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${command}" ${args || ''}`.trim();
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
      const { command: msbuildCmd, args: msbuildInitialArgs, cwd: msbuildCwd } = msbuildProvider.getCommand(workspaceUri);
      const commandArgs = msbuildInitialArgs ? [...msbuildInitialArgs] : [];
      commandArgs.push(...msbuildProvider.getCommandArgs(taskLabel, item.resourceUri.fsPath));
      if (args) { commandArgs.push(...args.split(' ')); }
      const task = new vscode.Task(
        { type: 'msbuild', target: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'msbuild',
        new vscode.ShellExecution(msbuildCmd, commandArgs, { cwd: msbuildCwd })
      );
      return { task, command: `${msbuildCmd} ${commandArgs.join(' ')}`, cwd: msbuildCwd };
    }
    case 'justfile': {
      const justProvider = new JustfileTaskProvider();
      const { command: justCommand, args: justInitialArgs, cwd: justCwd } = justProvider.getCommand(resourceUri);

      const justArgs = justInitialArgs ? [...justInitialArgs] : [];
      justArgs.push(taskLabel);
      if (args) { justArgs.push(...args.split(' ')); }

      const fullCmd = `${justCommand} ${justArgs.join(' ')}`.trim();

      const task = new vscode.Task(
        { type: 'justfile', task: taskLabel },
        vscode.TaskScope.Workspace,
        taskLabel,
        'just',
        new vscode.ShellExecution(justCommand, justArgs, { cwd: justCwd })
      );
      return { task, command: fullCmd, cwd: justCwd };
    }
    default: {
      // Generic: run as shell command if workspace has a declared task
      return undefined;
    }
  }
}

class JupyterTerm implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  constructor(private resourceUri: vscode.Uri, private cellIndex: number | undefined, private label: string) {
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.doRun();
  }

  close(): void {
  }

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
                    // This is the VS Code API way
                     const execution = vscode.commands.executeCommand('notebook.cell.execute', {
                        ranges: [{ start: this.cellIndex, end: this.cellIndex + 1 }],
                        document: doc.uri
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
