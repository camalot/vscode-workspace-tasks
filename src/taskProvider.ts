import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';
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
  constructor(type: string, filePattern?: string) {
    this.type = type;
    this.filePattern = filePattern;
    this.context = TaskStateManager.getInstance().getContext();
  }

  getFilePatterns(): string[] {
    return this.filePattern ? [this.filePattern] : [];
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
