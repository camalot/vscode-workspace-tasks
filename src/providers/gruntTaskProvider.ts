import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskIgnoreService } from '../services/taskIgnoreService';
import constants from '../libs/constants';

export class GruntTaskProvider extends BaseTaskProvider implements TaskProvider {
    constructor() {
        super('grunt');
    }

    async getTasks(): Promise<TaskItem[]> {
        if (!this.enabled) {
            return [];
        }

        const tasks: TaskItem[] = [];
        const ignoreService = TaskIgnoreService.getInstance();

        const files = await vscode.workspace.findFiles(constants.GLOB_GRUNT, constants.GLOB_GLOBAL_EXCLUDE);

        for (const file of files) {
            try {
                if (ignoreService.shouldIgnore(file)) { continue; }

                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Look for grunt.registerTask('name'...) or grunt.registerMultiTask('name'...)
                    const match = line.match(/grunt\.register(?:Task|MultiTask)\(\s*['"`]([\w\-:\.]+)['"`]/);
                    if (match) {
                        const taskName = match[1];

                        const item = new TaskItem(
                            taskName,
                            vscode.TreeItemCollapsibleState.None,
                            this.type,
                            file
                        );

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
                console.error(`Error parsing Gruntfile: ${file.fsPath}`, e);
            }
        }

        return tasks;
    }
}
