import * as vscode from 'vscode';

export class TaskConfigService {
  private static instance: TaskConfigService;

  private constructor() {}

  public static getInstance(): TaskConfigService {
    if (!TaskConfigService.instance) {
      TaskConfigService.instance = new TaskConfigService();
    }
    return TaskConfigService.instance;
  }

  /**
   * Check if a task type is enabled in the configuration
   * @param taskType The task type to check (e.g., 'npm', 'vscode', 'workspace', 'dockerfile')
   * @returns true if the task type is enabled, false otherwise
   */
  public isTaskTypeEnabled(taskType: string): boolean {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const enabledTaskTypes = config.get<Record<string, boolean>>('enabledTaskTypes', {});

    // Map task type names to config keys
    const taskTypeMap: Record<string, string> = {
      ant: 'ant',
      dockerfile: 'docker',
      composer: 'composer',
      'github-actions': 'github-actions',
      'github-action': 'github-actions',
      gulp: 'gulp',
      grunt: 'grunt',
      jupyter: 'jupyter',
      justfile: 'just',
      makefile: 'make',
      maven: 'maven',
      mise: 'mise',
      msbuild: 'msbuild',
      npm: 'npm',
      vscode: 'vscode',
      pipenv: 'pipenv',
      pwsh: 'pwsh',
      python: 'python',
      shell: 'shell',
      venv: 'venv',
      workspace: 'workspace',
      'workspace-task': 'workspace',
    };

    const configKey = taskTypeMap[taskType] || taskType;

    // If not explicitly set, default to true
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
