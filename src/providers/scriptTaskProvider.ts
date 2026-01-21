import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskIgnoreService } from '../services/taskIgnoreService';
import * as path from 'path';

export class ScriptTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];
        const ignoreService = TaskIgnoreService.getInstance();

        // Define patterns for script files
        // Find them locally.
        // Note: findFiles can be slow if finding too many.
        // We can do it in parallel or sequential.

        const patterns = [
          '**/*.sh',
          '**/*.zsh',
          '**/*.bash',
          '**/*.ps1',
          '**/*.bat',
          '**/*.cmd'
        ];

        for (const pattern of patterns) {
             const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
             for (const file of files) {
                 if (ignoreService.shouldIgnore(file)) { continue; }

                 const filename = path.basename(file.fsPath);

                 const item = new TaskItem(
                     filename,
                     vscode.TreeItemCollapsibleState.None,
                     'script', // type
                     file
                 );
                 item.description = vscode.workspace.asRelativePath(file);
                 item.command = {
                    command: 'workspaceTasks.openFileAtLine',
                    title: 'Open File',
                    arguments: [file, 0]
                 };
                 tasks.push(item);
             }
        }
        return tasks;
    }
}
