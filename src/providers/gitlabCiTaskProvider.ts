import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { LoggerService } from '../services/loggerService';
import { CreatedTask, splitArgs } from '../libs/taskCreationUtils';

const execFileAsync = promisify(execFile);

interface GitlabCiJobEntry {
  name: string;
  description?: string;
  stage: string;
  when: string;
  allow_failure: boolean;
  needs?: Array<{ job: string; artifacts: boolean; optional: boolean }>;
  rules?: Array<{ if?: string; when?: string }>;
}

export class GitlabCiTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('gitlab-ci', constants.GLOB_GITLAB_CI);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.gitlabCiLocal',
        defaultValue: 'gitlab-ci-local',
        configName: 'gitlab-ci-local',
        resolveToAbsolutePath: false,
        // Not a Windows-native tool — do not append .exe
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[GitlabCiTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const extraPatterns = config.get<string[]>('gitlabCiLocal.additionalFilePatterns', []);
    const globs = [constants.GLOB_GITLAB_CI, ...extraPatterns];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles(globs);
    const results = await Promise.all(files.map((f) => this._loadJobsFromFile(f)));
    return results.flat();
  }

  private async _loadJobsFromFile(file: vscode.Uri): Promise<TaskItem[]> {
    const { command, args: providerArgs } = this.getCommand(file);
    const cmdArgs = [...(providerArgs ?? []), '--file', path.basename(file.fsPath), '--list-json'];
    const cwd = path.dirname(file.fsPath);

    try {
      const { stdout } = await execFileAsync(command, cmdArgs, { cwd, timeout: 15000 });
      let fileLines: string[] | undefined;
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        fileLines = doc.getText().split(/\r?\n/);
      } catch {
        // If the file can't be opened for reading, startLine will be undefined
      }
      return this.parseOutput(stdout, file, undefined, fileLines);
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[gitlab-ci] Failed to list jobs in ${file.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /** Known GitLab CI reserved top-level YAML keys that can never be job definition lines. */
  private static readonly GITLAB_RESERVED_KEYS = new Set([
    'image', 'services', 'stages', 'types', 'before_script', 'after_script',
    'variables', 'cache', 'default', 'workflow', 'include',
  ]);

  /**
   * Scans YAML file lines for the line index of a job definition at column 0.
   * Returns `undefined` when the job name is a reserved key or is not found.
   * Extracted for unit testing.
   */
  public findJobLineNumber(lines: string[], jobName: string): number | undefined {
    if (GitlabCiTaskProvider.GITLAB_RESERVED_KEYS.has(jobName)) {
      return undefined;
    }
    const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) { return i; }
    }
    return undefined;
  }

  /**
   * Parses the JSON array output of `gitlab-ci-local --list-json`.
   * Extracted as public for direct unit testing without spawning a process.
   */
  public parseOutput(stdout: string, fileUri: vscode.Uri, iconService?: TaskIconService, fileLines?: string[]): TaskItem[] {
    let entries: GitlabCiJobEntry[];
    try {
      entries = JSON.parse(stdout) as GitlabCiJobEntry[];
    } catch (parseErr: unknown) {
      LoggerService.getInstance().warn(
        `[gitlab-ci] JSON parse error for ${fileUri.fsPath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
      return [];
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const iconPath = svc.getTaskIcon('gitlab-ci', fileUri);

    // Parent item (file-level, collapsible, not directly runnable)
    const parentItem = new TaskItem(
      path.basename(fileUri.fsPath),
      vscode.TreeItemCollapsibleState.Collapsed,
      'gitlab-ci',
      fileUri,
      undefined,
      iconPath,
    );
    parentItem.description = vscode.workspace.asRelativePath(fileUri);
    parentItem.taskFileUri = fileUri;
    parentItem.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    parentItem.children = [];

    for (const entry of entries) {
      // Filter intentionally-disabled jobs
      if (entry.when === 'never') {
        continue;
      }

      const tooltipParts: string[] = [
        entry.description ?? entry.name,
        `Stage: ${entry.stage}`,
        `When: ${entry.when}`,
      ];
      if (entry.allow_failure) {
        tooltipParts.push('Allow failure: yes');
      }
      if (entry.needs && entry.needs.length > 0) {
        tooltipParts.push(`Needs: ${entry.needs.map((n) => n.job).join(', ')}`);
      }

      const jobItem = new TaskItem(
        entry.name,
        vscode.TreeItemCollapsibleState.None,
        'gitlab-ci',
        fileUri,
        undefined,
        iconPath,
      );
      jobItem.taskFileUri = fileUri; // required for factory cwd resolution
      jobItem.description = entry.stage;
      jobItem.tooltip = tooltipParts.join('\n');
      jobItem.startLine = fileLines ? this.findJobLineNumber(fileLines, entry.name) : undefined;
      jobItem.metadata = {
        stage: entry.stage,
        when: entry.when,
        allowFailure: entry.allow_failure,
        needs: entry.needs ?? [],
        rules: entry.rules ?? [],
      };
      jobItem.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, jobItem.startLine ?? 0],
      };
      parentItem.children.push(jobItem);
    }

    // Only emit the parent if it has at least one runnable child
    if (parentItem.children.length === 0) {
      return [];
    }
    return [parentItem];
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    if (!item.taskFileUri) {
      return undefined;
    }

    const taskLabel = item.originalLabel || item.label;
    const { command: ciCmd, args: providerArgs } = this.getCommand(item.taskFileUri);
    const ciArgs = [...(providerArgs ?? [])];
    const effectiveFileUri = item.taskFileUri;
    ciArgs.push('--file', path.basename(effectiveFileUri.fsPath));

    const ciConfig = vscode.workspace.getConfiguration('workspaceTasks');
    const variablesFile = ciConfig.get<string>('gitlabCiLocal.variablesFile', '');
    if (variablesFile) {
      ciArgs.push('--variables-file', variablesFile);
    }
    const variables = ciConfig.get<string[]>('gitlabCiLocal.variable', []);
    for (const v of variables) {
      ciArgs.push('--variable', v);
    }
    const unsetVars = ciConfig.get<string[]>('gitlabCiLocal.unsetVariable', []);
    for (const u of unsetVars) {
      ciArgs.push('--unset-variable', u);
    }
    const remoteVars = ciConfig.get<string[]>('gitlabCiLocal.remoteVariables', []);
    for (const r of remoteVars) {
      ciArgs.push('--remote-variables', r);
    }
    const home = ciConfig.get<string>('gitlabCiLocal.home', '');
    if (home) {
      ciArgs.push('--home', home);
    }

    ciArgs.push(taskLabel, ...splitArgs(args));

    const ciCwd = path.dirname(effectiveFileUri.fsPath);
    const shellExec = new vscode.ShellExecution(ciCmd, ciArgs, { cwd: ciCwd });
    const full = `${ciCmd} ${ciArgs.join(' ')}`;
    const task = new vscode.Task(
      { type: 'gitlab-ci', job: taskLabel, path: effectiveFileUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'gitlab-ci',
      shellExec,
    );
    return { task, command: full, cwd: ciCwd, native: false };
  }
}
