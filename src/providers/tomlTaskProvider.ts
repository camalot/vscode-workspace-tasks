import * as vscode from 'vscode';
import { parse } from 'smol-toml';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableResult } from '../services/executableService';

export abstract class TomlTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor(type: string, pattern?: string) {
    super(type, pattern);
  }

  protected abstract getGlobPatterns(): string[];
  protected abstract getScriptsPath(): string;
  public abstract getCommand(workspaceUri?: vscode.Uri): ExecutableResult;

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles(this.getGlobPatterns());

    // Parse using the statically imported parser
    let parseFunc: ((s: string) => any) | undefined = parse;

    for (const file of files) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const textContent = new TextDecoder().decode(content);
        let tomlObj: any;
        try {
          tomlObj = parseFunc(textContent);
        } catch (e) {
          console.warn(`Error parsing TOML file ${file.fsPath}:`, e);
          continue;
        }

        const scripts = this.resolveScripts(tomlObj, this.getScriptsPath());

        if (!scripts || typeof scripts !== 'object') {
          continue;
        }

        const iconPath = iconService.getTaskIcon(this.type);

        for (const [name, script] of Object.entries(scripts)) {
          // In simple cases, script is the command string
          // We can support object if needed, but for now specific command string
          const command = typeof script === 'string' ? script : JSON.stringify(script);

          const item = new TaskItem(name, vscode.TreeItemCollapsibleState.None, this.type, file, undefined, iconPath);

          item.taskFileUri = file;
          item.description = vscode.workspace.asRelativePath(file);
          item.tooltip = `${name}: ${command}`;

          item.startLine = this.findScriptLine(textContent, name);

          item.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [file, item.startLine || 0],
          };

          tasks.push(item);
        }
      } catch (err) {
        console.warn(`Error processing file ${file.fsPath}:`, err);
      }
    }
    return tasks;
  }

  private resolveScripts(obj: any, path: string): any {
    const parts = path.split('.');
    let scopes: any[] = [obj];

    for (const part of parts) {
      const nextScopes: any[] = [];
      for (const scope of scopes) {
        if (scope === undefined || scope === null || typeof scope !== 'object') {
          continue;
        }

        if (part === '*') {
          // Add all values of current object
          for (const key of Object.keys(scope)) {
            if (Object.prototype.hasOwnProperty.call(scope, key)) {
              nextScopes.push(scope[key]);
            }
          }
        } else {
          if (Object.prototype.hasOwnProperty.call(scope, part)) {
            nextScopes.push(scope[part]);
          }
        }
      }
      scopes = nextScopes;
    }

    // Merge results
    if (scopes.length === 0) {
      return undefined;
    }

    const result: any = {};
    for (const s of scopes) {
      if (s && typeof s === 'object') {
        Object.assign(result, s);
      }
    }

    // If result is empty but we expected something?
    // If we found nothing valid, result might be empty.
    return result;
  }

  private findScriptLine(content: string, scriptName: string): number {
    // Naive implementation: find "scriptName =" or "[scriptName]" if it was table
    // Since TOML format varies, strictly matching `key =` is decent heuristic for config files
    // We can improve this if needed by parsing tokens but smol-toml doesn't expose location info easily
    const lines = content.split('\n');
    const regex = new RegExp(`^\\s*("|')?${scriptName}("|')?\\s*=`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        return i;
      }
    }
    return 0;
  }
}
