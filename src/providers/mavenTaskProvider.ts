import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class MavenTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('maven', constants.GLOB_MAVEN);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    // Use the glob constant for maven
    const mavenFiles = await filesService.findFiles([constants.GLOB_MAVEN]);

    // Standard Maven lifecycle phases
    const standardGoals = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'deploy'];

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    for (const file of mavenFiles) {
      try {
        const fileStat = await vscode.workspace.fs.stat(file);
        if (fileStat.size > 1024 * 1024) {
          // Ignore large files
          continue;
        }

        const content = await vscode.workspace.fs.readFile(file);
        const xmlString = new TextDecoder().decode(content);
        const xmlData = parser.parse(xmlString);

        // Basic validation for pom.xml
        if (!this.isMavenPom(xmlData)) {
          continue;
        }

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'pom.xml'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);

        // Create tasks for each standard goal
        for (const goal of standardGoals) {
          const item = new TaskItem(goal, vscode.TreeItemCollapsibleState.None, this.type, file, undefined, iconPath);

          item.taskFileUri = file;
          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0],
          };
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = `Run mvn ${goal}`;

          tasks.push(item);
        }
      } catch (error) {
        this.logger.error(`[MavenTaskProvider] Failed to parse ${file.fsPath}: ${error}`);
        continue;
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
    return execService.getCommand(
      {
        configKey: 'applicationPath.maven',
        defaultValue: 'mvn',
        configName: 'mvn',
        windowsExecutableExtension: '.cmd',
      },
      workspaceUri,
    );
  }

  private isMavenPom(xmlData: any): boolean {
    // Basic check for project root element
    if (!xmlData.project) {
      return false;
    }
    // Could add more checks like modelVersion etc.
    return true;
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: mvnCmd, args: mvnInitialArgs, cwd: mvnCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const mvnArgs = mvnInitialArgs ? [...mvnInitialArgs] : [];
    mvnArgs.push(taskLabel, ...splitArgs(args));

    const full = `${mvnCmd} ${mvnArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(mvnCmd, mvnArgs, { cwd: mvnCwd });
    const task = new vscode.Task(
      { type: 'maven', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'maven',
      shellExec,
    );
    return { task, command: full, cwd: mvnCwd, native: false };
  }
}
