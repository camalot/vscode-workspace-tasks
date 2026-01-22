import * as vscode from 'vscode';
import { TaskStateManager } from './taskStateManager';

export class TaskItem extends vscode.TreeItem {
    public children: TaskItem[] = [];
    public startLine: number | undefined;
    public originalLabel: string;
    public defaultIconPath: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined;
    public taskSource: string | undefined;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly taskType: string,
        public readonly resourceUri?: vscode.Uri,
        public command?: vscode.Command,
        defaultIconPath?: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }
    ) {
        super(label, collapsibleState);
        this.originalLabel = label;
        this.tooltip = `${this.label} (${this.taskType})`;
        this.description = this.taskType;
        this.resourceUri = resourceUri;
        this.defaultIconPath = defaultIconPath;

        this.updateContextValue();
    }

    public updateContextValue() {
        if (this.taskType === 'workspace' || this.taskType === 'folder' || this.taskType === 'type' || this.taskType === 'favorites' || this.taskType === 'queue') {
            this.contextValue = this.taskType;
        } else {
            // It's a task leaf node
            const id = TaskStateManager.getInstance().getTaskId(this);
            const status = TaskStateManager.getInstance().getStatus(id);
            const isFavorite = TaskStateManager.getInstance().isFavorite(id);

            if (status === 'running') {
                this.contextValue = 'runningTask';
                this.iconPath = new vscode.ThemeIcon('loading~spin');
            } else {
                // If it was already set to queuedTask (manually by TreeDataProvider), we keep it
                if (this.contextValue !== 'queuedTask') {
                    this.contextValue = isFavorite ? 'favoriteTask' : 'task';
                }

                if (status === 'success') {
                    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
                } else if (status === 'failure') {
                    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                } else {
                    this.iconPath = this.defaultIconPath; // Default
                }
            }
        }
    }
}
