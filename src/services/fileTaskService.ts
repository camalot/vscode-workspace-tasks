import * as vscode from 'vscode';
import * as path from 'path';
// @ts-ignore
import * as fileTasksData from '../fileTasks.json';

interface TaskInput {
    id: string;
    type: 'promptString' | 'pickString';
    description: string;
    default?: string;
    options?: string[];
}

interface FileTaskDefinition {
    label: string;
    type: 'shell';
    command: string;
    group?: string;
}

interface LanguageTaskConfig {
    version: string;
    inputs: TaskInput[];
    tasks: FileTaskDefinition[];
}

interface FileTasksConfig {
    [languageId: string]: LanguageTaskConfig;
}

export class FileTaskService {
    private static instance: FileTaskService;
    private config: FileTasksConfig;

    private constructor() {
        this.config = fileTasksData as unknown as FileTasksConfig;
    }

    public static getInstance(): FileTaskService {
        if (!FileTaskService.instance) {
            FileTaskService.instance = new FileTaskService();
        }
        return FileTaskService.instance;
    }

    public getTasks(languageId: string): FileTaskDefinition[] {
        // Handle case sensitivity? JSON keys seem to be CaseSensitive ("DockerFile")
        // Try exact match first, then case insensitive
        let config = this.config[languageId];
        if (!config) {
             const key = Object.keys(this.config).find(k => k.toLowerCase() === languageId.toLowerCase());
             if (key) {
                 config = this.config[key];
             }
        }
        
        return config ? config.tasks : [];
    }

    public async resolveTaskCommand(taskLabel: string, languageId: string, resourceUri: vscode.Uri): Promise<string | undefined> {
        let langKey = languageId;
        let config = this.config[languageId];
         if (!config) {
             const key = Object.keys(this.config).find(k => k.toLowerCase() === languageId.toLowerCase());
             if (key) {
                 langKey = key;
                 config = this.config[key];
             }
        }

        if (!config) { return undefined; }

        const task = config.tasks.find(t => t.label === taskLabel);
        if (!task) { return undefined; }

        let command = task.command;

        // 1. Replace Predefined Variables
        // {{ .FileName }}
        const fileName = path.basename(resourceUri.fsPath);
        command = command.replace(/{{ \.FileName }}/g, fileName);
        
        // Extensionless name?
        const fileNameNoExt = path.basename(resourceUri.fsPath, path.extname(resourceUri.fsPath));
        if (fileName.toLowerCase() === 'dockerfile') {
             // For Dockerfile, workspaceFolderBasename is often used.
             const ws = vscode.workspace.getWorkspaceFolder(resourceUri);
             const wsName = ws ? ws.name : path.basename(path.dirname(resourceUri.fsPath));
             // Check if we need a specific var for that or if user uses inputs
        }


        // 2. Identify Inputs
        // Regex to find {{ .VarName }}
        const inputRegex = /{{ \.(\w+) }}/g;
        let match;
        const requiredInputs = new Set<string>();
        
        while ((match = inputRegex.exec(command)) !== null) {
            const varName = match[1];
            if (varName !== 'FileName') {
                requiredInputs.add(varName);
            }
        }

        // 3. Prompt for Inputs
        for (const inputId of requiredInputs) {
            const inputDef = config.inputs.find(i => i.id === inputId);
            if (!inputDef) {
                // Input undefined in json but used in command?
                console.warn(`Input '${inputId}' not defined in fileTasks.json`);
                continue;
            }

            let value: string | undefined;

            if (inputDef.type === 'promptString') {
                 // Check if default contains variable
                 let defaultValue = inputDef.default;
                 if (defaultValue === '${workspaceFolderBasename}') {
                     const ws = vscode.workspace.getWorkspaceFolder(resourceUri);
                     defaultValue = ws ? ws.name : '';
                 }

                 value = await vscode.window.showInputBox({
                     prompt: inputDef.description,
                     value: defaultValue,
                     placeHolder: defaultValue
                 });
            } else if (inputDef.type === 'pickString') {
                value = await vscode.window.showQuickPick(inputDef.options || [], {
                    placeHolder: inputDef.description
                });
            }

            if (value === undefined) {
                // User cancelled
                return undefined;
            }

            // Replace in command
            const replaceRegex = new RegExp(`{{ \\.${inputId} }}`, 'g');
            command = command.replace(replaceRegex, value);
        }

        return command;
    }
}
