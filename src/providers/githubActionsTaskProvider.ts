import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'yaml';
import { TaskItem } from '../taskItem';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';

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

    workflowItem.children = [];

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
      const item = new TaskItem(
        `Run Workflow (${event})`,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        uri,
        {
          command: 'workspaceTasks.openFileAtLine',
          title: 'Open Workflow',
          arguments: [uri, 0],
        },
        typeIcon,
      );

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
      for (const [jobId, _] of Object.entries(workflow.jobs)) {
        // Find line number using simple string match fallback or if we had source map
        // YAML parser might give source map but let's stick to simple match for line number for now
        // Or we just default to 0.
        // To be better, we can scan line by line or find index of `jobId:`
        const lines = text.split(/\r?\n/);
        const lineNo = lines.findIndex((l) => l.trim().startsWith(`${jobId}:`)); // Simple heuristic

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
        jobItem.metadata = { type: 'job', jobId };
        workflowItem.children.push(jobItem);
      }
    }

    return workflowItem;
  }
}
