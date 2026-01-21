import * as vscode from 'vscode';
import { TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { findFilesByGlobAndLanguage } from '../libs/fileUtils';
import * as path from 'path';

export class JustfileTaskProvider implements TaskProvider {
    async getTasks(): Promise<TaskItem[]> {
        const tasks: TaskItem[] = [];

        // Find files using the utility
        // Glob patterns for justfiles
        const globPattern = '{**/justfile,**/.justfile,**/*.just}';
        const files = await findFilesByGlobAndLanguage(globPattern, '**/node_modules/**', 'just');

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('#')) { continue; } // Skip empty and comments

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
                        if (line.includes(':=')) { continue; }

                        const target = match[1];
                        // Ignore reserved words if any match the regex?
                        if (target === 'mod' || target === 'import' || target === 'export' || target === 'alias' || target === 'set') { continue; }

                         const item = new TaskItem(
                            target,
                            vscode.TreeItemCollapsibleState.None,
                            'justfile',
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
                console.error(`Error parsing Justfile: ${file.fsPath}`, e);
            }
        }
        return tasks;
    }
}
