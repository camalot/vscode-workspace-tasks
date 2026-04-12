import * as vscode from 'vscode';
import micromatch from 'micromatch';

export class TaskConfigService {
  private static instance: TaskConfigService;

  /**
   * Mapping from internal task type names (as used by providers) to their
   * corresponding config keys in `workspaceTasks.enabledTaskTypes`.
   *
   * Multiple internal names may share a config key (e.g., `dockerfile` and
   * `docker-compose` both map to `docker`).
   *
   * NOTE: `pwsh` and `python` are intentionally omitted — these are shell sub-types
   * controlled by `shellEnabledTaskTypes`, not `enabledTaskTypes`. Including them
   * would cause the `"*": false` sentinel to incorrectly block shell script tasks.
   */
  private static readonly taskTypeMap: Record<string, string> = {
    ant: 'ant',
    bun: 'bun',
    cake: 'cake',
    cargo: 'cargo',
    'cargo-make': 'cargo-make',
    cmake: 'cmake',
    composer: 'composer',
    deno: 'deno',
    dockerfile: 'docker',
    'docker-compose': 'docker',
    eslint: 'eslint',
    'github-action': 'github-actions',
    'github-actions': 'github-actions',
    go: 'go',
    gradle: 'gradle',
    grunt: 'grunt',
    gulp: 'gulp',
    jupyter: 'jupyter',
    justfile: 'just',
    makefile: 'make',
    maven: 'maven',
    mise: 'mise',
    msbuild: 'msbuild',
    npm: 'npm',
    pipenv: 'pipenv',
    pnpm: 'pnpm',
    poe: 'poe',
    poetry: 'poetry',
    rake: 'rake',
    ruby: 'ruby',
    shell: 'shell',
    tsc: 'typescript',        // alias: internal 'tsc' → config key 'typescript'
    typescript: 'typescript',
    venv: 'venv',
    vscode: 'vscode',
    webpack: 'webpack',
    workspace: 'workspace',
    'workspace-task': 'workspace',
    yarn: 'yarn',
  };

  private constructor() {}

  public static getInstance(): TaskConfigService {
    if (!TaskConfigService.instance) {
      TaskConfigService.instance = new TaskConfigService();
    }
    return TaskConfigService.instance;
  }

  /**
   * Check if a task type is enabled in the configuration.
   *
   * Precedence (highest to lowest):
   * 1. `enabledTaskTypePatterns` non-empty + match → enabled (wins over everything)
   * 2. `enabledTaskTypePatterns` non-empty + no match → disabled
   * 3. `disabledTaskTypePatterns` non-empty + match → disabled
   * 4. `enabledTaskTypes[configKey]` boolean → opt-out default
   *
   * @param taskType The task type to check (e.g., 'npm', 'vscode', 'workspace', 'dockerfile')
   * @returns true if the task type is enabled, false otherwise
   */
  public isTaskTypeEnabled(taskType: string): boolean {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const enabledTaskTypes = config.get<Record<string, boolean>>('enabledTaskTypes', {});
    const enabledPatterns = config.get<string[]>('enabledTaskTypePatterns', []);
    const disabledPatterns = config.get<string[]>('disabledTaskTypePatterns', []);

    // Normalise to the visible config-key so patterns and enabledTaskTypes always refer to the
    // same name (e.g. 'docker' for both 'dockerfile' and 'docker-compose', 'make' for 'makefile').
    const configKey = TaskConfigService.taskTypeMap[taskType] ?? taskType;

    // Steps 1 & 2: enabledTaskTypePatterns non-empty → acts as a whitelist (highest priority).
    // IMPORTANT: the length guard is load-bearing. micromatch.isMatch(x, []) always
    // returns false, so omitting it would disable ALL types when patterns are empty.
    // When non-empty, this step always wins — including over disabledTaskTypePatterns.
    if (enabledPatterns.length > 0) {
      return micromatch.isMatch(configKey, enabledPatterns);
    }

    // Step 3: disabledTaskTypePatterns matches → disabled.
    // Only evaluated when enabledTaskTypePatterns is empty.
    if (disabledPatterns.length > 0 && micromatch.isMatch(configKey, disabledPatterns)) {
      return false;
    }

    // Step 4: fall back to enabledTaskTypes boolean (opt-out behavior).
    return enabledTaskTypes[configKey] !== false;
  }

  /**
   * Check if multiple task types are enabled
   * @param taskTypes Array of task types to check
   * @returns true if at least one task type is enabled, false if all are disabled
   */
  public isAnyTaskTypeEnabled(taskTypes: string[]): boolean {
    return taskTypes.some((type) => this.isTaskTypeEnabled(type));
  }

  /**
   * Check if all task types are enabled
   * @param taskTypes Array of task types to check
   * @returns true if all task types are enabled, false otherwise
   */
  public areAllTaskTypesEnabled(taskTypes: string[]): boolean {
    return taskTypes.every((type) => this.isTaskTypeEnabled(type));
  }
}
