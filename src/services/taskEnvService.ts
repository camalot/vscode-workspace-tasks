import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';
import { IEnvFileReference, FileTaskDefinition } from './workspaceTasksService';
import { TaskEnvFileResolver } from './taskEnvFileResolver';
import { TaskEnvRuleMatcher } from './taskEnvRuleMatcher';
import {
  ITaskEnvRule,
  ILanguageEnvConfig,
  IResolvedEnvEntry,
  EnvEntrySource,
} from './taskEnvTypes';
import { LoggerService } from './loggerService';

/**
 * Singleton service that resolves environment variables for tasks across all fourteen
 * precedence layers defined in the task-environment-variables plan.
 *
 * Call `initialize(context)` once in `extension.ts` `activate()`.  After that,
 * call `resolveTaskEnv(taskItem, ...)` at task-execution time to obtain the fully
 * merged map of `IResolvedEnvEntry` values.
 */
export class TaskEnvService {
  private static instance: TaskEnvService;
  private readonly logger = LoggerService.getInstance();

  private context?: vscode.ExtensionContext;

  // ── Configuration cache (refreshed on every config-change event) ──────────
  private globalEnv: Record<string, string> = {};
  private globalEnvFiles: IEnvFileReference = [];
  private globalSecretFiles: IEnvFileReference = [];
  private secretPatterns: string[] = [];
  private taskEnvRules: ITaskEnvRule[] = [];

  // ── Active file-system watchers ───────────────────────────────────────────
  private fileWatchers: vscode.FileSystemWatcher[] = [];

  // ── Lifecycle disposables ─────────────────────────────────────────────────
  private configDisposable?: vscode.Disposable;

  // ── Public event ─────────────────────────────────────────────────────────
  private readonly _onDidChangeEnvSources = new vscode.EventEmitter<void>();
  /** Fires whenever a watched env/secret file changes or the relevant configuration changes. */
  public readonly onDidChangeEnvSources: vscode.Event<void> =
    this._onDidChangeEnvSources.event;

  private constructor() {}

  public static getInstance(): TaskEnvService {
    if (!TaskEnvService.instance) {
      TaskEnvService.instance = new TaskEnvService();
    }
    return TaskEnvService.instance;
  }

  /**
   * Initialises the service: loads configuration, sets up file-system watchers, and
   * subscribes to configuration-change events.
   *
   * Must be called once from `extension.ts` `activate()`.
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    this.loadConfig();
    this.setupFileWatchers();

    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('workspaceTasks.envVars')
      ) {
        this.loadConfig();
        this.setupFileWatchers();
        this._onDidChangeEnvSources.fire();
      }
    });
    context.subscriptions.push(this.configDisposable);
  }

  /**
   * Resolves and merges environment variables for `taskItem` across all fourteen
   * precedence layers.
   *
   * - Layers 1–3 (global settings) always run.
   * - Layers 4–10 (`.workspace-tasks.json` block + task) run only when `languageDef`
   *   and/or `taskDef` are provided.
   * - Layers 11–14 (matching `workspaceTasks.envVars.taskEnv` rules) always run.
   *
   * @param taskItem       The task whose env should be resolved.
   * @param taskDef        Optional per-task definition from `.workspace-tasks.json`.
   * @param languageDef    Optional language-block config from `.workspace-tasks.json`.
   * @param workspaceFolder Override workspace root used for resolving relative file paths.
   */
  /** Read-only access to the configured secret-pattern list. Used by `TaskSecretWarningService`. */
  public get currentSecretPatterns(): string[] {
    return [...this.secretPatterns];
  }

  public async resolveTaskEnv(
    taskItem: TaskItem,
    taskDef?: FileTaskDefinition,
    languageDef?: ILanguageEnvConfig,
    workspaceFolder?: vscode.Uri,
  ): Promise<Map<string, IResolvedEnvEntry>> {
    const result = new Map<string, IResolvedEnvEntry>();
    const effectiveFolder = this.resolveWorkspaceFolder(taskItem, workspaceFolder);

    // Best-effort path for workspace settings.json — used as sourceFilePath for config-backed entries.
    const workspaceSettingsPath = effectiveFolder
      ? path.join(effectiveFolder.fsPath, '.vscode', 'settings.json')
      : undefined;

    // ── Layer 1: Global workspaceTasks.envVars.env ───────────────────────────────────
    for (const [key, value] of Object.entries(this.globalEnv)) {
      result.set(key, {
        value,
        source: 'globalSetting',
        sourceLabel: 'settings.json (workspaceTasks.envVars.env)',
        isSecret: false,
        sourceFilePath: workspaceSettingsPath,
      });
    }

    // ── Layer 2: Global workspaceTasks.envVars.envFiles ──────────────────────────────
    const globalEnvPaths = await TaskEnvFileResolver.resolveFileReferences(
      this.globalEnvFiles,
      effectiveFolder,
    );
    await this.mergeFromFiles(
      result,
      globalEnvPaths,
      'globalEnvFile',
      false,
      'workspaceTasks.envVars.envFiles',
    );

    // ── Layer 3: Global workspaceTasks.envVars.secretFiles ───────────────────────────
    const globalSecretPaths = await TaskEnvFileResolver.resolveFileReferences(
      this.globalSecretFiles,
      effectiveFolder,
    );
    await this.mergeFromFiles(
      result,
      globalSecretPaths,
      'globalSecretFile',
      true,
      'workspaceTasks.envVars.secretFiles',
    );

    // ── Layers 4–10: .workspace-tasks.json language-block and per-task ───────
    if (languageDef || taskDef) {
      const blockFolder =
        taskDef?.sourceUri
          ? vscode.workspace.getWorkspaceFolder(taskDef.sourceUri)?.uri ?? effectiveFolder
          : effectiveFolder;

      const configLabel = taskDef?.sourceUri
        ? path.basename(taskDef.sourceUri.fsPath)
        : '.workspace-tasks.json';

      // Layer 4 — language-block envFiles
      if (languageDef?.envFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(languageDef.envFiles, blockFolder);
        await this.mergeFromFiles(result, ps, 'blockEnvFile', false, `${configLabel} (block envFiles)`);
      }

      // Layer 5 — language-block env
      if (languageDef?.env) {
        const blockEnvFile = taskDef?.sourceUri?.fsPath;
        for (const [key, value] of Object.entries(languageDef.env)) {
          result.set(key, {
            value,
            source: 'blockEnv',
            sourceLabel: `${configLabel} (block env)`,
            isSecret: false,
            sourceFilePath: blockEnvFile,
          });
        }
      }

      // Layer 6 — language-block secretFiles
      if (languageDef?.secretFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(
          languageDef.secretFiles,
          blockFolder,
        );
        await this.mergeFromFiles(result, ps, 'blockSecretFile', true, `${configLabel} (block secretFiles)`);
      }

      // Layer 7 — per-task envFiles
      if (taskDef?.envFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(taskDef.envFiles, blockFolder);
        await this.mergeFromFiles(result, ps, 'taskEnvFile', false, `${configLabel} (task envFiles)`);
      }

      // Layer 8 — per-task env
      if (taskDef?.env) {
        const taskEnvFile = taskDef.sourceUri?.fsPath;
        for (const [key, value] of Object.entries(taskDef.env)) {
          result.set(key, {
            value,
            source: 'taskEnv',
            sourceLabel: `${configLabel} (task env)`,
            isSecret: false,
            sourceFilePath: taskEnvFile,
          });
        }
      }

      // Layer 9 — per-task secretFiles
      if (taskDef?.secretFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(taskDef.secretFiles, blockFolder);
        await this.mergeFromFiles(result, ps, 'taskSecretFile', true, `${configLabel} (task secretFiles)`);
      }

      // Layer 10 — per-task secrets → SecretStorage
      if (taskDef?.secrets) {
        await this.mergeFromSecretStorage(result, taskDef.secrets, 'taskSecretStorage', configLabel);
      }
    }

    // ── Layers 11–14: Matching workspaceTasks.envVars.taskEnv rules ──────────────────
    const matchingRules = TaskEnvRuleMatcher.getMatchingRules(taskItem, this.taskEnvRules);

    for (const rule of matchingRules) {
      const ruleIndex = this.taskEnvRules.indexOf(rule);
      const ruleLabel = `taskEnv rule #${ruleIndex + 1}`;
      this.logger.debug(
        `[TaskEnv] Rule #${ruleIndex + 1} matched task '${taskItem.originalLabel ?? taskItem.label}'`,
      );

      // Layer 11 — rule envFiles
      if (rule.envFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(rule.envFiles, effectiveFolder);
        await this.mergeFromFiles(result, ps, 'ruleEnvFile', false, ruleLabel);
      }

      // Layer 12 — rule env
      if (rule.env) {
        for (const [key, value] of Object.entries(rule.env)) {
          result.set(key, {
            value,
            source: 'ruleEnv',
            sourceLabel: `${ruleLabel} (env)`,
            isSecret: false,
            sourceFilePath: workspaceSettingsPath,
          });
        }
      }

      // Layer 13 — rule secretFiles
      if (rule.secretFiles) {
        const ps = await TaskEnvFileResolver.resolveFileReferences(
          rule.secretFiles,
          effectiveFolder,
        );
        await this.mergeFromFiles(result, ps, 'ruleSecretFile', true, ruleLabel);
      }

      // Layer 14 — rule secrets → SecretStorage
      if (rule.secrets) {
        await this.mergeFromSecretStorage(result, rule.secrets, 'ruleSecretStorage', ruleLabel);
      }
    }

    // Log rules that were enabled but did not match this task
    for (const rule of this.taskEnvRules) {
      if (rule.enabled !== false && !matchingRules.includes(rule)) {
        const idx = this.taskEnvRules.indexOf(rule);
        const hasNonEmptyMatch = Object.values(rule.match).some((v) => v !== undefined);
        if (hasNonEmptyMatch) {
          this.logger.debug(
            `[TaskEnv] Rule #${idx + 1} has not matched task '${taskItem.originalLabel ?? taskItem.label}'`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Retrieves a single value from VS Code `SecretStorage`.
   * Returns `undefined` when the key is absent or SecretStorage is unavailable.
   */
  public async getSecretStorageValue(storageKey: string): Promise<string | undefined> {
    if (!this.context) {
      return undefined;
    }
    try {
      return await this.context.secrets.get(storageKey);
    } catch (err) {
      this.logger.warn(
        `[TaskEnvService] Failed to retrieve SecretStorage key '${storageKey}'`,
        err,
      );
      return undefined;
    }
  }

  /** Manually fires `onDidChangeEnvSources` — used by secret-management commands. */
  public fireEnvSourcesChanged(): void {
    this._onDidChangeEnvSources.fire();
  }

  /** Disposes all file-system watchers and event emitters. */
  public dispose(): void {
    this.fileWatchers.forEach((w) => w.dispose());
    this.fileWatchers = [];
    this.configDisposable?.dispose();
    this._onDidChangeEnvSources.dispose();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private loadConfig(): void {
    const cfg = vscode.workspace.getConfiguration('workspaceTasks.envVars');
    this.globalEnv = cfg.get<Record<string, string>>('env', {});
    this.globalEnvFiles = cfg.get<IEnvFileReference>('envFiles', []);
    this.globalSecretFiles = cfg.get<IEnvFileReference>('secretFiles', []);
    this.secretPatterns = cfg.get<string[]>('secretPatterns', [
      '*_TOKEN',
      '*_KEY',
      '*_SECRET',
      'PASSWORD',
      'PASSWD',
      'CREDENTIALS',
      'API_KEY',
    ]);
    this.taskEnvRules = cfg.get<ITaskEnvRule[]>('taskEnv', []);
    this.logger.debug(
      `[TaskEnvService] Config loaded: ${Object.keys(this.globalEnv).length} global env key(s), ` +
        `${this.taskEnvRules.length} taskEnv rule(s).`,
    );
  }

  private setupFileWatchers(): void {
    this.fileWatchers.forEach((w) => w.dispose());
    this.fileWatchers = [];

    const patterns = [
      ...this.extractWatchPatterns(this.globalEnvFiles),
      ...this.extractWatchPatterns(this.globalSecretFiles),
    ];
    const uniquePatterns = [...new Set(patterns)];
    if (uniquePatterns.length === 0) {
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of workspaceFolders) {
      for (const pattern of uniquePatterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern),
        );
        const fire = () => this._onDidChangeEnvSources.fire();
        watcher.onDidChange(fire);
        watcher.onDidCreate(fire);
        watcher.onDidDelete(fire);
        this.fileWatchers.push(watcher);
      }
    }

    this.logger.debug(
      `[TaskEnvService] Watching ${this.fileWatchers.length} env/secret file watcher(s).`,
    );
  }

  /**
   * Extracts watch-able glob patterns from an `IEnvFileReference`.
   * For include/exclude objects, only the `include` patterns are watched.
   */
  private extractWatchPatterns(ref: IEnvFileReference | undefined): string[] {
    if (!ref) {
      return [];
    }
    if (typeof ref === 'string') {
      return ref ? [ref] : [];
    }
    if (Array.isArray(ref)) {
      return ref.filter(Boolean);
    }
    return (ref.include ?? []).filter(Boolean);
  }

  /**
   * Resolves the effective workspace folder URI for relative file-path resolution.
   *
   * Priority: explicit parameter > task file's workspace folder > first workspace folder.
   */
  private resolveWorkspaceFolder(taskItem: TaskItem, explicit?: vscode.Uri): vscode.Uri {
    if (explicit) {
      return explicit;
    }

    const fileUri = taskItem.taskFileUri;
    if (fileUri) {
      const ws = vscode.workspace.getWorkspaceFolder(fileUri);
      if (ws) {
        return ws.uri;
      }
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd());
  }

  /**
   * Merges entries from an ordered list of resolved env-file paths into `map`.
   * Later files in the list win over earlier files for duplicate keys.
   */
  private async mergeFromFiles(
    map: Map<string, IResolvedEnvEntry>,
    filePaths: string[],
    source: EnvEntrySource,
    isSecret: boolean,
    contextLabel: string,
  ): Promise<void> {
    for (const fp of filePaths) {
      const entries = TaskEnvFileResolver.parseEnvFile(fp);
      const fileLabel = `${path.basename(fp)} (${contextLabel})`;
      for (const [key, value] of Object.entries(entries)) {
        map.set(key, { value, source, sourceLabel: fileLabel, isSecret, sourceFilePath: fp });
      }
    }
  }

  /**
   * Merges entries from VS Code `SecretStorage` into `map`.
   * Keys not present in storage are silently skipped.
   */
  private async mergeFromSecretStorage(
    map: Map<string, IResolvedEnvEntry>,
    secrets: Record<string, string>,
    source: 'taskSecretStorage' | 'ruleSecretStorage',
    contextLabel: string,
  ): Promise<void> {
    for (const [envKey, storageKey] of Object.entries(secrets)) {
      const value = await this.getSecretStorageValue(storageKey);
      if (value !== undefined) {
        map.set(envKey, {
          value,
          source,
          sourceLabel: `SecretStorage (${storageKey}) via ${contextLabel}`,
          isSecret: true,
        });
      }
    }
  }
}
