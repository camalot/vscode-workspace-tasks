import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import * as path from 'path';
import * as fs from 'fs';
import constants from '../libs/constants';
import { configuration } from '../libs/configuration';
import { TaskIconService } from '../services/taskIconService';

export class ComposerTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('composer');
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const filesService = TaskFilesService.getInstance();
    const tasks: TaskItem[] = [];
    const files = await filesService.findFiles(
      [constants.GLOB_COMPOSER]
    );
    const iconService = TaskIconService.getInstance();

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();

        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ""), 'composer.json'));
        const iconPath = iconService.getTaskTypeIcon(this.type, fallback);

        const json = JSON.parse(content);
        if (json.scripts) {
          for (const script of Object.keys(json.scripts)) {
            const item = new TaskItem(
              script,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconPath?.DisplayUri || file,
              undefined,
              iconPath?.TaskIcon || undefined
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

            item.command = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, item.startLine || 0]
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        console.error(`Error parsing composer.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  public getCommand(workspaceUri?: vscode.Uri): string {
    const composerPath = configuration.get<string>("appplicationPath.composer");
    if (composerPath) {
      let resolvedPath = composerPath;
      // If relative path and workspaceUri exists
      if (!path.isAbsolute(composerPath) && workspaceUri) {
        const localPath = path.join(workspaceUri.fsPath, composerPath);
        if (fs.existsSync(localPath)) {
          resolvedPath = localPath;
        }
      }

      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
      // On Windows, try adding .bat
      if (process.platform === 'win32' && !resolvedPath.toLowerCase().endsWith('.bat') && !resolvedPath.toLowerCase().endsWith('.exe')) {
        if (fs.existsSync(resolvedPath + '.bat')) {
          return resolvedPath + '.bat';
        }
        if (resolvedPath.endsWith('composer')) {
          return resolvedPath + '.exe';
        }
      }
      // If file not found, return configured path anyway (might be in PATH but user wanted to be specific?)
      // Or maybe user put just "composer.phar" which is in PATH?
      return resolvedPath;
    }

    if (process.platform === 'win32') {
      return 'composer.exe';
    }
    return 'composer';
  }
}
