import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import * as path from 'path';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService } from '../services/executableService';

export class JustfileTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('justfile', constants.GLOB_JUST);
  }

  public getCommand(resourceUri?: vscode.Uri) {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.just',
        defaultValue: 'just',
        configName: 'just',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();

    // Find files using the utility
    // Glob patterns for justfiles
    const files = await filesService.findFiles([constants.GLOB_JUST]);

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'justfile'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line || line.startsWith('#')) {
            continue;
          } // Skip empty and comments

          // Regex for recipe:
          // Start of line (ignoring whitespace handled by trim, but recipe usually starts at col 0)
          // Optional @
          // Name
          // Optional params
          // :
          // Allow for attributes [attr] before (handled by not matching?)
          // Attributes are usually on previous lines or same line? Grammar says attributes* then @? NAME
          // Attributes are [ ... ] eol. So they are on previous lines.

          // Simple regex: look for name followed by :
          // But exclude assignments :=

          // NAME = [a-zA-Z_][a-zA-Z0-9_-]*

          const match = line.match(/^@?([a-zA-Z_][a-zA-Z0-9_-]*)\s*.*:/);

          if (match) {
            // Check it is not an assignment or alias
            if (line.includes(':=')) {
              continue;
            }

            const target = match[1];
            // Ignore reserved words if any match the regex?
            if (
              target === 'mod' ||
              target === 'import' ||
              target === 'export' ||
              target === 'alias' ||
              target === 'set'
            ) {
              continue;
            }

            const item = new TaskItem(
              target,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              file,
              undefined,
              iconPath,
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i],
            };
            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`[JustfileTaskProvider] Error parsing Justfile: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }
}
