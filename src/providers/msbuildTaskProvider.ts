import * as path from "path";
import * as fs from "fs";
import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { configuration } from "../libs/configuration";
import { TaskItem } from "../taskItem";
import { BaseTaskProvider, TaskProvider } from "../taskProvider";
import constants from '../libs/constants';
import { TaskIconService } from "../services/taskIconService";
import { TaskFilesService } from "../services/taskFilesService";

export class MsBuildTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('msbuild');
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
      isArray: (name, jpath, isLeafNode, isAttribute) => {
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

          item.command = {
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

  public getCommand(workspaceUri?: vscode.Uri): string {
    const msbuildPath = configuration.get<string>("msbuild.path");

    if (msbuildPath) {
      let resolvedPath = msbuildPath;

      // If it's a relative path and we have a workspace, resolve it
      if (!path.isAbsolute(msbuildPath) && workspaceUri) {
         const localPath = path.join(workspaceUri.fsPath, msbuildPath);
         if (fs.existsSync(localPath)) {
            resolvedPath = localPath;
         }
      }

      // If it's a full path to an executable file
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        return resolvedPath;
      }

      // If it's a directory, assume MSBuild.exe inside
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        const exePath = path.join(resolvedPath, 'MSBuild.exe');
        if (fs.existsSync(exePath)) {
          return exePath;
        }
      }

      // Should we check for .exe extension on Windows?
      if (process.platform === 'win32' && !resolvedPath.toLowerCase().endsWith('.exe')) {
        return resolvedPath + '.exe';
      }

      return resolvedPath;
    }

    // Default
    return "MSBuild.exe";
  }

  public getCommandArgs(targetName: string, buildFile: string): string[] {
    // MSBuild <project_file> -t:<target_name>
    const args: string[] = [];

    args.push(buildFile);
    args.push(`-t:${targetName}`);

    return args;
  }
}
