import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { TaskItem } from "../taskItem";
import { BaseTaskProvider, TaskProvider } from "../taskProvider";
import constants from '../libs/constants';
import { TaskIconService } from "../services/taskIconService";
import { TaskFilesService } from "../services/taskFilesService";
import { ExecutableService, ExecutableResult } from "../services/executableService";

export class MsBuildTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
        super('msbuild', constants.GLOB_MSBUILD);
  }
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const iconService = TaskIconService.getInstance();
    const filesService = TaskFilesService.getInstance();

    const tasks: TaskItem[] = [];
    const buildFiles = await filesService.findFiles([constants.GLOB_MSBUILD]);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => {
        return name === 'Target';
      }
    });

    for (const file of buildFiles) {
      try {
        const fileStat = await vscode.workspace.fs.stat(file);
        if (fileStat.size > 1024 * 1024) { // Ignore files larger than 1MB
          continue;
        }

        const iconUri = iconService.getTaskTypeIcon(this.type, file);
        const content = await vscode.workspace.fs.readFile(file);
        const xmlString = new TextDecoder().decode(content);
        const xmlData = parser.parse(xmlString);

        if (!xmlData.Project) {
          continue;
        }

        const targets = this.extractTargets(xmlData);

        for (const target of targets) {
          const item = new TaskItem(
            target.name,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            iconUri?.DisplayUri || file,
            undefined,
            iconUri?.TaskIcon || undefined
          );

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = target.description || target.name;

          // need to find the startline
          item.startLine = this.findTargetStartLine(xmlString, target.name);

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, item.startLine || 0]
          };

          tasks.push(item);
        }
      } catch (err) {
        console.warn(`Error parsing MSBuild file ${file.fsPath}:`, err);
      }
    }

    return tasks;
  }

  private extractTargets(xmlData: any): { name: string, description?: string }[] {
    const targets: { name: string, description?: string }[] = [];

    if (xmlData.Project && xmlData.Project.Target) {
      const targetNodes = Array.isArray(xmlData.Project.Target)
        ? xmlData.Project.Target
        : [xmlData.Project.Target];

      for (const target of targetNodes) {
        const name = target['@_Name'];
        // Ignore private targets (conventionally starting with _) or missing names
        if (!name || name.startsWith('_')) {
          continue;
        }

        targets.push({
          name: name,
          description: target['@_Description'] || target['@_DependsOnTargets']
        });
      }
    }

    return targets;
  }

  private findTargetStartLine(xmlContent: string, targetName: string): number {
    const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<Target\\s+(?:[^>]*?\\s+)?Name=["']${escapedName}["']`, 'i');

    const match = regex.exec(xmlContent);
    if (match) {
      const matchIndex = match.index;
      const subString = xmlContent.substring(0, matchIndex);
      return subString.split('\n').length - 1;
    }
    return 0;
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      configKey: 'applicationPath.msbuild',
      defaultValue: 'MSBuild.exe',
      configName: 'msbuild',
      resolveToAbsolutePath: false,
      windowsExecutableExtension: '.exe',
      windowsEnforceExtension: true
    }, workspaceUri);
  }

  public getCommandArgs(targetName: string, buildFile: string): string[] {
    // MSBuild <project_file> -t:<target_name>
    const args: string[] = [];

    args.push(buildFile);
    args.push(`-t:${targetName}`);

    return args;
  }
}
