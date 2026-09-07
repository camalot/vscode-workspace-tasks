import * as vscode from 'vscode';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';
import * as path from 'path';
import { CreatedTask, resolveTaskContext, splitArgs } from '../libs/taskCreationUtils';

/** Makefile names GNU make resolves automatically, in search order. */
const DEFAULT_MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile'];

/** `include`, `-include` and `sinclude` directives. */
const INCLUDE_DIRECTIVE = /^\s*(?:-include|sinclude|include)\s+(.+)$/;

/** Guards against pathological include chains and cycles. */
const MAX_INCLUDE_DEPTH = 16;

export class MakefileTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('makefile', constants.GLOB_MAKE);
  }
  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand(
      {
        configKey: 'applicationPath.make',
        defaultValue: 'make',
        configName: 'make',
        resolveToAbsolutePath: false,
        windowsExecutableExtension: '.exe',
        windowsEnforceExtension: true,
      },
      workspaceUri,
    );
  }
  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const tasks: TaskItem[] = [];
    const iconService = TaskIconService.getInstance();
    const iconPath = iconService.getTaskIcon('makefile');

    const files = await this.getMatchingFiles();

    // Resolve `include` directives first so that targets defined in included
    // makefiles are attributed to the makefile that includes them.
    const lineCache = new Map<string, string[]>();
    const closures = new Map<string, vscode.Uri[]>();
    const includedPaths = new Set<string>();

    for (const file of files) {
      const closure = await this.collectIncludeClosure(file, lineCache);
      closures.set(file.fsPath, closure);
      for (const included of closure) {
        includedPaths.add(included.fsPath);
      }
    }

    for (const file of files) {
      // Included makefiles are surfaced through their including makefile so that
      // targets run with the correct working directory / -f argument.
      if (includedPaths.has(file.fsPath)) {
        continue;
      }

      const chain = [file, ...(closures.get(file.fsPath) ?? [])];
      const seenTargets = new Set<string>();

      for (const member of chain) {
        const lines = await this.getLines(member, lineCache);
        if (!lines) {
          continue;
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Basic Makefile target parsing
          const match = line.match(/^([a-zA-Z0-9_\-\.]+):/);
          if (match) {
            const target = match[1];
            if (target === '.PHONY' || seenTargets.has(target)) {
              continue;
            }
            seenTargets.add(target);

            const item = new TaskItem(
              target,
              vscode.TreeItemCollapsibleState.None,
              this.type,
              member,
              undefined,
              iconPath,
            );
            item.taskFileUri = member;
            item.description = vscode.workspace.asRelativePath(member);
            item.startLine = i;

            if (member.fsPath !== file.fsPath) {
              item.metadata = { ...(item.metadata ?? {}), makefileRoot: file.fsPath };
              item.tooltip = `${target} (makefile) • included by ${vscode.workspace.asRelativePath(file)}`;
            }

            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [member, i],
            };
            tasks.push(item);
          }
        }
      }
    }
    return tasks;
  }

  /**
   * Reads a makefile's lines, caching the result for the duration of a getTasks() pass.
   * Returns undefined when the file cannot be read.
   */
  private async getLines(file: vscode.Uri, cache: Map<string, string[]>): Promise<string[] | undefined> {
    const cached = cache.get(file.fsPath);
    if (cached) {
      return cached;
    }
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const lines = document.getText().split('\n');
      cache.set(file.fsPath, lines);
      return lines;
    } catch (e) {
      this.logger.error(`[MakefileTaskProvider] Error parsing Makefile: ${file.fsPath}`, e);
      return undefined;
    }
  }

  /**
   * Recursively resolves the makefiles included (directly or transitively) by the
   * given makefile. Paths using make variables or globs are skipped, as are
   * missing files and cycles.
   */
  private async collectIncludeClosure(
    root: vscode.Uri,
    cache: Map<string, string[]>,
  ): Promise<vscode.Uri[]> {
    const closure: vscode.Uri[] = [];
    const visited = new Set<string>([root.fsPath]);

    const walk = async (file: vscode.Uri, depth: number): Promise<void> => {
      if (depth > MAX_INCLUDE_DEPTH) {
        return;
      }
      const lines = await this.getLines(file, cache);
      if (!lines) {
        return;
      }
      for (const target of this.parseIncludeDirectives(lines, file)) {
        if (visited.has(target.fsPath)) {
          continue;
        }
        visited.add(target.fsPath);
        try {
          await vscode.workspace.fs.stat(target);
        } catch {
          this.logger.debug(`[MakefileTaskProvider] Skipping missing include: ${target.fsPath}`);
          continue;
        }
        closure.push(target);
        await walk(target, depth + 1);
      }
    };

    await walk(root, 0);
    return closure;
  }

  /**
   * Extracts include targets from makefile lines, resolved against the
   * including file's directory.
   */
  private parseIncludeDirectives(lines: string[], file: vscode.Uri): vscode.Uri[] {
    const baseDir = path.dirname(file.fsPath);
    const results: vscode.Uri[] = [];

    for (const rawLine of lines) {
      // Recipe lines (tab indented) are shell commands, not directives.
      if (rawLine.startsWith('\t')) {
        continue;
      }
      const line = rawLine.split('#')[0].trim();
      const match = line.match(INCLUDE_DIRECTIVE);
      if (!match) {
        continue;
      }
      for (const entry of match[1].split(/\s+/)) {
        if (!entry || entry === '\\') {
          continue;
        }
        // Make variables and globs cannot be resolved statically.
        if (/[$*?\[]/.test(entry)) {
          continue;
        }
        const cleaned = entry.replace(/^['"]|['"]$/g, '');
        if (!cleaned) {
          continue;
        }
        results.push(vscode.Uri.file(path.resolve(baseDir, cleaned)));
      }
    }
    return results;
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
    // Targets from included makefiles must run against the makefile that includes them.
    const makefilePath = (item.metadata?.makefileRoot as string | undefined) ?? resourceUri.fsPath;
    const makeFileCwd = path.dirname(makefilePath);
    const makefileName = path.basename(makefilePath);
    const { command: makeCmd, args: makeInitialArgs } = this.getCommand(workspaceFolder?.uri);

    const makeArgs = makeInitialArgs ? [...makeInitialArgs] : [];
    if (!DEFAULT_MAKEFILE_NAMES.includes(makefileName)) {
      makeArgs.push('-f', makefileName);
    }
    makeArgs.push(taskLabel, ...splitArgs(args));

    const full = `${makeCmd} ${makeArgs.join(' ')}`;
    const shellExec = new vscode.ShellExecution(makeCmd, makeArgs, { cwd: makeFileCwd });
    const task = new vscode.Task(
      { type: 'process', script: taskLabel, path: makefilePath },
      vscode.TaskScope.Workspace,
      taskLabel,
      'makefile',
      shellExec,
    );
    return { task, command: full, cwd: makeFileCwd, native: false };
  }
}
