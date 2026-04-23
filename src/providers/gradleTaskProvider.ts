import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import * as path from 'path';
import * as fs from 'fs';
import constants from '../libs/constants';
import { configuration } from '../libs/configuration';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class GradleTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('gradle', constants.GLOB_GRADLE);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_GRADLE]);

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'build.gradle'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);

        const lines = content.split('\n');

        // Matches "task name" or "task name(type: ...)"
        // But NOT inside comments.
        // We'll iterate lines to be safely ignorant of comments.
        const taskRegex = /^\s*task\s+([^\s({]+)/;

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          // Strip single line comments
          const commentIndex = line.indexOf('//');
          if (commentIndex !== -1) {
            line = line.substring(0, commentIndex);
          }

          const match = taskRegex.exec(line);
          if (match) {
            const taskName = match[1];
            const item = new TaskItem(
              taskName,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              file,
              undefined,
              iconPath,
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0],
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`[GradleTaskProvider] Error parsing gradle file: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();

    const result = execService.getCommand(
      {
        configKey: 'applicationPath.gradle',
        defaultValue: 'gradle',
        configName: 'gradle',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.bat',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );

    // If user did not configure a gradle path, prefer the workspace's gradlew wrapper when present
    const configured = configuration.get<string>('applicationPath.gradle');
    if (!configured && workspaceUri) {
      const gradlew = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
      const gradlewPath = path.join(workspaceUri.fsPath, gradlew);
      if (fs.existsSync(gradlewPath)) {
        return { command: gradlewPath, args: [], cwd: workspaceUri.fsPath };
      }
    }

    return result;
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: gradleCmd, args: gradleInitialArgs, cwd: gradleCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const gradleArgs = gradleInitialArgs ? [...gradleInitialArgs] : [];
    gradleArgs.push(taskLabel, ...splitArgs(args));

    const full = `${gradleCmd} ${gradleArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(gradleCmd, gradleArgs, { cwd: gradleCwd });
    const task = new vscode.Task(
      { type: 'gradle', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'gradle',
      shellExec,
    );
    return { task, command: full, cwd: gradleCwd, native: false };
  }
}
