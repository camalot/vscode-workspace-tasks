import * as vscode from "vscode";
import constants from "../libs/constants";
import { ExecutableResult, ExecutableService } from "../services/executableService";
import { PackageJsonTaskProvider } from "./packageJsonTaskProvider";
import { TaskItem } from "../taskItem";
import { TaskFilesService } from "../services/taskFilesService";
import { TaskIconService } from "../services/taskIconService";
import { BaseTaskProvider } from "../taskProvider";


export class DenoTaskProvider extends BaseTaskProvider {
  constructor() {
    super('deno', constants.GLOB_DENO);
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    // const packageJsonTasks = await super.getTasks();

    // deno format:
    /*
      {
        "tasks": {
          "cool": "echo 'This is a cool task!'",
          "build": "deno build --allow-net mod.ts",
          "test": "deno test --allow-net tests/",
          "start": "deno run --allow-net mod.ts"
        }
      }
    */
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_DENO]);
    const iconService = TaskIconService.getInstance();

    for (const file of files) {
      if (filesService.shouldIgnore(file)) { continue; }
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const iconUri = iconService.getTaskTypeIcon(this.type, file);

        // Simple parsing for now
        const json = JSON.parse(content);
        if (json.tasks) {
          console.log(`Found ${Object.keys(json.tasks).length} tasks in ${file.fsPath}`);
          for (const script of Object.keys(json.tasks)) {
            const item = new TaskItem(
              script,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);

            // Find line number
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`"${script}"`)) {
                item.startLine = i;
                break;
              }
            }

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0]
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        console.warn(`Error parsing package.json: ${file.fsPath}`, e);
      }
    }

    // ...packageJsonTasks,
    return tasks;
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const executableService = ExecutableService.getInstance();
    return executableService.getCommand({
      defaultValue: 'deno',
      configName: 'deno',
      resolveToAbsolutePath: false,
      windowsEnforceExtension: false
    }, workspaceUri);
  }
}
