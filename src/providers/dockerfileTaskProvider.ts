import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { findFilesByGlobAndLanguage } from '../libs/fileUtils';
import { FileTaskService } from '../services/fileTaskService';

export class DockerfileTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];

        // Find files using the utility
        // Glob matches: Dockerfile, dockerfile, anything.dockerfile, Dockerfile.anything
        const files = await findFilesByGlobAndLanguage('{**/Dockerfile,**/dockerfile,**/*.dockerfile,**/Dockerfile.*}', '**/node_modules/**', 'dockerfile');

        const service = FileTaskService.getInstance();
        const taskDefs = service.getTasks('dockerfile'); // Key in JSON

        for (const file of files) {
            for (const taskDef of taskDefs) {
                const item = new TaskItem(
                    taskDef.label,
                    vscode.TreeItemCollapsibleState.None,
                    'dockerfile', // New Type
                    file
                );

                item.description = vscode.workspace.asRelativePath(file);

                // We'll set command to simple open file for double click,
                // but execution will be handled by TaskRunner via context/type
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
