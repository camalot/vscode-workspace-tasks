import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';
import { TaskStateManager } from './taskStateManager';

export interface TaskProvider {
  getTasks(): Promise<TaskItem[]>;
  filePattern?: string;
  type?: string;
}

export abstract class BaseTaskProvider implements TaskProvider {
  readonly type: string;
  public filePattern?: string;
  protected context: vscode.ExtensionContext | undefined;
  constructor(type: string, filePattern?: string) {
    this.type = type;
    this.filePattern = filePattern;
    this.context = TaskStateManager.getInstance().getContext();
  }

  get enabled(): boolean {
    return TaskConfigService.getInstance().isTaskTypeEnabled(this.type);
  }

  abstract getTasks(): Promise<TaskItem[]>;
}
