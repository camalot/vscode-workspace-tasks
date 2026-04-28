import * as vscode from 'vscode';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskFilesService } from '../services/taskFilesService';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

interface JustRecipeAttribute {
  name: string;
  value?: string;
}

interface JustRecipe {
  name: string;
  doc: string | null;
  parameters: unknown[];
  private: boolean;
  quiet: boolean;
  body: string[][];
  dependencies: unknown[];
  attributes: JustRecipeAttribute[];
  shebang: boolean;
  priors: number;
}

interface JustfileJsonOutput {
  first: string;
  recipes: Record<string, JustRecipe>;
  settings: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export class JustfileTaskProvider extends BaseTaskProvider implements TaskProvider {
  /** Overridable in tests to avoid spawning a real process. */
  protected execFileAsync = promisify(execFile);

  constructor() {
    super('justfile', constants.GLOB_JUST);
  }

  public getCommand(resourceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.just',
        defaultValue: 'just',
        configName: 'just',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      resourceUri,
    );
  }

  private async getJustJsonOutput(
    justfilePath: string,
    justCmd: ExecutableResult,
  ): Promise<JustfileJsonOutput | null> {
    try {
      const { stdout, stderr } = await this.execFileAsync(
        justCmd.command,
        [...justCmd.args, '--justfile', justfilePath, '--dump', '--dump-format', 'json'],
        {
          cwd: path.dirname(justfilePath),
          timeout: 10000,
        },
      );
      if (stderr) {
        this.logger.debug(`[JustfileTaskProvider] just --dump stderr: ${stderr}`);
      }
      const parsed = JSON.parse(stdout);
      if (!parsed || typeof parsed.recipes !== 'object' || parsed.recipes === null) {
        this.logger.warn(
          `[JustfileTaskProvider] just --dump returned unexpected JSON shape for ${justfilePath}`,
        );
        return null;
      }
      return parsed as JustfileJsonOutput;
    } catch (err) {
      this.logger.warn(
        `[JustfileTaskProvider] Could not run just --dump for ${justfilePath}. ` +
        'Tasks from this justfile will not be shown. Ensure just is installed and ' +
        'applicationPath.just is configured correctly if needed.',
        err,
      );
      return null;
    }
  }

  private findRecipeLineNumber(lines: string[], recipeName: string): number | undefined {
    const escaped = recipeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^@?${escaped}(?:\\s|:|$)`);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return i;
      }
    }
    return undefined; // Not found in this file (e.g., recipe lives in an imported file)
  }

  private getRecipeGroup(recipe: JustRecipe): string | null {
    const groupAttr = recipe.attributes.find(
      (attr) => attr.name === 'group' && typeof attr.value === 'string',
    );
    return groupAttr?.value ?? null;
  }

  private createRecipeTaskItem(
    recipe: JustRecipe,
    file: vscode.Uri,
    iconPath: unknown,
    line: number | undefined,
  ): TaskItem {
    const item = new TaskItem(
      recipe.name,
      vscode.TreeItemCollapsibleState.None,
      this.type,
      file,
      undefined,
      iconPath as string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri },
    );
    item.taskFileUri = file;
    item.description = vscode.workspace.asRelativePath(file);
    item.startLine = line; // undefined when not found — excluded from CodeLens
    if (recipe.doc) {
      item.tooltip = recipe.doc;
    }
    item.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [file, line ?? 0], // fallback to top-of-file for open action
    };
    return item;
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    if (!vscode.workspace.isTrusted) {
      this.logger.debug('[JustfileTaskProvider] Skipping CLI invocation: workspace is not trusted.');
      return [];
    }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();
    const groupsEnabled = vscode.workspace.getConfiguration('workspaceTasks').get<boolean>(
      'groups.justfile.enabled',
      false,
    );
    const files = await filesService.findFiles([constants.GLOB_JUST]);

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const lines = content.split('\n');
        const fallback = vscode.Uri.file(path.join(path.dirname(file.fsPath || ''), 'justfile'));
        const iconPath = iconService.getTaskIcon(this.type, fallback);

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        if (!workspaceFolder) {
          continue;
        }
        const justCmd = this.getCommand(workspaceFolder.uri);

        const jsonOutput = await this.getJustJsonOutput(file.fsPath, justCmd);
        if (!jsonOutput) {
          // Error already logged inside getJustJsonOutput; skip this file.
          continue;
        }

        const recipes = Object.values(jsonOutput.recipes);

        if (groupsEnabled) {
          const groupItems = new Map<string, TaskItem>();

          for (const recipe of recipes) {
            const groupName = this.getRecipeGroup(recipe);
            const line = this.findRecipeLineNumber(lines, recipe.name);
            const item = this.createRecipeTaskItem(recipe, file, iconPath, line);

            if (groupName) {
              if (!groupItems.has(groupName)) {
                const groupItem = new TaskItem(
                  groupName,
                  vscode.TreeItemCollapsibleState.Collapsed,
                  'justfile',
                  file,
                  undefined,
                  iconPath as string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri },
                );
                groupItem.metadata = { type: 'group', groupName };
                groupItem.children = [];
                groupItems.set(groupName, groupItem);
              }
              const groupItem = groupItems.get(groupName)!;
              item.parent = groupItem;
              groupItem.children!.push(item);
            } else {
              tasks.push(item);
            }
          }

          for (const groupItem of groupItems.values()) {
            tasks.push(groupItem);
          }
        } else {
          for (const recipe of recipes) {
            const line = this.findRecipeLineNumber(lines, recipe.name);
            tasks.push(this.createRecipeTaskItem(recipe, file, iconPath, line));
          }
        }
      } catch (e) {
        this.logger.error(`[JustfileTaskProvider] Error processing justfile: ${file.fsPath}`, e);
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

  async createTask(item: TaskItem, args?: string): Promise<CreatedTask | undefined> {
    const { effectiveResourceUri } = resolveTaskContext(item);
    if (!effectiveResourceUri || !item.taskFileUri) {
      return undefined;
    }

    const justfilePath = effectiveResourceUri.fsPath;
    const justfileDir = path.dirname(justfilePath);
    const taskLabel = item.originalLabel || item.label;
    const { command: justCommand, args: justInitialArgs } = this.getCommand(effectiveResourceUri);

    const justArgs = justInitialArgs ? [...justInitialArgs] : [];
    justArgs.push('--justfile', justfilePath, taskLabel, ...splitArgs(args));

    const fullCmd = `${justCommand} ${justArgs.join(' ')}`.trim();
    const task = new vscode.Task(
      { type: 'justfile', task: taskLabel, path: justfilePath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'just',
      new vscode.ShellExecution(justCommand, justArgs, { cwd: justfileDir }),
    );
    return { task, command: fullCmd, cwd: justfileDir, native: false };
  }
}
