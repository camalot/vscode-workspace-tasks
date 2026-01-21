import * as vscode from 'vscode';
// @ts-ignore
import ignore from 'ignore';

export class TaskIgnoreService {
    private static instance: TaskIgnoreService;
    private ig: any;

    private constructor() {
        this.ig = ignore();
    }

    public static getInstance(): TaskIgnoreService {
        if (!TaskIgnoreService.instance) {
            TaskIgnoreService.instance = new TaskIgnoreService();
        }
        return TaskIgnoreService.instance;
    }

    public async initialize() {
        this.ig = ignore();
        const files = await vscode.workspace.findFiles('.tasksignore', null, 1);
        if (files.length > 0) {
            try {
                const document = await vscode.workspace.openTextDocument(files[0]);
                const content = document.getText();
                this.ig.add(content);
            } catch (e) {
                console.error('Failed to load .tasksignore', e);
            }
        }
    }

    public shouldIgnore(uri: vscode.Uri): boolean {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) { return false; }

        const relativePath = vscode.workspace.asRelativePath(uri, false);
        return this.ig.ignores(relativePath);
    }
}
