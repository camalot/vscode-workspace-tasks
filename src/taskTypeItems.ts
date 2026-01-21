import * as vscode from 'vscode';
import { TaskItem } from './taskItem';

export abstract class TaskTypeGroupItem extends TaskItem {
    constructor(label: string, resourceUri?: vscode.Uri) {
        // We pass label as type for now
        super(label, vscode.TreeItemCollapsibleState.Expanded, 'type', resourceUri);
        // Explicitly clear iconPath to force using resourceUri based icon
        this.iconPath = vscode.ThemeIcon.File;
    }
}

export class NpmTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        // Use a root path to ensure it's treated as a file resource
        super('npm', vscode.Uri.file('/package.json'));
    }
}

export class VscodeTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        super('vscode', vscode.Uri.file('/tasks.code-workspace'));
    }
}

export class ScriptTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        super('script', vscode.Uri.file('/script.sh'));
    }
}

export class MakefileTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        super('makefile', vscode.Uri.file('/Makefile'));
    }
}

export class DockerfileTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        super('dockerfile', vscode.Uri.file('/Dockerfile'));
    }
}

export class JustfileTaskTypeItem extends TaskTypeGroupItem {
    constructor() {
        super('justfile', vscode.Uri.file('/justfile'));
    }
}

export class GenericTaskTypeItem extends TaskTypeGroupItem {
    constructor(type: string) {
        super(type, vscode.Uri.file('/file'));
    }
}

export class TaskTypeFactory {
    public static create(type: string): TaskTypeGroupItem {
        switch (type) {
            case 'npm':
                return new NpmTaskTypeItem();
            case 'vscode':
                return new VscodeTaskTypeItem();
            case 'script':
                return new ScriptTaskTypeItem();
            case 'makefile':
                return new MakefileTaskTypeItem();
            case 'dockerfile':
                return new DockerfileTaskTypeItem();
            case 'justfile':
                return new JustfileTaskTypeItem();
            default:
                return new GenericTaskTypeItem(type);
        }
    }
}
