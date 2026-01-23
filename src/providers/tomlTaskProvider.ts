import * as vscode from 'vscode';
import { parse } from 'smol-toml';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';

export abstract class TomlTaskProvider extends BaseTaskProvider implements TaskProvider {

  constructor(type: string) {
    super(type);
  }

  protected abstract getGlobPatterns(): string[];
  protected abstract getScriptsPath(): string;

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

        const iconUri = iconService.getTaskTypeIcon(this.type, file);

        for (const [name, script] of Object.entries(scripts)) {
             // In simple cases, script is the command string
             // We can support object if needed, but for now specific command string
             const command = typeof script === 'string' ? script : JSON.stringify(script);

             const item = new TaskItem(
                name,
                vscode.TreeItemCollapsibleState.None,
                this.type,
                iconUri?.DisplayUri || file,
                undefined,
                iconUri?.TaskIcon || undefined
             );

             item.taskFileUri = file;
             item.description = vscode.workspace.asRelativePath(file);
             item.tooltip = `${name}: ${command}`;

             item.startLine = this.findScriptLine(textContent, name);

             item.command = {
                command: 'workspaceTasks.openFileAtLine',
                title: 'Open File',
                arguments: [file, item.startLine || 0]
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
      let current = obj;
      for (const part of parts) {
          if (current === undefined || current === null) {
              return undefined;
          }
          current = current[part];
      }
      return current;
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
