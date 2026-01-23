import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { TaskFilesService } from '../services/taskFilesService';

export class MakefileTaskProvider extends BaseTaskProvider implements TaskProvider {
    constructor() {
        super('makefile');
    }
    async getTasks(): Promise<TaskItem[]> {
        if (!this.enabled) {
            return [];
        }
        const tasks: TaskItem[] = [];
        const iconService = TaskIconService.getInstance();
        const filesService = TaskFilesService.getInstance();

        const files = await filesService.findFiles([constants.GLOB_MAKE]);

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                const lines = content.split('\n');

                const iconUri = iconService.getTaskTypeIcon('makefile', file);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // Basic Makefile target parsing
                    const match = line.match(/^([a-zA-Z0-9_\-\.]+):/);
                    if (match) {
                        const target = match[1];
                        if (target === '.PHONY') { continue; }

                         const item = new TaskItem(
                            target,
                            vscode.TreeItemCollapsibleState.None,
                            this.type,
                            iconUri?.DisplayUri || file,
                            undefined,
                            iconUri?.TaskIcon || undefined
                        );
                        item.taskFileUri = file;
                        item.description = vscode.workspace.asRelativePath(file);
                        item.startLine = i;

                        item.command = {
                            command: 'workspaceTasks.openFileAtLine',
                            title: 'Open File',
                            arguments: [file, i]
                        };
                        tasks.push(item);
                    }
                }

            } catch (e) {
                console.error(`Error parsing Makefile: ${file.fsPath}`, e);
            }
        }
        return tasks;
    }
}
