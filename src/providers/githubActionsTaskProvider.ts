import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'yaml';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: string;
  type?: string;
}

interface WorkflowDispatch {
  inputs?: Record<string, WorkflowInput>;
}

interface Workflow {
  name?: string;
  on?: string | string[] | Record<string, any>;
  jobs?: Record<string, any>;
}

export class GithubActionsTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('github-actions', constants.GLOB_GITHUB_ACTIONS);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.act',
        defaultValue: 'act',
        configName: 'act',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const files = await filesService.findFiles([constants.GLOB_GITHUB_ACTIONS]);

    for (const file of files) {
      const content = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(content).toString('utf8');

      const fileTasks = this.parseWorkflowFile(file, text);
      if (fileTasks) {
        tasks.push(fileTasks);
      }
    }
    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  private async collectWorkflowDispatchInputs(inputs: string[] | Record<string, any>): Promise<string[]> {
    const collected: string[] = [];
    if (Array.isArray(inputs)) {
      for (const input of inputs) {
        const val = await vscode.window.showInputBox({
          prompt: `Enter input for '${input}'`,
          placeHolder: 'Value',
          ignoreFocusOut: true,
        });
        if (val) {
          collected.push('--input', `${input}=${val}`);
        }
      }
      return collected;
    }

    for (const [key, details] of Object.entries(inputs)) {
      const desc = (details as any).description || `Enter value for ${key}`;
      const defaultVal = (details as any).default !== undefined ? String((details as any).default) : '';
      const required = (details as any).required || false;

      const val = await vscode.window.showInputBox({
        prompt: desc,
        placeHolder: `${key} (${(details as any).type || 'string'})`,
        value: defaultVal,
        ignoreFocusOut: true,
        validateInput: (text) => {
          if (required && !text) {
            return 'This input is required';
          }
          return null;
        },
      });

      if (val) {
        collected.push('--input', `${key}=${val}`);
      }
    }
    return collected;
  }

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = item.originalLabel || item.label;
    let { command: actPath, args: actInitialArgs, cwd: actCwd } = this.getCommand(workspaceFolder?.uri);

    const githubDirMatch = resourceUri.fsPath.match(/[\\/]\.github[\\/]/);
    if (githubDirMatch) {
      const projectRoot = resourceUri.fsPath.substring(0, githubDirMatch.index);
      if (projectRoot) {
        actCwd = projectRoot;
      }
    }

    const meta = item.metadata;
    const actArgs: string[] = actInitialArgs ? [...actInitialArgs] : [];
    const config = vscode.workspace.getConfiguration('workspaceTasks');

    if (meta?.type === 'workflow') {
      if (meta.event === 'workflow_dispatch' && meta.inputs) {
        actArgs.push(...await this.collectWorkflowDispatchInputs(meta.inputs as string[] | Record<string, any>));
        actArgs.push('workflow_dispatch');
      } else {
        actArgs.push(meta.event || 'push');
      }

      const envFile = config.get<string>('act.envFile');
      if (envFile) {
        actArgs.push('--env-file', envFile);
      }

      const varsFile = config.get<string>('act.variablesFile');
      if (varsFile) {
        actArgs.push('--var-file', varsFile);
      }

      const secretsFile = config.get<string>('act.secretsFile');
      if (secretsFile) {
        actArgs.push('--secret-file', secretsFile);
      }

      const vars = config.get<Record<string, string>>('act.variables');
      if (vars) {
        for (const [key, value] of Object.entries(vars)) {
          actArgs.push('--var', `${key}=${value}`);
        }
      }

      const relPath = path.relative(actCwd, resourceUri.fsPath);
      actArgs.push('-W', relPath);
    } else if (meta?.type === 'job') {
      actArgs.push('-j', meta.jobId);
      const relPath = path.relative(actCwd, resourceUri.fsPath);
      actArgs.push('-W', relPath);
    } else {
      let useEvent = 'push';
      if (meta?.type === 'file' && meta?.events) {
        const events = meta.events as string[];
        if (events.length > 0) {
          const selected = await vscode.window.showQuickPick(events, {
            placeHolder: 'Select event to trigger',
          });
          if (selected) {
            useEvent = selected;
          } else {
            return undefined;
          }
        }
      }

      if (useEvent === 'workflow_dispatch' && meta?.inputs) {
        actArgs.push(...await this.collectWorkflowDispatchInputs(meta.inputs as string[] | Record<string, any>));
      }

      actArgs.push(useEvent);
      const relPath = path.relative(actCwd, resourceUri.fsPath);
      actArgs.push('-W', relPath);
    }

    actArgs.push(...splitArgs(args));

    const task = new vscode.Task(
      { type: 'github-actions', task: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'github-actions',
      new vscode.ShellExecution(actPath, actArgs, { cwd: actCwd }),
    );
    const safeCmd = /\s/.test(actPath) ? `"${actPath}"` : actPath;
    const full = `${safeCmd} ${actArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
    return { task, command: full, cwd: actCwd, native: false };
  }

  private parseWorkflowFile(uri: vscode.Uri, text: string): TaskItem | undefined {
    let workflow: Workflow;
    try {
      workflow = yaml.parse(text) as Workflow;
    } catch (e) {
      return undefined;
    }

    const filename = path.basename(uri.fsPath);
    const iconService = TaskIconService.getInstance();
    const typeIcon = iconService.getTaskIcon(this.type);

    const workflowItem = new TaskItem(
      workflow.name || filename,
      vscode.TreeItemCollapsibleState.Collapsed,
      this.type,
      uri,
      undefined,
      typeIcon,
    );

    workflowItem.startLine = 0;
    workflowItem.children = [];

    // Split lines once for line-number lookups used by both events and jobs
    const lines = text.split(/\r?\n/);
    // Find the on: block at column 0
    const onLineIndex = lines.findIndex((l) => /^on\s*:/.test(l));

    // Parse Events
    const events: string[] = [];
    if (typeof workflow.on === 'string') {
      events.push(workflow.on);
    } else if (Array.isArray(workflow.on)) {
      events.push(...workflow.on);
    } else if (typeof workflow.on === 'object') {
      events.push(...Object.keys(workflow.on));
    }

    // Capture generic metadata for the file-level item
    let fileMetadata: any = { type: 'file', events };

    // Add Tasks for Events
    for (const event of events) {
      // Find the specific event key as a direct child of on: (2-space indent)
      const eventLineIndex = lines.findIndex(
        (l, i) =>
          i > onLineIndex &&
          /^  \S/.test(l) &&
          l.trimStart().startsWith(`${event}:`),
      );
      const eventLine =
        eventLineIndex >= 0 ? eventLineIndex :
        onLineIndex >= 0    ? onLineIndex    : 0;

      const item = new TaskItem(
        `Run Workflow (${event})`,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        uri,
        {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open Workflow',
          arguments: [uri, eventLine],
        },
        typeIcon,
      );
      item.startLine = eventLine;

      let metadata: any = { type: 'workflow', event };

      // Parse Inputs for workflow_dispatch
      if (event === 'workflow_dispatch' && typeof workflow.on === 'object' && !Array.isArray(workflow.on)) {
        const dispatch = workflow.on['workflow_dispatch'] as WorkflowDispatch;
        if (dispatch && dispatch.inputs) {
          metadata.inputs = dispatch.inputs;
          // Add inputs to file metadata as well for 'workflow_dispatch' reuse
          if (fileMetadata.events.includes('workflow_dispatch')) {
            fileMetadata.inputs = dispatch.inputs;
          }
        }
      }

      item.metadata = metadata;
      workflowItem.children.push(item);
    }

    workflowItem.metadata = fileMetadata;

    // Parse Jobs
    if (workflow.jobs) {
      // Find the jobs: key at column 0 so we can restrict the job search to its direct children
      const jobsLineIndex = lines.findIndex((l) => /^jobs\s*:/.test(l));

      for (const [jobId, _] of Object.entries(workflow.jobs)) {
        // Find the job key as a direct child of jobs: (exactly 2-space indent)
        const lineNo = lines.findIndex(
          (l, i) =>
            i > jobsLineIndex &&
            /^  \S/.test(l) &&
            l.trimStart().startsWith(`${jobId}:`),
        );

        const jobItem = new TaskItem(
          `Run Job: ${jobId}`,
          vscode.TreeItemCollapsibleState.None,
          this.type,
          uri,
          {
            command: 'workspaceTasks.openFileAtLine',
            title: 'Open Job',
            arguments: [uri, lineNo >= 0 ? lineNo : 0],
          },
          typeIcon,
        );
        jobItem.startLine = lineNo >= 0 ? lineNo : 0;
        jobItem.metadata = { type: 'job', jobId };
        workflowItem.children.push(jobItem);
      }
    }

    return workflowItem;
  }
}
