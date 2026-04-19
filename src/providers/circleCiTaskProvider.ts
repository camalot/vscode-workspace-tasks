import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'yaml';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableResult, ExecutableService } from '../services/executableService';
import { LoggerService } from '../services/loggerService';

interface CircleCiConfig {
  jobs?: Record<string, any>;
  workflows?: Record<string, any>;
}

interface CircleWorkflowEntry {
  name: string;
  jobs: string[];
  line: number;
}

export class CircleCiTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('circleci', constants.GLOB_CIRCLECI);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.circleci',
        defaultValue: 'circleci',
        configName: 'circleci',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const extraPatterns = config.get<string[]>('circleci.additionalFilePatterns', []);
    const globs = [constants.GLOB_CIRCLECI, ...extraPatterns];

    const files = await TaskFilesService.getInstance().findFiles(globs);
    const tasks: TaskItem[] = [];

    for (const file of files) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(content).toString('utf8');
        const parsed = this.parseConfig(file, text);
        if (parsed) {
          tasks.push(parsed);
        }
      } catch (err: unknown) {
        LoggerService.getInstance().warn(
          `[circleci] Failed to read ${file.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return tasks;
  }

  public parseConfig(fileUri: vscode.Uri, text: string, iconService?: TaskIconService): TaskItem | undefined {
    let config: CircleCiConfig;
    try {
      config = yaml.parse(text) as CircleCiConfig;
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[circleci] Failed to parse YAML in ${fileUri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }

    const allJobs = config.jobs ? Object.keys(config.jobs) : [];
    if (allJobs.length === 0) {
      return undefined;
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const iconPath = svc.getTaskIcon('circleci', fileUri);
    const lines = text.split(/\r?\n/);

    const fileItem = new TaskItem(
      path.basename(fileUri.fsPath),
      vscode.TreeItemCollapsibleState.Collapsed,
      'circleci',
      fileUri,
      undefined,
      iconPath,
    );
    fileItem.iconPath = iconPath;
    fileItem.description = vscode.workspace.asRelativePath(fileUri);
    fileItem.taskFileUri = fileUri;
    fileItem.metadata = { type: 'file' };
    fileItem.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    fileItem.children = [];

    const workflows = this.extractWorkflows(config.workflows, lines);

    for (const workflow of workflows) {
      const workflowItem = new TaskItem(
        `workflow: ${workflow.name}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'circleci',
        fileUri,
        undefined,
        iconPath,
      );
      workflowItem.taskFileUri = fileUri;
      workflowItem.description = `${workflow.jobs.length} job${workflow.jobs.length === 1 ? '' : 's'}`;
      workflowItem.startLine = workflow.line;
      workflowItem.metadata = {
        type: 'workflow',
        workflowName: workflow.name,
        workflowJobs: workflow.jobs,
      };
      workflowItem.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open Workflow',
        arguments: [fileUri, workflow.line],
      };
      workflowItem.onRunActionCommand = {
        command: 'workspaceTasks.runTask',
        title: 'Run Workflow',
        arguments: [workflowItem],
      };
      workflowItem.command = {
        command: 'workspaceTasks.onTreeItemClick',
        title: 'On Tree Item Click',
        arguments: [workflowItem],
      };

      workflowItem.children = workflow.jobs.map((jobName) =>
        this.createJobTaskItem(jobName, fileUri, lines, iconPath, workflow.name),
      );
      for (const child of workflowItem.children) {
        child.parent = workflowItem;
      }
      fileItem.children.push(workflowItem);
      workflowItem.parent = fileItem;
    }

    if (allJobs.length > 0) {
      const jobsGroup = new TaskItem(
        'jobs',
        vscode.TreeItemCollapsibleState.Collapsed,
        'folder',
        fileUri,
        undefined,
        iconPath,
      );
      jobsGroup.taskFileUri = fileUri;
      jobsGroup.iconPath = iconPath;
      jobsGroup.children = allJobs.map((jobName) =>
        this.createJobTaskItem(jobName, fileUri, lines, iconPath),
      );
      for (const child of jobsGroup.children) {
        child.parent = jobsGroup;
      }
      fileItem.children.push(jobsGroup);
      jobsGroup.parent = fileItem;
    }

    return fileItem.children.length > 0 ? fileItem : undefined;
  }

  private createJobTaskItem(
    jobName: string,
    fileUri: vscode.Uri,
    lines: string[],
    iconPath: string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined,
    workflowName?: string,
  ): TaskItem {
    const lineNo = this.findKeyLine(lines, jobName);
    const item = new TaskItem(
      jobName,
      vscode.TreeItemCollapsibleState.None,
      'circleci',
      fileUri,
      undefined,
      iconPath,
    );
    item.taskFileUri = fileUri;
    item.startLine = lineNo;
    item.metadata = {
      type: 'job',
      jobName,
      workflowName,
    };
    item.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open Job',
      arguments: [fileUri, lineNo],
    };
    return item;
  }

  private extractWorkflows(workflows: Record<string, any> | undefined, lines: string[]): CircleWorkflowEntry[] {
    if (!workflows || typeof workflows !== 'object') {
      return [];
    }

    const entries: CircleWorkflowEntry[] = [];
    for (const [workflowName, workflowValue] of Object.entries(workflows)) {
      if (workflowName === 'version') {
        continue;
      }

      const workflowJobs: string[] = [];
      const jobs = (workflowValue as any)?.jobs;
      if (Array.isArray(jobs)) {
        for (const entry of jobs) {
          if (typeof entry === 'string') {
            workflowJobs.push(entry);
          } else if (entry && typeof entry === 'object') {
            const firstKey = Object.keys(entry)[0];
            if (firstKey) {
              workflowJobs.push(firstKey);
            }
          }
        }
      }

      if (workflowJobs.length === 0) {
        continue;
      }

      entries.push({
        name: workflowName,
        jobs: workflowJobs,
        line: this.findKeyLine(lines, workflowName),
      });
    }

    return entries;
  }

  private findKeyLine(lines: string[], key: string): number {
    const idx = lines.findIndex((line) => line.trim().startsWith(`${key}:`));
    return idx >= 0 ? idx : 0;
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }
}
