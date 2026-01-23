import * as path from "path";
import * as fs from "fs";
import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { configuration } from "../libs/configuration";
import { TaskItem } from "../taskItem";
import { BaseTaskProvider, TaskProvider } from "../taskProvider";
import constants from '../libs/constants';
import { TaskFilesService } from "../services/taskFilesService";
import { TaskIconService } from "../services/taskIconService";

export class AntTaskProvider extends BaseTaskProvider implements TaskProvider {

  constructor() {
    super('ant');
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
      attributeNamePrefix: '@_'
    });

    for (const file of xmlFiles) {
      try {
        const fileStat = await vscode.workspace.fs.stat(file);
        if (fileStat.size > 1024 * 1024) { // Ignore files larger than 1MB
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

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ""), 'build.xml'));
        const iconPath = iconService.getTaskTypeIcon(this.type, fallback);

        for (const target of targets) {
          const item = new TaskItem(
            target.name,
            vscode.TreeItemCollapsibleState.None,
            this.type,
            iconPath?.DisplayUri || file,
            undefined,
            iconPath?.TaskIcon || undefined
          );

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = target.description || target.name;

          item.command = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, 0]
          };

          tasks.push(item);
        }
      } catch (error) {
        // Skip files that aren't valid XML or can't be parsed
        console.debug(`Failed to parse ${file.fsPath}: ${error}`);
        continue;
      }
    }

    return tasks;
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

  private extractTargets(xmlData: any): Array<{ name: string, description?: string }> {
    const targets: Array<{ name: string, description?: string }> = [];
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
          description: target['@_description'] || target['@_depends']
        });
      }
    }

    return targets;
  }

  public getCommandArgs(targetName: string, useAnsicon: boolean = false, buildFilePath?: string): string[] {
    const args: string[] = [];

    // Add logger argument when using ansicon
    if (useAnsicon) {
      args.push("-logger", "org.apache.tools.ant.listener.AnsiColorLogger");
    }

    // Add buildfile argument if provided
    if (buildFilePath) {
      args.push("-buildfile", buildFilePath);
    }

    // Add the target name
    args.push(targetName);

    return args;
  }

  public shouldUseAnsicon(): boolean {
    if (process.platform !== "win32") {
      return false;
    }

    if (!configuration.get<boolean>("ant.ansicon.enabled")) {
      return false;
    }

    const ansiPath: string = configuration.get("ant.ansicon.path") || "";
    if (!ansiPath) {
      return false;
    }

    let ansiconExe = ansiPath;
    // Ensure the path ends with ansicon.exe
    if (!ansiconExe.toLowerCase().endsWith("ansicon.exe")) {
      ansiconExe = path.join(ansiconExe, "ansicon.exe");
    }

    // Check if the ansicon.exe file exists
    try {
      return fs.existsSync(ansiconExe);
    } catch (error) {
      console.debug(`Could not access ansicon at ${ansiconExe}`);
      return false;
    }
  }

  public getAnsiconPath(): string {
    const ansiPath: string = configuration.get("ant.ansicon.path") || "";
    if (!ansiPath) {
      return "ansicon.exe";
    }

    let ansiconExe = ansiPath;
    // Ensure the path ends with ansicon.exe
    if (!ansiconExe.toLowerCase().endsWith("ansicon.exe")) {
      ansiconExe = path.join(ansiconExe, "ansicon.exe");
    }

    return ansiconExe;
  }

  public getCommand(workspaceUri?: vscode.Uri): string {
    const antPath = configuration.get<string>("ant.path");
    if (antPath) {
      let resolvedPath = antPath;

      // If it's a relative path and we have a workspace, resolve it
      if (!path.isAbsolute(antPath) && workspaceUri) {
        const localPath = path.join(workspaceUri.fsPath, antPath);
        if (fs.existsSync(localPath)) {
            resolvedPath = localPath;
        }
      }

      // If it's a full path to an executable file
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        // On Windows, if the file doesn't have .bat or .exe extension, check for .bat version
        if (process.platform === "win32" && !resolvedPath.toLowerCase().endsWith(".bat") && !resolvedPath.toLowerCase().endsWith(".exe")) {
          const batVersion = resolvedPath + ".bat";
          if (fs.existsSync(batVersion)) {
            return batVersion;
          }
        }
        return resolvedPath;
      }

      // If it's a directory, look for the executable
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        const executable = process.platform === "win32" ? "ant.bat" : "ant";

        // Check for bin subdirectory (standard Ant installation structure)
        const binPath = path.join(resolvedPath, "bin", executable);
        if (fs.existsSync(binPath)) {
          return binPath;
        }

        // Check directly in the provided directory
        const directPath = path.join(resolvedPath, executable);
        if (fs.existsSync(directPath)) {
          return directPath;
        }
      }

      // Otherwise assume it's a command name or path
      // For Windows, ensure .bat extension on the resolved path
      if (process.platform === "win32" && !resolvedPath.toLowerCase().endsWith(".bat") && !resolvedPath.toLowerCase().endsWith(".exe")) {
        const result = resolvedPath + ".bat";
        return result;
      }
      return resolvedPath;
    }

    // Default to ant/ant.bat in PATH
    const defaultCmd = process.platform === "win32" ? "ant.bat" : "ant";
    return defaultCmd;
  }
}
