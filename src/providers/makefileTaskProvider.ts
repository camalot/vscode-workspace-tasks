import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { findFilesByGlobAndLanguage } from '../libs/fileUtils';
import * as path from 'path';

export class MakefileTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];
        
        const files = await findFilesByGlobAndLanguage('**/Makefile', '**/node_modules/**', 'makefile');

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                const lines = content.split('\n');

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
                            'makefile',
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
                console.error(`Error parsing Makefile: ${file.fsPath}`, e);
            }
        }
        return tasks;
    }
}
