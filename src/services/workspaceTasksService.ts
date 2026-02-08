import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskFilesService } from './taskFilesService';
import { parseJsonWithComments } from '../libs/jsonUtils';
import { LoggerService } from './loggerService';

interface TaskInput {
  id: string;
  type: 'promptString' | 'pickString';
  description: string;
  default?: string;
  options?: string[];
}

export interface FileTaskDefinition {
  label: string;
  type: 'workspace';
  command: string;
  group?: string;
  sourceUri?: vscode.Uri;
  line?: number;
}

interface LanguageTaskConfig {
  version: string;
  globs?: {
    include?: string[];
    exclude?: string[];
  };
  iconUri?: string;
  inputs: TaskInput[];
  tasks: FileTaskDefinition[];
}

interface FileTasksConfig {
  [languageId: string]: LanguageTaskConfig;
}

export class WorkspaceTasksService {
  private static instance: WorkspaceTasksService;
  private config: FileTasksConfig = {};
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();

  private constructor() { }

  public static getInstance(): WorkspaceTasksService {
    if (!WorkspaceTasksService.instance) {
      WorkspaceTasksService.instance = new WorkspaceTasksService();
    }
    return WorkspaceTasksService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadWorkspaceConfig();
  }

  private async loadWorkspaceConfig() {
    let newConfig: FileTasksConfig = {};
    let defaultsPath: string | undefined;

    if (this.context) {
      defaultsPath = path.join(this.context.extensionPath, 'res', 'config', 'workspace-tasks.json');
    } else {
      // Allow test environment (no extension context) to load defaults from repo relative path
      defaultsPath = path.resolve(__dirname, '..', '..', 'res', 'config', 'workspace-tasks.json');
    }

    try {
      if (defaultsPath && fs.existsSync(defaultsPath)) {
        const content = await fs.promises.readFile(defaultsPath, 'utf8');
        newConfig = parseJsonWithComments(content);
      }
    } catch (e) {
      this.logger.error(`[WorkspaceTasksService]: Failed to load default workspace tasks from ${defaultsPath}`, e);
    }

    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles(['**/.workspace-tasks.json']);
    if (files.length > 0) {
      for (const file of files) {
        try {
          const content = await vscode.workspace.fs.readFile(file);
          const jsonString = new TextDecoder().decode(content);
          const fileLines = jsonString.split(/\r?\n/);
          const localConfig = parseJsonWithComments(jsonString) as FileTasksConfig;

          // Tag tasks with sourceUri
          for (const key in localConfig) {
            if (localConfig[key].tasks) {
              localConfig[key].tasks.forEach((t) => {
                t.sourceUri = file;
                // Find line number of the label
                // This is a simple heuristic search
                for (let i = 0; i < fileLines.length; i++) {
                  if (fileLines[i].includes(`"${t.label}"`)) {
                    t.line = i;
                    break;
                  }
                }
              });
            }
          }

          this.mergeConfig(newConfig, localConfig);
        } catch (e) {
          if (e instanceof Error && e.message.includes('Unexpected end of JSON input')) {
            this.logger.debug(`[WorkspaceTasksService]: Incomplete JSON in ${file.fsPath}, ignoring.`);
          } else {
            this.logger.error(`[WorkspaceTasksService]: Failed to load workspace tasks from ${file.fsPath}`, e);
          }
        }
      }
    }
    this.config = newConfig;
  }

  private mergeConfig(target: FileTasksConfig, local: FileTasksConfig) {
    for (const langId in local) {
      const localLang = local[langId];
      if (!target[langId]) {
        target[langId] = localLang;
      } else {
        const internalLang = target[langId];

        // Merge inputs
        const inputMap = new Map<string, TaskInput>();
        internalLang.inputs.forEach((i) => inputMap.set(i.id, i));
        localLang.inputs.forEach((i) => inputMap.set(i.id, i));
        internalLang.inputs = Array.from(inputMap.values());

        // Merge tasks
        const taskMap = new Map<string, FileTaskDefinition>();
        internalLang.tasks.forEach((t) => taskMap.set(t.label, t));
        localLang.tasks.forEach((t) => taskMap.set(t.label, t));
        internalLang.tasks = Array.from(taskMap.values());

        // Merge globs
        if (localLang.globs) {
          if (!internalLang.globs) {
            internalLang.globs = {};
          }
          if (localLang.globs.include) {
            internalLang.globs.include = [...(internalLang.globs.include || []), ...localLang.globs.include];
          }
          if (localLang.globs.exclude) {
            internalLang.globs.exclude = [...(internalLang.globs.exclude || []), ...localLang.globs.exclude];
          }
        }
      }
    }
  }

  public async getProviders(): Promise<string[]> {
    await this.loadWorkspaceConfig();
    // Return all the keys (language IDs / Task Types) from the config
    return Object.keys(this.config).filter((key) => {
      // ignore keys that start with _ and $
      return !key.startsWith('_') && !key.startsWith('$');
    });
  }

  public getLanguageConfig(languageId: string): LanguageTaskConfig | undefined {
    let config = this.config[languageId];
    if (!config) {
      const key = Object.keys(this.config).find((k) => k.toLowerCase() === languageId.toLowerCase());
      if (key) {
        config = this.config[key];
      }
    }
    return config;
  }

  public async getTasks(languageId: string): Promise<FileTaskDefinition[]> {
    // Ensure config is loaded (if loadWorkspaceConfig is pending, we might need to wait?)
    // Since loadWorkspaceConfig is fired in constructor but not awaited, this might race.
    // We should explicitly reload or wait here?
    // Simple fix: call findFiles again? No, expensive.
    // Better: trigger load on first access if needed, or assume it's loaded reasonably fast?
    // To be safe and correct per user request "merge data with .workspace-tasks.json", we should ensure it's loaded.

    // Let's re-trigger load to be safe or await a promise if we stored it?
    // For now, let's just await the load logic again here or check a flag.
    // Since we changed this to async, we can await!
    await this.loadWorkspaceConfig();

    const config = this.getLanguageConfig(languageId);
    return config ? config.tasks : [];
  }

  public async resolveTaskCommand(
    taskLabel: string,
    languageId: string,
    resourceUri: vscode.Uri,
  ): Promise<string | undefined> {
    await this.loadWorkspaceConfig();
    let config = this.config[languageId];
    if (!config) {
      const key = Object.keys(this.config).find((k) => k.toLowerCase() === languageId.toLowerCase());
      if (key) {
        config = this.config[key];
      }
    }

    if (!config) {
      return undefined;
    }

    const task = config.tasks.find((t) => t.label === taskLabel);
    if (!task) {
      return undefined;
    }

    let command = task.command;

    // 1. Replace Predefined Variables
    // {{ .FileName }}
    const fileName = path.basename(resourceUri.fsPath);
    command = command.replace(/{{ \.FileName }}/g, fileName);

    // Extensionless name?
    // const fileNameNoExt = path.basename(resourceUri.fsPath, path.extname(resourceUri.fsPath));
    // if (fileName.toLowerCase() === 'dockerfile') {
    // For Dockerfile, workspaceFolderBasename is often used.
    // const ws = vscode.workspace.getWorkspaceFolder(resourceUri);
    // const wsName = ws ? ws.name : path.basename(path.dirname(resourceUri.fsPath));
    // Check if we need a specific var for that or if user uses inputs
    // }

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
      const inputDef = config.inputs.find((i) => i.id === inputId);
      if (!inputDef) {
        // Input undefined in json but used in command?
        this.logger.warn(`[WorkspaceTasksService] Input '${inputId}' not defined in fileTasks.json`);
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
          placeHolder: defaultValue,
        });
      } else if (inputDef.type === 'pickString') {
        value = await vscode.window.showQuickPick(inputDef.options || [], {
          placeHolder: inputDef.description,
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
