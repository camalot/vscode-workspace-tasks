import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { TaskProvider } from '../taskProvider';
import { LoggerService } from './loggerService';

export class TaskCacheService {
  private static instance: TaskCacheService;
  private logger = LoggerService.getInstance();
  private fileTaskMap: Map<string, TaskItem[]> = new Map();
  private allTasks: TaskItem[] = [];
  private context?: vscode.ExtensionContext;

  private providers: TaskProvider[] = [];
  private providerTasks: Map<string, TaskItem[]> = new Map();
  private taskMap: Map<string, TaskItem> = new Map();

  private _onDidUpdate: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidUpdate: vscode.Event<void> = this._onDidUpdate.event;

  private constructor() {}

  public getTask(id: string): TaskItem | undefined {
    return this.taskMap.get(id);
  }

  public initialize(context: vscode.ExtensionContext): TaskCacheService {
    this.context = context;
    return this;
  }

  public static getInstance(): TaskCacheService {
    if (!TaskCacheService.instance) {
      TaskCacheService.instance = new TaskCacheService();
    }
    return TaskCacheService.instance;
  }

  public registerProvider(provider: TaskProvider) {
    this.providers.push(provider);
  }

  public getProviders(): TaskProvider[] {
    return this.providers;
  }

  public async refreshProvider(type: string): Promise<void> {
    const provider = this.providers.find((p) => (p as any).type === type);
    if (!provider) {
      return;
    }

    try {
      const tasks = await provider.getTasks();

      this.providerTasks.set(type, tasks);
    } catch (e) {
      this.logger.error(`[TaskCacheService] Error refreshing provider ${type}`, e);
      this.providerTasks.set(type, []);
    }
    this.rebuildCache();
    this._onDidUpdate.fire();
  }

  private rebuildCache() {
    this.allTasks = [];
    this.fileTaskMap.clear();
    this.taskMap.clear();
    const seenIds = new Set<string>();

    // Ensure deterministic order of providers for stable IDs
    const sortedTypes = Array.from(this.providerTasks.keys()).sort();

    const processItem = (task: TaskItem) => {
      // Ensure task has the requested ID format
      if (task.label) {
        let wsPath = '';
        let fileUriStr = '';
        const uri = task.taskFileUri || task.resourceUri;
        if (uri) {
          fileUriStr = uri.toString();
          const ws = vscode.workspace.getWorkspaceFolder(uri);
          if (ws) {
            wsPath = ws.uri.fsPath;
          }
        }
        // Construct ID if needed.
        // We check if it already matches our pattern to avoid double-prefixing if called multiple times?
        // Actually, rebuildCache clears everything so we are reprocessing raw items from providers.
        // Providers might reuse item instances though.
        // Let's assume we can overwrite.
        const newId = `${wsPath}|${fileUriStr}|${task.label}`;
        // Only overwrite if it looks like a default ID (short) or we want to enforce structure
        task.id = newId;
      }

      if (task.id) {
        let uniqueId = task.id;
        let counter = 1;
        while (seenIds.has(uniqueId)) {
          uniqueId = `${task.id}|${counter++}`;
        }
        task.id = uniqueId;
        seenIds.add(uniqueId);
        this.taskMap.set(uniqueId, task);
      }

      if (task.resourceUri) {
        const key = task.resourceUri.toString();
        if (!this.fileTaskMap.has(key)) {
          this.fileTaskMap.set(key, []);
        }
        this.fileTaskMap.get(key)?.push(task);
      }

      if (task.children) {
        task.children.forEach((child) => processItem(child));
      }
    };

    for (const type of sortedTypes) {
      let tasks = this.providerTasks.get(type) || [];

      // Sort tasks deterministically before processing to ensure stable IDs and counters
      // We sort by label and resourceUri
      tasks = tasks.sort((a, b) => {
        const labelA = a.label || '';
        const labelB = b.label || '';
        const comp = labelA.localeCompare(labelB);
        if (comp !== 0) {
          return comp;
        }

        const uriA = a.resourceUri ? a.resourceUri.toString() : '';
        const uriB = b.resourceUri ? b.resourceUri.toString() : '';
        return uriA.localeCompare(uriB);
      });

      for (const task of tasks) {
        processItem(task);
        this.allTasks.push(task);
      }
    }
  }

  public async refresh(): Promise<TaskItem[]> {
    this.providerTasks.clear();
    this.rebuildCache();
    this._onDidUpdate.fire();

    const promises = this.providers.map(async (provider) => {
      const type = (provider as any).type;
      if (type) {
        const start = Date.now();
        try {
          const tasks = await provider.getTasks();
          this.providerTasks.set(type, tasks);
          this.rebuildCache();
          this._onDidUpdate.fire();
        } catch (e) {
          const duration = Date.now() - start;
          this.logger.error(`[TaskCacheService] Error refreshing provider ${type} (took ${duration}ms)`, e);
          this.providerTasks.set(type, []);
        }
      }
    });

    await Promise.all(promises);
    return this.allTasks;
  }

  public getTasksForFile(uri: vscode.Uri): TaskItem[] {
    // Try exact match
    let tasks = this.fileTaskMap.get(uri.toString());
    if (tasks) {
      return tasks;
    }

    // Try finding by fsPath (ignoring scheme/encoding differences) if needed,
    // or iterate keys if we suspect casing issues on Windows.
    // A simple normalization approach:
    const targetPath = uri.fsPath.toLowerCase();
    for (const [key, items] of this.fileTaskMap) {
      const keyUri = vscode.Uri.parse(key);
      if (keyUri.fsPath.toLowerCase() === targetPath) {
        return items;
      }
    }

    return [];
  }

  public getTaskById(id: string): TaskItem | undefined {
    return this.taskMap.get(id);
  }

  public getAllTasks(): TaskItem[] {
    return this.allTasks;
  }

  public findMatchingTask(task: vscode.Task): TaskItem | undefined {
    const allTasks = this.getAllTasks();

    // Extract definition name (task, script, or target) depending on type
    const def = task.definition as any;
    const defName = def.task || def.script || def.target;
    // path added for github-actions to be specific
    const defPath = def.path;

    // Helper to collect matching candidates recursively
    const candidates: TaskItem[] = [];
    const visit = (items: TaskItem[]) => {
      for (const item of items) {
        const labelMatch = item.label === task.name || (item.originalLabel && item.originalLabel === task.name);
        // Handle metadata.systemTaskName which stores original "script - path" names
        const metaMatch = item.metadata && item.metadata.systemTaskName === task.name;
        // Also match against definition name if available (more reliable than UI name)
        const defMatch = defName && (item.label === defName || (item.originalLabel && item.originalLabel === defName));

        // If definition has path, ensure it matches item resourceUri
        let pathMatch = true;

        // Skip path checking for 'vscode' tasks (tasks.json) because their definition path
        // reflects the CWD/script location, not the definition file (tasks.json)
        if (defPath && item.taskType !== 'vscode') {
          const itemUri = item.taskFileUri || item.resourceUri;
          if (itemUri && itemUri.scheme === 'file') {
             // Get task scope folder if available
            let scopeFolder: vscode.WorkspaceFolder | undefined;
            if (task.scope && typeof task.scope !== 'number') {
              scopeFolder = task.scope as vscode.WorkspaceFolder;
            }

            // Normalize paths for comparison (handle windows/unix separators and casing)
            let defPathNorm = vscode.Uri.file(defPath).fsPath.toLowerCase();

            // validation for relative paths. If defPath is relative, and we have a scope, resolve it.
            if (!path.isAbsolute(defPath) && scopeFolder) {
               defPathNorm = vscode.Uri.joinPath(scopeFolder.uri, defPath).fsPath.toLowerCase();
            }

            const itemPathNorm = itemUri.fsPath.toLowerCase();
            const itemDirNorm = path.dirname(itemPathNorm);

            // Match exact file path OR directory of the item (some tasks use folder scope)
            if (defPathNorm !== itemPathNorm && defPathNorm !== itemDirNorm) {
              pathMatch = false;
            }
          }
        }

        if ((labelMatch || defMatch || metaMatch) && pathMatch) {
          candidates.push(item);
        }
        if (item.children && item.children.length > 0) {
          visit(item.children); // Recurse
        }
      }
    };
    visit(allTasks);

    if (candidates.length === 0) {
      return undefined;
    }

    const defType =
      task.definition && (task.definition as any).type ? ((task.definition as any).type as string) : undefined;
    const taskSource = (task as any).source as string | undefined;
    const taskScopeFolder =
      task.scope && typeof task.scope !== 'number' && (task.scope as vscode.WorkspaceFolder).uri
        ? (task.scope as vscode.WorkspaceFolder).uri.toString()
        : undefined;

    // 1) Exact type match (preferred)
    if (defType) {
      const exact = candidates.find((item) => item.taskType === defType);
      if (exact) {
        return exact;
      }
    }

    // 2) Workspace-declared tasks
    if (defType === 'workspace-task') {
      const ws = candidates.find((item) => !!item.taskSource);
      if (ws) {
        return ws;
      }
    }

    // 3) Visual Studio Code declared tasks
    if (taskSource === 'Workspace') {
      const vs = candidates.find((item) => item.taskType === 'vscode');
      if (vs) {
        return vs;
      }
    }

    // 4) Match by workspace folder if available
    if (taskScopeFolder) {
      const byFolder = candidates.find((item) => {
        if (!item.resourceUri) {
          return false;
        }
        const itemFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
        return itemFolder?.uri.toString() === taskScopeFolder;
      });
      if (byFolder) {
        return byFolder;
      }
    }

    // 5) Fallback to first candidate
    return candidates[0];
  }
}
