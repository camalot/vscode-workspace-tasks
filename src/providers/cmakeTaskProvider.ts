import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { TaskFilesService } from '../services/taskFilesService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import { configuration } from '../libs/configuration';
import * as path from 'path';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

/**
 * Provides tasks discovered from CMakeLists.txt files.
 *
 * Recognized target declarations:
 *  - `add_custom_target(Name ...)` — custom build targets
 *  - `add_executable(Name ...)` — executable targets
 *
 * Each target is presented as a task that runs:
 *   `cmake --build <buildDirectory> --target <Name>`
 *
 * The build directory, build type, and generator are configurable via extension settings.
 */
export class CMakeTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('cmake', constants.GLOB_CMAKE);
  }

  /**
   * Returns the cmake executable command and arguments.
   * Respects the `workspaceTasks.applicationPath.cmake` setting.
   */
  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.cmake',
        defaultValue: 'cmake',
        configName: 'cmake',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }

  /**
   * Returns the build directory relative to the CMakeLists.txt source directory.
   * Controlled by `workspaceTasks.cmake.buildDirectory`.
   */
  public getBuildDirectory(): string {
    return configuration.get<string>('cmake.buildDirectory', 'build');
  }

  /**
   * Returns the CMake build type (e.g. Debug, Release).
   * Controlled by `workspaceTasks.cmake.buildType`.
   */
  public getBuildType(): string {
    return configuration.get<string>('cmake.buildType', 'Debug');
  }

  /**
   * Returns the CMake generator name (e.g. Ninja, "Unix Makefiles").
   * Controlled by `workspaceTasks.cmake.generator`. Empty string means platform default.
   */
  public getGenerator(): string {
    return configuration.get<string>('cmake.generator', '');
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const iconService = TaskIconService.getInstance();

    const files = await this.getMatchingFiles();

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const lines = content.split('\n');

        const iconPath = iconService.getTaskIcon('cmake');

        // Regex patterns to match cmake targets — case-insensitive per CMake language spec
        const customTargetRegex = /^\s*add_custom_target\s*\(\s*([A-Za-z0-9_.\-]+)/i;
        const executableRegex = /^\s*add_executable\s*\(\s*([A-Za-z0-9_.\-]+)/i;

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          // Strip inline comments (# starts a comment in CMake)
          const commentIndex = line.indexOf('#');
          if (commentIndex !== -1) {
            line = line.substring(0, commentIndex);
          }

          let match = customTargetRegex.exec(line);
          if (!match) {
            match = executableRegex.exec(line);
          }

          if (match) {
            const targetName = match[1];

            const item = new TaskItem(
              targetName,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              file,
              undefined,
              iconPath,
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i],
            };

            tasks.push(item);
          }
        }
      } catch (e) {
        this.logger.error(`[CMakeTaskProvider] Error parsing CMakeLists.txt: ${file.fsPath}`, e);
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
    const { resourceUri, workspaceFolder } = resolveTaskContext(item);
    const taskLabel = item.originalLabel || item.label;
    const { command: cmakeCmd, args: cmakeInitialArgs } = this.getCommand(workspaceFolder?.uri);

    const sourceDir = path.dirname(resourceUri.fsPath);
    const buildDir = this.getBuildDirectory();
    const buildPath = path.isAbsolute(buildDir) ? buildDir : path.join(sourceDir, buildDir);
    const buildType = this.getBuildType();

    const cmakeArgs = cmakeInitialArgs ? [...cmakeInitialArgs] : [];
    cmakeArgs.push('--build', buildPath, '--target', taskLabel, '--config', buildType, ...splitArgs(args));

    const full = `${cmakeCmd} ${cmakeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(cmakeCmd, cmakeArgs, { cwd: sourceDir });
    const task = new vscode.Task(
      { type: 'cmake', target: taskLabel, path: resourceUri.fsPath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'cmake',
      shellExec,
    );
    return { task, command: full, cwd: sourceDir, native: false };
  }
}
