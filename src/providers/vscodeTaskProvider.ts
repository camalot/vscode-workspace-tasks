import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';

export class VscodeTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];
        const files = await vscode.workspace.findFiles('**/.vscode/tasks.json', '**/node_modules/**');

        for (const file of files) {
            try {
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
                            'vscode',
                            file
                        );
                        item.description = vscode.workspace.asRelativePath(file);

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
