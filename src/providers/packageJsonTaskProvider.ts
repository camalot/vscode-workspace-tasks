import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableResult } from '../services/executableService';

export abstract class PackageJsonTaskProvider extends BaseTaskProvider implements TaskProvider {
  protected readonly addedTasks: Set<string> = new Set<string>();

  constructor(type: string, globPattern: string) {
    super(type, globPattern);
    this.logger.debug(`${this.type}TaskProvider initialized`);

  }

  protected async parseContent(content: string, _uri?: vscode.Uri): Promise<any> {
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  public abstract getCommand(workspaceUri?: vscode.Uri): ExecutableResult;

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    try {
      const glob = this.filePattern || constants.GLOB_NODEJS;

      this.addedTasks.clear();
      const tasks: TaskItem[] = await this.getSystemTasks();
      const filesService = TaskFilesService.getInstance();
      const iconService = TaskIconService.getInstance();
      this.logger.debug(`[${this.type}TaskProvider] Searching for task files with pattern: ${glob}`);
      const files = await filesService.findFiles([this.filePattern || constants.GLOB_NODEJS]);
      this.logger.debug(`[${this.type}TaskProvider] Found ${files.length} files matching pattern.`);

      for (const file of files) {
        if (filesService.shouldIgnore(file)) {
          continue;
        }

        this.logger.debug(`[${this.type}TaskProvider] Processing file: ${file.fsPath}`);

        try {
          const document = await vscode.workspace.openTextDocument(file);
          const content = document.getText();
          const iconPath = iconService.getTaskIcon(this.type);


          // Simple parsing for now
          const json = JSON.parse(content);
          this.logger.debug(`[${this.type}TaskProvider] Parsed JSON from ${file.fsPath}`);
          if (json.scripts) {
            for (const script of Object.keys(json.scripts)) {
              this.logger.debug(`[${this.type}TaskProvider] Found script: ${script} in ${file.fsPath}`);
              const item = new TaskItem(
                script,
                vscode.TreeItemCollapsibleState.None,
                this.type,
                file,
                undefined,
                iconPath,
              );
              item.taskFileUri = file;
              item.description = vscode.workspace.asRelativePath(file);

              if (this.addedTasks.has(item.id!)) {
                continue;
              }

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
                arguments: [file, item.startLine || 0],
              };

              tasks.push(item);
              this.addedTasks.add(item.id!);
            }
          }
        } catch (e) {
          this.logger.error(`[${this.type}TaskProvider] Error parsing package.json: ${file.fsPath}`, e);
        }
      }
      return tasks;
    } catch (e) {
      this.logger.error(`[${this.type}TaskProvider] Error getting tasks`, e);
      return [];
    }
  }
}
