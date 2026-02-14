import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as vscode from 'vscode';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { parse } from 'smol-toml';

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

        // Check [project.scripts] first (PEP 621 standard, preferred)
        let scripts = tomlObj?.project?.scripts;
        let scriptsPath = 'project.scripts';

        // Fall back to [tool.poetry.scripts] for backward compatibility
        if (!scripts || typeof scripts !== 'object') {
          scripts = tomlObj?.tool?.poetry?.scripts;
          scriptsPath = 'tool.poetry.scripts';
        }

        if (!scripts || typeof scripts !== 'object') {
          continue;
        }

        const iconPath = iconService.getTaskIcon(this.type);

        for (const [name, script] of Object.entries(scripts)) {
          const command = typeof script === 'string' ? script : JSON.stringify(script);

          const item = new TaskItem(name, vscode.TreeItemCollapsibleState.None, this.type, file, undefined, iconPath);

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = `${name}: ${command}`;

          // Find the line number in the file
          item.startLine = this.findScriptLineInContent(textContent, name, scriptsPath);

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
        return i + 1; // 1-based line number
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
}
