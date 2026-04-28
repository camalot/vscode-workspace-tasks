import * as path from 'path';
import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { configuration } from '../libs/configuration';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class AntTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('ant', constants.GLOB_ANT);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const iconService = TaskIconService.getInstance();

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const xmlFiles = await filesService.findFiles([constants.GLOB_ANT]);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    for (const file of xmlFiles) {
      try {
        const fileStat = await vscode.workspace.fs.stat(file);
        if (fileStat.size > 1024 * 1024) {
          // Ignore files larger than 1MB
          continue;
        }
        const content = await vscode.workspace.fs.readFile(file);
        const xmlString = new TextDecoder().decode(content);
        const xmlData = parser.parse(xmlString);

        // Check if this is an Ant build file
        if (!this.isAntBuildFile(xmlData)) {
          continue;
        }

        // Extract targets from the Ant file
        const targets = this.extractTargets(xmlData);

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'build.xml'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);

        for (const target of targets) {
          const item = new TaskItem(
            target.name,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            file,
            undefined,
            iconPath,
          );

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = target.description || target.name;

          item.startLine = this.findTargetStartLine(xmlString, target.name);

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, item.startLine || 0],
          };

          tasks.push(item);
        }
      } catch (error) {
        // Skip files that aren't valid XML or can't be parsed
        this.logger.debug(`[AntTaskProvider] Failed to XML parse ${file.fsPath}: ${error}`);
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

  private isAntBuildFile(xmlData: any): boolean {
    // Check if the root element is 'project' (standard Ant build file)
    if (!xmlData.project) {
      return false;
    }

    const project = xmlData.project;

    // Ant build files typically have a 'name' attribute and contain 'target' elements
    // Also check for common Ant attributes like 'default' or 'basedir'
    const hasAntAttributes = project['@_name'] || project['@_default'] || project['@_basedir'];
    const hasTargets = project.target !== undefined;

    return hasAntAttributes || hasTargets;
  }

  private extractTargets(xmlData: any): Array<{ name: string; description?: string }> {
    const targets: Array<{ name: string; description?: string }> = [];
    const project = xmlData.project;

    if (!project || !project.target) {
      return targets;
    }

    // Normalize to array (single target might not be in array)
    const targetList = Array.isArray(project.target) ? project.target : [project.target];

    for (const target of targetList) {
      if (target['@_name']) {
        targets.push({
          name: target['@_name'],
          description: target['@_description'] || target['@_depends'],
        });
      }
    }

    return targets;
  }

  private findTargetStartLine(xmlContent: string, targetName: string): number {
    const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<target\\s+(?:[^>]*?\\s+)?name=[\"']${escapedName}[\"']`, 'i');

    const match = regex.exec(xmlContent);
    if (match) {
      const matchIndex = match.index;
      const subString = xmlContent.substring(0, matchIndex);
      return subString.split('\n').length - 1;
    }
    return 0;
  }

  public getCommandArgs(targetName: string, useAnsicon: boolean = false, buildFilePath?: string): string[] {
    const args: string[] = [];

    // Add logger argument when using ansicon
    if (useAnsicon) {
      args.push('-logger', 'org.apache.tools.ant.listener.AnsiColorLogger');
    }

    // Add buildfile argument if provided
    if (buildFilePath) {
      args.push('-buildfile', buildFilePath);
    }

    // Add the target name
    args.push(targetName);

    return args;
  }

  public shouldUseAnsicon(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    if (!configuration.get<boolean>('ant.ansicon.enabled')) {
      this.logger.debug("[AntTaskProvider] Ant ansicon usage is disabled in configuration.");
      return false;
    }

    return true;
  }

  public getAnsicon(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();

    return execService.getCommand(
      {
        configKey: 'applicationPath.ansicon',
        defaultValue: 'ansicon.exe',
        configName: 'ansicon',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();

    return execService.getCommand(
      {
        configKey: 'applicationPath.ant',
        defaultValue: 'ant',
        configName: 'ant',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.bat',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = item.originalLabel || item.label;
    const useAnsicon = this.shouldUseAnsicon();
    const workspaceUri = workspaceFolder?.uri;

    const { command: antCommand, args: antInitialArgs, cwd: antCwd } = this.getCommand(workspaceUri);

    let command: string;
    let commandArgs: string[];

    if (useAnsicon) {
      command = this.getAnsicon(workspaceUri).command;
      commandArgs = [antCommand];
      if (antInitialArgs) {
        commandArgs.push(...antInitialArgs);
      }
      commandArgs = commandArgs.concat(this.getCommandArgs(taskLabel, true, item.taskFileUri?.fsPath));
    } else {
      command = antCommand;
      commandArgs = antInitialArgs ? [...antInitialArgs] : [];
      commandArgs.push(...this.getCommandArgs(taskLabel, false, item.taskFileUri?.fsPath));
    }

    commandArgs.push(...splitArgs(args));

    if (useAnsicon) {
      const ansiconArgs = commandArgs.map((arg) => `"${arg}"`).join(' ');
      const fullCommand = `"${command}" ${ansiconArgs}`;
      const task = new vscode.Task(
        { type: 'ant', target: taskLabel, path: resourceUri.fsPath },
        vscode.TaskScope.Workspace,
        taskLabel,
        'ant',
        new vscode.ShellExecution(fullCommand, { cwd: antCwd }),
      );
      return { task, command: fullCommand, cwd: antCwd, native: false };
    }

    const task = new vscode.Task(
      { type: 'ant', target: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'ant',
      new vscode.ShellExecution(command, commandArgs, { cwd: antCwd }),
    );
    return { task, command: `${command} ${commandArgs.join(' ')}`, cwd: antCwd, native: false };
  }
}
