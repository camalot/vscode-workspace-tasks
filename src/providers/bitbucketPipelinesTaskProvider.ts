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
import { ExtensionConfigurationService } from '../services/extensionConfigurationService';
import { group } from 'console';

/** A single Bitbucket Pipelines step definition. */
interface BitbucketStep {
  name?: string;
  [key: string]: unknown;
}

/** A stage block (may contain multiple steps). */
interface BitbucketStage {
  name?: string;
  steps?: Array<{ step: BitbucketStep }>;
}

/**
 * One entry inside a pipeline section's list. Can be a step,
 * a parallel block (array or object shape), or a stage block.
 */
type BitbucketPipelineEntry =
  | { step: BitbucketStep }
  | { parallel: Array<{ step: BitbucketStep }> | { steps: Array<{ step: BitbucketStep }> } }
  | { stage: BitbucketStage };

/** Top-level shape of a bitbucket-pipelines.yml file. */
interface BitbucketPipelinesConfig {
  pipelines?: {
    default?: BitbucketPipelineEntry[];
    branches?: Record<string, BitbucketPipelineEntry[]>;
    'pull-requests'?: Record<string, BitbucketPipelineEntry[]>;
    tags?: Record<string, BitbucketPipelineEntry[]>;
    custom?: Record<string, BitbucketPipelineEntry[]>;
  };
}

type IconPath = string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined;

/**
 * Task provider for Bitbucket Pipelines (`bitbucket-pipelines.yml`).
 *
 * Builds a 4-level tree: file → pipeline → stage (optional) → step.
 * Runs pipelines locally using the `pipeline-runner` CLI.
 */
export class BitbucketPipelinesTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('bitbucket', constants.GLOB_BITBUCKET_PIPELINES);
  }

  /**
   * Returns the resolved `pipeline-runner` command (or user-configured override).
   */
  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    return ExecutableService.getInstance().getCommand(
      {
        configKey: 'applicationPath.bitbucketPipelineRunner',
        defaultValue: 'pipeline-runner',
        configName: 'pipeline-runner',
        resolveToAbsolutePath: false,
      },
      resourceUri,
    );
  }

  public async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const allFiles = await TaskFilesService.getInstance().findFiles([constants.GLOB_BITBUCKET_PIPELINES]);

    // pipeline-runner has no flag to specify the config file path — it always
    // reads bitbucket-pipelines.yml from the current working directory (workspace
    // root).  Only process files that live directly at a workspace folder root.
    const workspaceRoots = new Set(
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    );
    const files = allFiles.filter((f) => workspaceRoots.has(path.dirname(f.fsPath)));

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
          `[bitbucket] Failed to read ${file.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return tasks;
  }

  /**
   * Parses the YAML text of a `bitbucket-pipelines.yml` file into a TaskItem tree.
   * Public to allow unit testing without the VS Code file system.
   */
  public parseConfig(fileUri: vscode.Uri, text: string, iconService?: TaskIconService): TaskItem | undefined {
    let config: BitbucketPipelinesConfig;
    try {
      config = yaml.parse(text) as BitbucketPipelinesConfig;
    } catch (err: unknown) {
      LoggerService.getInstance().warn(
        `[bitbucket] Failed to parse YAML in ${fileUri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }

    if (typeof config !== 'object' || config === null) {
      return undefined;
    }
    if (typeof config.pipelines !== 'object' || config.pipelines === null) {
      return undefined;
    }

    const svc = iconService ?? TaskIconService.getInstance();
    const iconPath = svc.getTaskIcon('bitbucket', fileUri);

    const configService = ExtensionConfigurationService.getInstance();

    // Use the workspace folder name as the label only in multi-root workspace, where it
    // disambiguates which folder the file belongs to. if grouping is enabled, and useParentFolder is true, use the parent folder name; Otherwise, in a single-root workspace the folder
    // name adds an unnecessary extra grouping level, so fall back to the file's basename.
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const groupEnabled = configService.get('groups.enabled', false);
    const useParentFolder = configService.get('groups.useParentFolder', false) && groupEnabled;
    const fileLabel = isMultiRoot || useParentFolder
      ? (workspaceFolder?.name ?? path.basename(path.dirname(fileUri.fsPath)))
      : path.basename(fileUri.fsPath);

    const fileItem = new TaskItem(
      fileLabel,
      vscode.TreeItemCollapsibleState.Collapsed,
      'bitbucket',
      fileUri,
      undefined,
      iconPath,
    );
    fileItem.description = vscode.workspace.asRelativePath(fileUri);
    fileItem.taskFileUri = fileUri;
    fileItem.metadata = { type: 'file' };
    fileItem.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    fileItem.children = [];

    const { pipelines } = config;

    // ── default pipeline ──────────────────────────────────────────
    if (Array.isArray(pipelines.default)) {
      const pipelineItem = this.createPipelineItem('default', 'default', undefined, fileUri, iconPath);
      this.populatePipelineChildren(pipelineItem, pipelines.default, 'default', fileUri, iconPath);
      if (pipelineItem.children && pipelineItem.children.length > 0) {
        pipelineItem.parent = fileItem;
        fileItem.children.push(pipelineItem);
      }
    }

    // ── named pipeline sections (branches, pull-requests, tags, custom) ──
    const namedSections = ['branches', 'pull-requests', 'tags', 'custom'] as const;
    for (const section of namedSections) {
      const sectionData = pipelines[section];
      if (typeof sectionData !== 'object' || sectionData === null) {
        continue;
      }
      for (const [key, entries] of Object.entries(sectionData as Record<string, BitbucketPipelineEntry[]>)) {
        if (!Array.isArray(entries)) {
          continue;
        }
        const pipelinePath = `${section}.${key}`;
        const pipelineItem = this.createPipelineItem(key, pipelinePath, section, fileUri, iconPath);
        this.populatePipelineChildren(pipelineItem, entries, pipelinePath, fileUri, iconPath);
        if (pipelineItem.children && pipelineItem.children.length > 0) {
          pipelineItem.parent = fileItem;
          fileItem.children.push(pipelineItem);
        }
      }
    }

    return fileItem.children.length > 0 ? fileItem : undefined;
  }

  public async getSystemTasks(): Promise<TaskItem[]> {
    return [];
  }

  // ── private helpers ─────────────────────────────────────────────

  private createPipelineItem(
    label: string,
    pipelinePath: string,
    section: string | undefined,
    fileUri: vscode.Uri,
    iconPath: IconPath,
  ): TaskItem {
    const item = new TaskItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      'bitbucket',
      fileUri,
      undefined,
      iconPath,
    );
    item.taskFileUri = fileUri;
    if (section) {
      item.description = section;
    }
    item.metadata = { type: 'pipeline', pipelinePath };
    item.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    item.onRunActionCommand = {
      command: 'workspaceTasks.runTask',
      title: 'Run Pipeline',
      arguments: [item],
    };
    item.command = {
      command: 'workspaceTasks.onTreeItemClick',
      title: 'On Tree Item Click',
      arguments: [item],
    };
    item.children = [];
    return item;
  }

  private createStageItem(
    stageName: string | undefined,
    pipelinePath: string,
    fileUri: vscode.Uri,
    iconPath: IconPath,
  ): TaskItem {
    const label = stageName ?? '[unnamed stage]';
    const item = new TaskItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      'bitbucket',
      fileUri,
      undefined,
      iconPath,
    );
    item.taskFileUri = fileUri;
    item.metadata = { type: 'stage', pipelinePath, ...(stageName !== undefined ? { stageName } : {}) };
    item.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };
    // Named stages are runnable; unnamed stages are display-only.
    if (stageName !== undefined) {
      item.onRunActionCommand = {
        command: 'workspaceTasks.runTask',
        title: 'Run Stage',
        arguments: [item],
      };
      item.command = {
        command: 'workspaceTasks.onTreeItemClick',
        title: 'On Tree Item Click',
        arguments: [item],
      };
    }
    item.children = [];
    return item;
  }

  private createStepItem(
    step: BitbucketStep,
    pipelinePath: string,
    fileUri: vscode.Uri,
    iconPath: IconPath,
    nameCounts: Map<string, number>,
    isParallel = false,
  ): TaskItem {
    const stepName = typeof step.name === 'string' ? step.name : undefined;
    let label: string;
    let resolvedName: string | undefined;

    if (stepName !== undefined) {
      const count = nameCounts.get(stepName) ?? 0;
      nameCounts.set(stepName, count + 1);
      if (count > 0) {
        resolvedName = `${stepName} (${count})`;
        label = resolvedName;
      } else {
        resolvedName = stepName;
        label = stepName;
      }
    } else {
      label = '[unnamed step]';
    }

    const item = new TaskItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      'bitbucket',
      fileUri,
      undefined,
      iconPath,
    );
    item.taskFileUri = fileUri;
    item.metadata = {
      type: 'step',
      pipelinePath,
      ...(resolvedName !== undefined ? { stepName: resolvedName } : {}),
    };

    if (isParallel) {
      item.tooltip = `[parallel] ${label}`;
    }

    // The TaskItem constructor auto-assigns onRunActionCommand for all leaf nodes.
    // For unnamed steps we clear it: they cannot be targeted by pipeline-runner.
    if (resolvedName === undefined) {
      item.onRunActionCommand = undefined;
      item.command = undefined;
    } else {
      item.onRunActionCommand = {
        command: 'workspaceTasks.runTask',
        title: 'Run Step',
        arguments: [item],
      };
      item.command = {
        command: 'workspaceTasks.onTreeItemClick',
        title: 'On Tree Item Click',
        arguments: [item],
      };
    }
    item.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [fileUri, 0],
    };

    return item;
  }

  /**
   * Iterates the entries of a pipeline section and appends step/stage/parallel
   * children onto the given `pipelineItem`.
   */
  private populatePipelineChildren(
    pipelineItem: TaskItem,
    entries: BitbucketPipelineEntry[],
    pipelinePath: string,
    fileUri: vscode.Uri,
    iconPath: IconPath,
  ): void {
    const nameCounts = new Map<string, number>();

    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }

      if ('step' in entry && typeof entry.step === 'object' && entry.step !== null) {
        // ── regular step ─────────────────────────────────────────
        const stepItem = this.createStepItem(
          entry.step as BitbucketStep,
          pipelinePath,
          fileUri,
          iconPath,
          nameCounts,
        );
        stepItem.parent = pipelineItem;
        pipelineItem.children!.push(stepItem);
      } else if ('parallel' in entry) {
        // ── parallel block ────────────────────────────────────────
        const parallelData = entry.parallel;
        let parallelSteps: Array<{ step: BitbucketStep }>;

        if (Array.isArray(parallelData)) {
          parallelSteps = parallelData as Array<{ step: BitbucketStep }>;
        } else if (
          typeof parallelData === 'object' &&
          parallelData !== null &&
          'steps' in parallelData &&
          Array.isArray((parallelData as { steps: unknown }).steps)
        ) {
          parallelSteps = (parallelData as { steps: Array<{ step: BitbucketStep }> }).steps;
        } else {
          continue;
        }

        for (const parallelEntry of parallelSteps) {
          if (typeof parallelEntry === 'object' && parallelEntry !== null && 'step' in parallelEntry) {
            const stepItem = this.createStepItem(
              parallelEntry.step,
              pipelinePath,
              fileUri,
              iconPath,
              nameCounts,
              true,
            );
            stepItem.parent = pipelineItem;
            pipelineItem.children!.push(stepItem);
          }
        }
      } else if ('stage' in entry && typeof entry.stage === 'object' && entry.stage !== null) {
        // ── stage block ───────────────────────────────────────────
        const stage = entry.stage as BitbucketStage;
        const stageName = typeof stage.name === 'string' ? stage.name : undefined;
        const stageItem = this.createStageItem(stageName, pipelinePath, fileUri, iconPath);
        const stageNameCounts = new Map<string, number>();

        if (Array.isArray(stage.steps)) {
          for (const stepEntry of stage.steps) {
            if (typeof stepEntry === 'object' && stepEntry !== null && 'step' in stepEntry) {
              const stepItem = this.createStepItem(
                stepEntry.step,
                pipelinePath,
                fileUri,
                iconPath,
                stageNameCounts,
              );
              stepItem.parent = stageItem;
              stageItem.children!.push(stepItem);
            }
          }
        }

        if (stageItem.children && stageItem.children.length > 0) {
          stageItem.parent = pipelineItem;
          pipelineItem.children!.push(stageItem);
        }
      }
    }
  }
}
