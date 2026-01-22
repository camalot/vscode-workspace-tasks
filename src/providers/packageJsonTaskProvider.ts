import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskIgnoreService } from '../services/taskIgnoreService';
import { TaskConfigService } from '../services/taskConfigService';
import constants from '../libs/constants';
import * as path from 'path';

export class PackageJsonTaskProvider extends BaseTaskProvider implements TaskProvider {
    constructor(private context?: vscode.ExtensionContext) {
        super('npm');
    }
    async getTasks(): Promise<TaskItem[]> {
        if (!this.enabled) {
            return [];
        }
        const tasks: TaskItem[] = [];
        const files = await vscode.workspace.findFiles(
          constants.GLOB_NODEJS, constants.GLOB_GLOBAL_EXCLUDE
        );
        const ignoreService = TaskIgnoreService.getInstance();

        for (const file of files) {
            if (ignoreService.shouldIgnore(file)) { continue; }

            try {
                const document = await vscode.workspace.openTextDocument(file);
                const content = document.getText();

                let iconPath: { light: vscode.Uri; dark: vscode.Uri } | undefined;
                if (this.context) {
                  iconPath = {
                    light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', 'npm.svg')),
                    dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', 'npm.svg'))
                  };
                }
                // Simple parsing for now
                const json = JSON.parse(content);
                if (json.scripts) {
                    for (const script of Object.keys(json.scripts)) {
                        const item = new TaskItem(
                            script,
                            vscode.TreeItemCollapsibleState.None,
                            this.type,
                            file,
                            undefined,
                            iconPath
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
