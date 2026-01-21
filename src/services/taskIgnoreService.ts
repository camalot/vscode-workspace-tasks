import * as vscode from 'vscode';
// @ts-ignore
import ignore from 'ignore';

export class TaskIgnoreService {
    private static instance: TaskIgnoreService;
    private ig: any;
    private configWatcher?: vscode.Disposable;

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

        // Add patterns from extension configuration (workspaceTasks.exclude)
        try {
            const config = vscode.workspace.getConfiguration('workspaceTasks');
            const excludes = config.get<string[]>('exclude', []);
            this.ig.add("**/node_modules/**"); // Always ignore node_modules
            if (Array.isArray(excludes) && excludes.length > 0) {
                this.ig.add(excludes);
            }
        } catch (e) {
            console.error('Failed to read workspaceTasks.exclude', e);
        }

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

        // Watch for configuration changes to refresh excludes
        if (this.configWatcher) {
            this.configWatcher.dispose();
            this.configWatcher = undefined;
        }
        this.configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('workspaceTasks.exclude')) {
                this.initialize();
            }
        });
    }

    public shouldIgnore(uri: vscode.Uri): boolean {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) { return false; }

        const relativePath = vscode.workspace.asRelativePath(uri, false);
        return this.ig.ignores(relativePath);
    }
}
