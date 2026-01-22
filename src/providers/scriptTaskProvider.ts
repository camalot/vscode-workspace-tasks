import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskIgnoreService } from '../services/taskIgnoreService';
import { TaskConfigService } from '../services/taskConfigService';
import * as path from 'path';
import constants from '../libs/constants';

export class ScriptTaskProvider extends BaseTaskProvider implements TaskProvider {
    constructor() {
        super('script');
    }
    async getTasks(): Promise<TaskItem[]> {
        if (!this.enabled) {
            return [];
        }
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
          '**/*.cmd',
          '**/*.fish',
          '**/*.ksh',
          '**/*.csh'
        ];

        for (const pattern of patterns) {
             const files = await vscode.workspace.findFiles(pattern, constants.GLOB_SHELL_EXCLUDE);
             for (const file of files) {
                 if (ignoreService.shouldIgnore(file)) { continue; }

                 const filename = path.basename(file.fsPath);

                 const item = new TaskItem(
                     filename,
                     vscode.TreeItemCollapsibleState.None,
                     this.type, // type
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
