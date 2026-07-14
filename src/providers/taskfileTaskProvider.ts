import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as yaml from 'yaml';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { LoggerService } from '../services/loggerService';
import { TaskCacheService } from '../services/taskCacheService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';
import { TaskfileRequiredVar } from '../libs/taskfileVarPromptUtils';

const execFileAsync = promisify(execFile);

interface TaskJsonEntry {
  name: string;
  task: string;
  desc?: string;
  summary?: string;
  aliases?: string[];
  location?: {
    line: number;
    column: number;
    taskfile: string;
  };
}

interface TaskJsonOutput {
  tasks: TaskJsonEntry[];
  location: string;
}

interface RequiredVarsInfo {
  tasks: Map<string, TaskfileRequiredVar[]>;
  taskVarDefaults: Map<string, Record<string, string>>;
}

export class TaskfileTaskProvider extends BaseTaskProvider implements TaskProvider {
  private globalTaskfileWatchers: vscode.FileSystemWatcher[] = [];
  private workspaceTaskfileWatchers = new Map<string, vscode.FileSystemWatcher>();
  private globalWatcherDebounce?: NodeJS.Timeout;
  /** Cache: taskfile path → set of task names that reference {{.CLI_ARGS}} */
  private cliArgsTaskCache = new Map<string, Set<string>>();
  /** Cache: taskfile path → required vars and predefined var defaults metadata */
  private requiredVarsCache = new Map<string, RequiredVarsInfo>();

  private readonly cliArgsTaskPattern = /\{\{\.CLI_ARGS\}\}/;

  constructor() {
    super('taskfile', constants.GLOB_TASKFILE);
  }

  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  protected getHomeDir(): string {
    return os.homedir();
  }

  private disposeGlobalTaskfileWatchers(): void {
    for (const watcher of this.globalTaskfileWatchers) {
      watcher.dispose();
    }
    this.globalTaskfileWatchers = [];
    if (this.globalWatcherDebounce) {
      clearTimeout(this.globalWatcherDebounce);
      this.globalWatcherDebounce = undefined;
    }
  }

  private disposeWorkspaceTaskfileWatchers(): void {
    for (const watcher of this.workspaceTaskfileWatchers.values()) {
      watcher.dispose();
    }
    this.workspaceTaskfileWatchers.clear();
  }

  private reconcileWorkspaceTaskfileWatchers(taskfilePaths: string[]): void {
    const target = new Set(taskfilePaths);

    for (const [watchedPath, watcher] of this.workspaceTaskfileWatchers.entries()) {
      if (!target.has(watchedPath)) {
        watcher.dispose();
        this.workspaceTaskfileWatchers.delete(watchedPath);
      }
    }

    for (const filePath of target) {
      if (this.workspaceTaskfileWatchers.has(filePath)) {
        continue;
      }

      const pattern = new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath));
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = () => {
        this.invalidateTaskfileCache(filePath);
        this.scheduleGlobalRefresh();
      };
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      this.workspaceTaskfileWatchers.set(filePath, watcher);
    }
  }

  private scheduleGlobalRefresh(): void {
    if (this.globalWatcherDebounce) {
      clearTimeout(this.globalWatcherDebounce);
    }
    this.globalWatcherDebounce = setTimeout(() => {
      TaskCacheService.getInstance().refresh();
    }, 150);
  }

  private reconcileGlobalTaskfileWatchers(homeDir: string, discoveredPath?: string): void {
    this.disposeGlobalTaskfileWatchers();

    const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
    const watchTargets = new Set<string>(variants.map((v) => path.join(homeDir, v)));
    if (discoveredPath) {
      watchTargets.add(discoveredPath);
    }

    for (const filePath of watchTargets) {
      const pattern = new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath));
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = () => {
        this.invalidateTaskfileCache(filePath);
        this.scheduleGlobalRefresh();
      };
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      this.globalTaskfileWatchers.push(watcher);
    }
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.taskfile',
        defaultValue: 'task', // executable is named 'task'
        configName: 'taskfile',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      this.disposeWorkspaceTaskfileWatchers();
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[TaskfileTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const customPatterns = config.get<string[]>('taskfile.additionalFilePatterns', []);
    const patterns = [constants.GLOB_TASKFILE, ...customPatterns];

    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const files = await filesService.findFiles(patterns);

    // Deduplicate by Taskfile path and always use --taskfile for explicit, deterministic discovery.
    const taskfileMap = new Map<string, vscode.Uri>();
    for (const file of files) {
      if (!taskfileMap.has(file.fsPath)) {
        taskfileMap.set(file.fsPath, file);
      }
    }

    this.reconcileWorkspaceTaskfileWatchers(Array.from(taskfileMap.keys()));

    const results = await Promise.all(
      Array.from(taskfileMap.values()).map((uri) =>
        this._loadTasksFromDirectory(path.dirname(uri.fsPath), uri, iconService),
      ),
    );

    return results.flat();
  }

  /**
   * Invalidates the CLI_ARGS cache entry for a given taskfile path.
   * Called from file-watcher events so the next parse picks up any changes.
   */
  public invalidateTaskfileCache(filePath: string): void {
    this.cliArgsTaskCache.delete(filePath);
    this.requiredVarsCache.delete(filePath);
  }

  /**
   * Backward-compatible wrapper for tests and older callers.
   */
  public invalidateCLIArgsCache(filePath: string): void {
    this.invalidateTaskfileCache(filePath);
  }

  /**
   * Parses the YAML content of a Taskfile and returns the set of task names
   * whose commands reference the `{{.CLI_ARGS}}` template variable.
   *
   * Results are cached by file path and invalidated by `invalidateCLIArgsCache`.
   */
  public detectCLIArgsTasks(filePath: string, content: string): Set<string> {
    const cached = this.cliArgsTaskCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    const result = new Set<string>();

    // Go template expressions such as `{{.CLI_ARGS}}` or `{{index .MATCH 0}}` are not valid
    // YAML syntax when they appear inline after a double-quoted scalar
    // (e.g.  - echo "msg: {{.CLI_ARGS}}" ).  Pre-process the raw content by replacing
    // `{{.CLI_ARGS}}` with a unique marker and all other `{{...}}` patterns with a harmless
    // placeholder so that yaml.parse() always succeeds on well-formed Taskfiles.
    const CLI_ARGS_MARKER = '__WORKSPACE_TASKS_CLI_ARGS__';
    const sanitized = content
      .replace(/\{\{\.CLI_ARGS\}\}/g, CLI_ARGS_MARKER)
      .replace(/\{\{[^}]*\}\}/g, '__WORKSPACE_TASKS_TPL__');

    try {
      const parsed = yaml.parse(sanitized) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') {
        this.cliArgsTaskCache.set(filePath, result);
        return result;
      }

      if ('includes' in parsed) {
        LoggerService.getInstance().debug(
          `[taskfile] '${filePath}' uses 'includes:' — tasks in included files are not scanned for {{.CLI_ARGS}}.`,
        );
      }

      const tasks = parsed['tasks'] as Record<string, unknown> | undefined;
      if (tasks && typeof tasks === 'object') {
        for (const [taskName, taskDef] of Object.entries(tasks)) {
          if (!taskDef || typeof taskDef !== 'object') {
            continue;
          }
          const def = taskDef as Record<string, unknown>;
          const cmds = def['cmds'];
          if (!Array.isArray(cmds)) {
            continue;
          }
          const hasCLIArgs = cmds.some((cmd) => {
            if (typeof cmd === 'string') {
              return cmd.includes(CLI_ARGS_MARKER);
            }
            if (cmd && typeof cmd === 'object') {
              const cmdStr = (cmd as Record<string, unknown>)['cmd'];
              return typeof cmdStr === 'string' && cmdStr.includes(CLI_ARGS_MARKER);
            }
            return false;
          });
          if (hasCLIArgs) {
            result.add(taskName);
          }
        }
      }
    } catch (err: unknown) {
      LoggerService.getInstance().debug(
        `[taskfile] Failed to parse YAML for CLI_ARGS detection in '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.detectCLIArgsTasksFromRawYaml(content, result);

    this.cliArgsTaskCache.set(filePath, result);
    return result;
  }

  private toScalarString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }

  private extractVarDefaults(varsNode: unknown): Record<string, string> {
    if (!varsNode || typeof varsNode !== 'object' || Array.isArray(varsNode)) {
      return {};
    }

    const defaults: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(varsNode as Record<string, unknown>)) {
      const scalar = this.toScalarString(rawValue);
      if (scalar !== undefined) {
        defaults[key] = scalar;
        continue;
      }

      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        continue;
      }

      const objectDefault = this.toScalarString((rawValue as Record<string, unknown>)['default']);
      if (objectDefault !== undefined) {
        defaults[key] = objectDefault;
      }
    }

    return defaults;
  }

  /**
   * Detects Taskfile required variables per task (`requires.vars`) and predefined
   * variable values from file-level `vars` + task-level `vars`.
   */
  public detectRequiredVars(filePath: string, content: string): RequiredVarsInfo {
    const cached = this.requiredVarsCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    const info: RequiredVarsInfo = {
      tasks: new Map<string, TaskfileRequiredVar[]>(),
      taskVarDefaults: new Map<string, Record<string, string>>(),
    };

    const TEMPLATE_PLACEHOLDER = '__WORKSPACE_TASKS_TPL__';
    const sanitized = content
      .replace(/\{\{\.CLI_ARGS\}\}/g, '__WORKSPACE_TASKS_CLI_ARGS__')
      .replace(/\{\{[^}]*\}\}/g, TEMPLATE_PLACEHOLDER);

    try {
      const parsed = yaml.parse(sanitized) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') {
        this.requiredVarsCache.set(filePath, info);
        return info;
      }

      const fileLevelVarDefaults = this.extractVarDefaults(parsed['vars']);

      const tasks = parsed['tasks'] as Record<string, unknown> | undefined;
      if (tasks && typeof tasks === 'object') {
        for (const [taskName, taskDef] of Object.entries(tasks)) {
          if (!taskDef || typeof taskDef !== 'object') {
            continue;
          }
          const taskVarDefaults = {
            ...fileLevelVarDefaults,
            ...this.extractVarDefaults((taskDef as Record<string, unknown>)['vars']),
          };
          if (Object.keys(taskVarDefaults).length > 0) {
            info.taskVarDefaults.set(taskName, taskVarDefaults);
          }

          const requires = (taskDef as Record<string, unknown>)['requires'];
          if (!requires || typeof requires !== 'object') {
            continue;
          }
          const vars = (requires as Record<string, unknown>)['vars'];
          if (!Array.isArray(vars)) {
            continue;
          }

          const requiredVars: TaskfileRequiredVar[] = [];
          for (const varEntry of vars) {
            if (typeof varEntry === 'string') {
              const name = varEntry.trim();
              if (!name || name === TEMPLATE_PLACEHOLDER) {
                continue;
              }
              requiredVars.push({ name });
              continue;
            }

            if (!varEntry || typeof varEntry !== 'object' || Array.isArray(varEntry)) {
              continue;
            }

            const obj = varEntry as Record<string, unknown>;
            const rawName = obj['name'];
            if (typeof rawName !== 'string' || rawName.trim().length === 0) {
              continue;
            }
            const name = rawName.trim();
            if (name === TEMPLATE_PLACEHOLDER) {
              continue;
            }

            const rawEnum = obj['enum'];
            const enumValues = Array.isArray(rawEnum)
              ? rawEnum
                .filter((v): v is string => typeof v === 'string')
                .map((v) => v.trim())
                .filter((v) => v.length > 0 && v !== TEMPLATE_PLACEHOLDER)
              : undefined;

            requiredVars.push({
              name,
              ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
            });
          }

          if (requiredVars.length > 0) {
            info.tasks.set(taskName, requiredVars);
          }
        }
      }
    } catch (err: unknown) {
      LoggerService.getInstance().debug(
        `[taskfile] Failed to parse YAML for required vars detection in '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.requiredVarsCache.set(filePath, info);
    return info;
  }

  private detectCLIArgsTasksFromRawYaml(content: string, result: Set<string>): void {
    const lines = content.split(/\r?\n/);
    let inTasks = false;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const indent = line.length - line.trimStart().length;

      if (!inTasks) {
        if (/^tasks\s*:\s*$/.test(trimmed)) {
          inTasks = true;
        }
        continue;
      }

      if (indent === 0 && !/^tasks\s*:\s*$/.test(trimmed)) {
        break;
      }

      const taskMatch = line.match(/^(\s+)([^:#][^:]*)\s*:\s*$/);
      if (!taskMatch) {
        continue;
      }

      const taskIndent = taskMatch[1].length;
      const taskName = taskMatch[2].trim();
      let inCmds = false;
      let cmdsIndent = -1;

      for (index += 1; index < lines.length; index++) {
        const taskLine = lines[index];
        const taskTrimmed = taskLine.trim();
        if (!taskTrimmed || taskTrimmed.startsWith('#')) {
          continue;
        }

        const taskLineIndent = taskLine.length - taskLine.trimStart().length;
        if (taskLineIndent <= taskIndent) {
          index -= 1;
          break;
        }

        if (!inCmds) {
          if (taskLineIndent > taskIndent && /^cmds\s*:\s*$/.test(taskTrimmed)) {
            inCmds = true;
            cmdsIndent = taskLineIndent;
          }
          continue;
        }

        if (taskLineIndent <= cmdsIndent) {
          inCmds = false;
          cmdsIndent = -1;
          if (taskLineIndent > taskIndent && /^cmds\s*:\s*$/.test(taskTrimmed)) {
            inCmds = true;
            cmdsIndent = taskLineIndent;
          }
          continue;
        }

        if (this.cliArgsTaskPattern.test(taskTrimmed)) {
          result.add(taskName);
          break;
        }
      }
    }
  }

  private async _loadTasksFromDirectory(
    dir: string,
    representativeFile: vscode.Uri,
    iconService: TaskIconService,
  ): Promise<TaskItem[]> {
    const { command, args } = this.getCommand(representativeFile);
    const cmdArgs = [...(args ?? []), '--taskfile', representativeFile.fsPath, '--list-all', '--no-status', '--json'];

    let yamlContent: string | undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(representativeFile);
      yamlContent = new TextDecoder().decode(bytes);
    } catch { /* non-fatal */ }

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd: dir, timeout: 10000 });
      return this.parseOutput(stdout, dir, iconService, representativeFile.fsPath, yamlContent);
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to list tasks in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Parses the JSON output from `taskfile --list-all --no-status --json` into `TaskItem` instances.
   * Extracted as a public method to enable direct unit-testing without spawning a process.
   *
   * @param taskfilePath  Optional path to the Taskfile on disk. Used to detect `{{.CLI_ARGS}}`.
   * @param yamlContent   Optional raw YAML content of the Taskfile. Used to detect `{{.CLI_ARGS}}`.
   */
  public parseOutput(
    stdout: string,
    dir: string,
    iconService?: TaskIconService,
    taskfilePath?: string,
    yamlContent?: string,
  ): TaskItem[] {
    let output: TaskJsonOutput;
    try {
      output = JSON.parse(stdout) as TaskJsonOutput;
    } catch (parseErr: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to parse JSON output from ${dir}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
      return [];
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const tasks: TaskItem[] = [];
    const fallbackUri = vscode.Uri.file(path.join(dir, 'Taskfile.yml'));
    const iconPath = svc.getTaskIcon('taskfile', fallbackUri);
    const showAliases = vscode.workspace.getConfiguration('workspaceTasks').get<boolean>('taskfile.showAliases', true);

    // Detect {{.CLI_ARGS}} tasks from YAML when content is available
    const cliArgsSet: Set<string> = taskfilePath && yamlContent
      ? this.detectCLIArgsTasks(taskfilePath, yamlContent)
      : new Set<string>();
    const requiredVarsInfo: RequiredVarsInfo = taskfilePath && yamlContent
      ? this.detectRequiredVars(taskfilePath, yamlContent)
      : { tasks: new Map<string, TaskfileRequiredVar[]>(), taskVarDefaults: new Map<string, Record<string, string>>() };

    for (const entry of output.tasks ?? []) {
      const taskFileUri = entry.location?.taskfile
        ? vscode.Uri.file(entry.location.taskfile)
        : fallbackUri;
      const aliases = entry.aliases ?? [];
      const hasAliases = showAliases && aliases.length > 0;

      const item = new TaskItem(
        entry.name,
        hasAliases ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        'taskfile',
        taskFileUri,
        undefined,
        iconPath,
      );
      item.taskFileUri = taskFileUri;
      // description: relative path shown in tree view (consistent with other file-based providers)
      item.description = vscode.workspace.asRelativePath(taskFileUri);
      item.startLine = entry.location?.line ? entry.location.line - 1 : 0;

      // Wildcard detection
      const wildcardCount = (entry.name.match(/\*/g) ?? []).length;
      const isWildcardTask = wildcardCount > 0;

      // CLI_ARGS detection
      const hasCLIArgs = cliArgsSet.has(entry.name);
      const requiredVars = requiredVarsInfo.tasks.get(entry.name) ?? [];
      const predefinedVarValues = requiredVarsInfo.taskVarDefaults.get(entry.name);

      // tooltip: the human-readable task description from the Taskfile
      if (isWildcardTask) {
        item.tooltip = `${entry.desc || entry.name}\n\nWildcard task — you will be prompted for each * when running.`;
      } else {
        item.tooltip = entry.desc || entry.name;
      }
      if (requiredVars.length > 0 && typeof item.tooltip === 'string') {
        const varNames = requiredVars.map((v) => v.name).join(', ');
        item.tooltip += `\n\nRequires variables: ${varNames}`;
      }

      item.metadata = {
        aliases,
        summary: entry.summary ?? '',
        ...(isWildcardTask ? { isWildcardTask: true, wildcardCount } : {}),
        ...(hasCLIArgs ? { hasCLIArgs: true } : {}),
        ...(requiredVars.length > 0 ? { requiredVars } : {}),
        ...(predefinedVarValues ? { predefinedVarValues } : {}),
      };
      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [taskFileUri, item.startLine],
      };

      if (hasAliases) {
        for (const alias of aliases) {
          const aliasItem = new TaskItem(
            alias,
            vscode.TreeItemCollapsibleState.None,
            'taskfile',
            taskFileUri,
            undefined,
            iconPath,
          );
          aliasItem.taskFileUri = taskFileUri;
          aliasItem.description = vscode.workspace.asRelativePath(taskFileUri);
          aliasItem.tooltip = `Alias for: ${entry.name}`;
          aliasItem.startLine = item.startLine;
          // Wildcard detection for alias
          const aliasWildcardCount = (alias.match(/\*/g) ?? []).length;
          const isAliasWildcardTask = aliasWildcardCount > 0;
          aliasItem.metadata = {
            isAlias: true,
            primaryTask: entry.name,
            ...(isAliasWildcardTask ? { isWildcardTask: true, wildcardCount: aliasWildcardCount } : {}),
            ...(hasCLIArgs ? { hasCLIArgs: true } : {}),
            ...(requiredVars.length > 0 ? { requiredVars } : {}),
            ...(predefinedVarValues ? { predefinedVarValues } : {}),
          };
          aliasItem.onOpenActionCommand = {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open File',
            arguments: [taskFileUri, item.startLine],
          };
          aliasItem.parent = item;
          item.children.push(aliasItem);
        }
      }

      tasks.push(item);
    }
    return tasks;
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      this.disposeGlobalTaskfileWatchers();
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[TaskfileTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const discoverGlobal = config.get<boolean>('taskfile.discoverGlobalTaskfile', false);
    if (!discoverGlobal) {
      this.disposeGlobalTaskfileWatchers();
      return [];
    }

    const homeDir = this.getHomeDir();
    const variants = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];
    const globalTaskfilePath = variants.map((v) => path.join(homeDir, v)).find((p) => this.fileExists(p));

    // Keep watcher coverage current even when no global Taskfile exists yet.
    this.reconcileGlobalTaskfileWatchers(homeDir, globalTaskfilePath);

    if (!globalTaskfilePath) {
      return [];
    }

    const iconService = TaskIconService.getInstance();
    const { command, args } = this.getCommand(vscode.Uri.file(globalTaskfilePath));
    const cmdArgs = [...(args ?? []), '--taskfile', globalTaskfilePath, '--list-all', '--no-status', '--json'];

    let globalYamlContent: string | undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalTaskfilePath));
      globalYamlContent = new TextDecoder().decode(bytes);
    } catch { /* non-fatal */ }

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd: homeDir, timeout: 10000 });
      const items = this.parseOutput(stdout, homeDir, iconService, globalTaskfilePath, globalYamlContent);

      for (const item of items) {
        item.metadata = {
          ...(item.metadata ?? {}),
          isGlobalTask: true,
          globalTaskfilePath,
        };
      }

      return items;
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[taskfile] Failed to list global tasks in ${homeDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async createTask(
    item: TaskItem,
    args?: string,
    resolvedLabel?: string,
    varAssignments?: string[],
  ): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = resolvedLabel ?? (item.originalLabel || item.label as string);
    const { command: taskCmd, args: taskInitialArgs, cwd: taskCwd } = this.getCommand(workspaceFolder?.uri);

    const taskArgs = taskInitialArgs ? [...taskInitialArgs] : [];
    const globalTaskfilePath = typeof item.metadata?.globalTaskfilePath === 'string'
      ? item.metadata.globalTaskfilePath
      : undefined;

    if (globalTaskfilePath) {
      taskArgs.push('--taskfile', globalTaskfilePath);
    } else if (item.taskFileUri) {
      taskArgs.push('--taskfile', item.taskFileUri.fsPath);
    }

    taskArgs.push(taskLabel);

    if (Array.isArray(varAssignments) && varAssignments.length > 0) {
      taskArgs.push(...varAssignments);
    }

    const hasArgs = args !== undefined && args.trim().length > 0;
    if (hasArgs && item.metadata?.hasCLIArgs === true) {
      taskArgs.push('--', ...splitArgs(args!));
    } else {
      taskArgs.push(...splitArgs(args));
    }

    const full = `${taskCmd} ${taskArgs.join(' ')}`;
    const taskFileCwd = item.taskFileUri ? path.dirname(item.taskFileUri.fsPath) : taskCwd;
    const shellExec = new vscode.ShellExecution(taskCmd, taskArgs, { cwd: taskFileCwd });

    const task = new vscode.Task(
      { type: 'taskfile', task: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'taskfile',
      shellExec,
    );
    return { task, command: full, cwd: taskFileCwd, native: false };
  }
}
