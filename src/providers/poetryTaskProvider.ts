import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { parse } from 'smol-toml';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

export class PoetryTaskProvider extends TomlTaskProvider {
  constructor() {
    super('poetry', constants.GLOB_POETRY);
  }

  protected getGlobPatterns(): string[] {
    return [constants.GLOB_POETRY];
  }

  protected getScriptsPath(): string[] {
    // For backward compatibility - though we override getTasks() to check both locations
    return ['project.scripts', 'tool.poetry.scripts'];
  }

  // Override getTasks to support both [project.scripts] (preferred, PEP 621)
  // and [tool.poetry.scripts] (deprecated but still supported for backward compatibility)
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles(this.getGlobPatterns());

    for (const file of files) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const textContent = new TextDecoder().decode(content);
        let tomlObj: any;

        try {
          tomlObj = parse(textContent);
        } catch (e) {
          this.logger.warn(`[PoetryTaskProvider] Error parsing TOML file ${file.fsPath}:`, e);
          continue;
        }

        const scripts: Record<string, unknown> = {};
        const projectScripts = tomlObj?.project?.scripts;
        const legacyScripts = tomlObj?.tool?.poetry?.scripts;

        if (projectScripts && typeof projectScripts === 'object') {
          Object.assign(scripts, projectScripts);
        }

        if (legacyScripts && typeof legacyScripts === 'object') {
          for (const [name, script] of Object.entries(legacyScripts)) {
            if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
              scripts[name] = script;
            }
          }
        }

        if (Object.keys(scripts).length === 0) {
          continue;
        }

        const iconPath = iconService.getTaskIcon(this.type);

        const projectScriptNames = new Set(projectScripts && typeof projectScripts === 'object' ? Object.keys(projectScripts) : []);

        for (const [name, script] of Object.entries(scripts)) {
          const command = typeof script === 'string' ? script : JSON.stringify(script);
          const section = projectScriptNames.has(name) ? 'project.scripts' : 'tool.poetry.scripts';

          const item = new TaskItem(name, vscode.TreeItemCollapsibleState.None, this.type, file, undefined, iconPath);

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = `${name}: ${command}`;

          // Find the line number in the file
          item.startLine = this.findScriptLineInContent(textContent, name, section);

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, item.startLine || 0],
          };

          tasks.push(item);
        }
      } catch (err) {
        this.logger.warn(`[PoetryTaskProvider] Error processing file ${file.fsPath}:`, err);
      }
    }
    return tasks;
  }

  private findScriptLineInContent(content: string, scriptName: string, section: string): number {
    const lines = content.split('\n');
    let inSection = false;
    const sectionHeader = `[${section}]`;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if we're entering the scripts section
      if (line === sectionHeader) {
        inSection = true;
        continue;
      }

      // Check if we've left the section (new section starts)
      if (inSection && line.startsWith('[') && line.endsWith(']')) {
        break;
      }

      // Look for the script name in the section
      if (inSection && line.startsWith(`${scriptName} =`)) {
        return i; // 0-based line number
      }
    }

    return 0;
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
        configKey: 'applicationPath.poetry',
        defaultValue: 'poetry',
        configName: 'poetry',
        resolveToAbsolutePath: false,
        windowsEnforceExtension: false,
      },
      workspaceUri,
    );
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const { command: poetryCmd, args: poetryInitialArgs, cwd: poetryCwd } = this.getCommand(workspaceFolder?.uri);
    const taskLabel = item.originalLabel || item.label;

    const poetryArgs = poetryInitialArgs ? [...poetryInitialArgs] : [];
    poetryArgs.push('run', taskLabel, ...splitArgs(args));

    const full = `${poetryCmd} ${poetryArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(poetryCmd, poetryArgs, { cwd: poetryCwd });
    const task = new vscode.Task(
      { type: 'poetry', script: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'poetry',
      shellExec,
    );
    return { task, command: full, cwd: poetryCwd, native: false };
  }
}
