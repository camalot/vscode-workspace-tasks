import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskIgnoreService } from '../services/taskIgnoreService';

export class PackageJsonTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];
        const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
        const ignoreService = TaskIgnoreService.getInstance();

        for (const file of files) {
            if (ignoreService.shouldIgnore(file)) { continue; }

            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                // Simple parsing for now
                const json = JSON.parse(content);
                if (json.scripts) {
                    for (const script of Object.keys(json.scripts)) {
                        const item = new TaskItem(
                            script,
                            vscode.TreeItemCollapsibleState.None,
                            'npm',
                            file
                        );
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
                console.error(`Error parsing package.json: ${file.fsPath}`, e);
            }
        }
        return tasks;
    }
}
