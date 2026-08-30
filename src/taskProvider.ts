import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';
import { TaskFilesService } from './services/taskFilesService';
import { TaskStateManager } from './taskStateManager';
import { LoggerService } from './services/loggerService';
import { CreatedTask } from './libs/taskCreationUtils';

export interface TaskProvider {
  getTasks(): Promise<TaskItem[]>;
  filePattern?: string;
  type?: string;
  getFilePatterns(): string[];
}

export abstract class BaseTaskProvider implements TaskProvider {
  readonly type: string;
  public filePattern?: string;
  protected context: vscode.ExtensionContext | undefined;
  protected logger = LoggerService.getInstance();
  private static lastAdditionalFilePatternsSignature = '';
  private static warnedAdditionalFilePatternKeys = new Set<string>();
  constructor(type: string, filePattern?: string) {
    this.type = type;
    this.filePattern = filePattern;
    this.context = TaskStateManager.getInstance().getContext();
  }

  getFilePatterns(): string[] {
    return this.mergeFilePatterns(this.filePattern ? [this.filePattern] : []);
  }

  protected getConfiguredAdditionalPatterns(): string[] {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const patternsByType = config.get<Record<string, unknown>>('additionalFilePatterns', {});
    const enabledTaskTypes = config.get<Record<string, boolean>>('enabledTaskTypes', {});
    const signature = JSON.stringify(patternsByType ?? {});

    if (signature !== BaseTaskProvider.lastAdditionalFilePatternsSignature) {
      BaseTaskProvider.lastAdditionalFilePatternsSignature = signature;
      BaseTaskProvider.warnedAdditionalFilePatternKeys.clear();
    }

    const configKey = TaskConfigService.getInstance().getAdditionalFilePatternConfigKey(this.type);
    if (!configKey) {
      const normalizedKey = TaskConfigService.getInstance().getConfigKey(this.type);
      const reason = Object.prototype.hasOwnProperty.call(enabledTaskTypes, normalizedKey)
        ? 'recognized task type but not file-based discovery provider'
        : 'unknown task type';
      this.logAdditionalPatternWarning(normalizedKey, reason);
      return [];
    }

    const rawPatterns = patternsByType?.[configKey];

    if (!Array.isArray(rawPatterns)) {
      if (Object.prototype.hasOwnProperty.call(patternsByType ?? {}, configKey)) {
        this.logAdditionalPatternWarning(configKey, 'non-array additionalFilePatterns value');
      }
      return [];
    }

    return rawPatterns.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0);
  }

  private logAdditionalPatternWarning(configKey: string, reason: string): void {
    const warningKey = `${configKey}:${reason}`;
    if (BaseTaskProvider.warnedAdditionalFilePatternKeys.has(warningKey)) {
      return;
    }
    BaseTaskProvider.warnedAdditionalFilePatternKeys.add(warningKey);
    this.logger.debug(
      `[BaseTaskProvider] Ignoring workspaceTasks.additionalFilePatterns.${configKey}: ${reason}.`,
    );
  }

  protected mergeFilePatterns(builtin: string[]): string[] {
    const extraPatterns = this.getConfiguredAdditionalPatterns();
    return Array.from(new Set([...builtin, ...extraPatterns]));
  }

  protected async getMatchingFiles(exclude?: string[]): Promise<vscode.Uri[]> {
    return TaskFilesService.getInstance().findFiles(this.getFilePatterns(), exclude);
  }

  get enabled(): boolean {
    return TaskConfigService.getInstance().isTaskTypeEnabled(this.type);
  }

  abstract getTasks(): Promise<TaskItem[]>;

  abstract getSystemTasks(): Promise<TaskItem[]>;

  /**
   * Creates a runnable vscode.Task for the given TaskItem.
   *
   * Provider-based task types override this method. Special-case types (shell,
   * jupyter, vscode, dockerfile) are handled by private helpers in
   * taskFactory.ts and do NOT override this method.
   *
   * Implementations must follow the Provider Contract documented in
   * docs/_plans/task-factory-refactor/plan.md.
   *
   * @returns A CreatedTask on success, or undefined when the task cannot be built
   *          (e.g. missing required file URI, untrusted workspace). Never throws.
   */
  createTask(
    _item: TaskItem,
    _args?: string,
    _resolvedLabel?: string,
    _varAssignments?: string[],
  ): Promise<CreatedTask | undefined> {
    return Promise.resolve(undefined);
  }
}
