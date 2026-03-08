import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';
import { TaskStateManager } from './taskStateManager';
import { LoggerService } from './services/loggerService';

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
}
