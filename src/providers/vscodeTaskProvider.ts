import * as vscode from 'vscode';
import * as path from 'path';
import { TaskProvider, BaseTaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';

export class VscodeTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('vscode', constants.GLOB_VSCODE);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_VSCODE]);

    for (const file of files) {
      try {
        const fallback: vscode.Uri = vscode.Uri.file(path.join(path.dirname(file.fsPath || ""), 'vscode.code-workspace'));
        const iconUri = iconService.getTaskTypeIcon(this.type, fallback);

        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        // Simple regex to strip comments.
        // WARNING: This is naive and can break if comments are inside strings.
        // But for standard tasks.json it's usually fine.
        const jsonText = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*/gm, '') // Line comments
          .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'); // Trailing commas cleanup (partial)

        // A safer way would be to treat it as standard JSON if possible, catch error and log.
        // Or require a jsonc parser dependency. For now, try/catch with naive cleaning.

        let json;
        try {
          json = JSON.parse(text); // Try strict JSON first
        } catch {
          // If strict fails, try cleaning comments
          json = JSON.parse(jsonText);
        }

        if (json && json.tasks && Array.isArray(json.tasks)) {
          for (const task of json.tasks) {
            const label = task.label || 'Unnamed Task';
            const item = new TaskItem(
              label,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            // We do NOT set defaultIconPath, so it uses resourceUri (iconUri)

            // Find line number (approximate)
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`"${label}"`)) {
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
        console.error(`Error parsing tasks.json: ${file.fsPath}`, e);
      }
    }
    return tasks;
  }
}
