import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskFilesService } from './taskFilesService';
import { parseJsonWithComments } from '../libs/jsonUtils';
import { LoggerService } from './loggerService';

/**
 * Flexible file reference type for envFiles / secretFiles.
 * Accepts a single path/glob, an ordered array, or an include/exclude object.
 */
export type IEnvFileReference =
  | string
  | string[]
  | { include: string[]; exclude?: string[] };

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
  env?: Record<string, string>;
  envFiles?: IEnvFileReference;
  secretFiles?: IEnvFileReference;
  secrets?: Record<string, string>;
  /** When true the task will prompt for confirmation before running (Solution B guard). */
  confirm?: boolean;
}

interface LanguageTaskConfig {
  version: string;
  globs?: {
    include?: string[];
    exclude?: string[];
  };
  iconUri?: string | { dark: string; light: string };
  taskType?: string;
  inputs: TaskInput[];
  tasks: FileTaskDefinition[];
  env?: Record<string, string>;
  envFiles?: IEnvFileReference;
  secretFiles?: IEnvFileReference;
}

interface FileTasksConfig {
  [languageId: string]: LanguageTaskConfig;
}

export class WorkspaceTasksService {
  private static instance: WorkspaceTasksService;
  private config: FileTasksConfig = {};
  private configLoaded = false;
  private context?: vscode.ExtensionContext;
  private logger = LoggerService.getInstance();

  private constructor() { }

  public static getInstance(): WorkspaceTasksService {
    if (!WorkspaceTasksService.instance) {
      WorkspaceTasksService.instance = new WorkspaceTasksService();
    }
    return WorkspaceTasksService.instance;
  }

  public async initialize(context: vscode.ExtensionContext) {
    this.context = context;
    this.configLoaded = false;
    await this.loadWorkspaceConfig();

    // Watch for .workspace-tasks.json file changes so the config is reloaded on the
    // next provider refresh instead of returning stale data after a save.
    const wsTasksWatcher = vscode.workspace.createFileSystemWatcher('**/.workspace-tasks.json');
    const resetConfig = () => { this.configLoaded = false; };
    wsTasksWatcher.onDidChange(resetConfig);
    wsTasksWatcher.onDidCreate(resetConfig);
    wsTasksWatcher.onDidDelete(resetConfig);
    context.subscriptions.push(wsTasksWatcher);
  }

  private async loadWorkspaceConfig() {
    const loadStart = Date.now();
    let newConfig: FileTasksConfig = {};
    let defaultsPath: string | undefined;

    if (this.context) {
      defaultsPath = path.join(this.context.extensionPath, 'res', 'config', 'workspace-tasks.json');
    }

    try {
      if (defaultsPath && fs.existsSync(defaultsPath)) {
        const defaultsStart = Date.now();
        const content = await fs.promises.readFile(defaultsPath, 'utf8');
        newConfig = parseJsonWithComments(content);
        this.logger.debug(`[WorkspaceTasksService] Loaded built-in defaults in ${Date.now() - defaultsStart}ms.`);
      }
    } catch (e) {
      this.logger.error(`[WorkspaceTasksService]: Failed to load default workspace tasks from ${defaultsPath}`, e);
    }

    const filesService = TaskFilesService.getInstance();
    const findStart = Date.now();
    const files = await filesService.findFiles(['**/.workspace-tasks.json']);
    this.logger.debug(`[WorkspaceTasksService] Found ${files.length} .workspace-tasks.json file(s) in ${Date.now() - findStart}ms.`);
    if (files.length > 0) {
      for (const file of files) {
        const fileStart = Date.now();
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
          this.logger.debug(`[WorkspaceTasksService] Loaded ${file.fsPath} in ${Date.now() - fileStart}ms.`);
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
    this.configLoaded = true;

    // Register all dynamic globs declared in workspace-task configs with TaskFilesService so that
    // the shared file cache includes them. This avoids each provider issuing its own uncovered
    // vscode.workspace.findFiles call and instead lets them all share a single combined scan.
    const dynamicGlobs: string[] = ['**/.workspace-tasks.json'];
    for (const key of Object.keys(this.config)) {
      const includes = this.config[key].globs?.include ?? [];
      dynamicGlobs.push(...includes);
    }
    const uniqueGlobs = [...new Set(dynamicGlobs)];
    filesService.registerPatterns(uniqueGlobs);
    // Mark the cache stale so the next findFiles() call rebuilds it including the new patterns.
    // Using markCacheStale() (not invalidateCache()) avoids triggering a premature tree refresh
    // during extension startup before providers and the tree view are initialised.
    filesService.markCacheStale();
    this.logger.debug(`[WorkspaceTasksService] Registered ${uniqueGlobs.length} dynamic glob pattern(s) with TaskFilesService.`);

    this.logger.info(`[WorkspaceTasksService] loadWorkspaceConfig() completed in ${Date.now() - loadStart}ms (${Object.keys(this.config).length} provider(s) loaded).`);
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
    if (!this.configLoaded) {
      await this.loadWorkspaceConfig();
    }
    // Return all the keys (language IDs / Task Types) from the config
    return Object.keys(this.config).filter((key) => {
      // ignore keys that start with _ and $
      return !key.startsWith('_') && !key.startsWith('$');
    });
  }

  public getIconUri(languageId: string): string | { dark: string; light: string } | undefined {
    return this.getLanguageConfig(languageId)?.iconUri;
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
    if (!this.configLoaded && Object.keys(this.config).length === 0) {
      await this.loadWorkspaceConfig();
    }

    const config = this.getLanguageConfig(languageId);
    return config ? config.tasks : [];
  }

  public async resolveTaskCommand(
    taskLabel: string,
    languageId: string,
    resourceUri: vscode.Uri,
  ): Promise<string | undefined> {
    if (!this.configLoaded && Object.keys(this.config).length === 0) {
      await this.loadWorkspaceConfig();
    }
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
