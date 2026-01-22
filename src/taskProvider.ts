import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';
import { TaskStateManager } from './taskStateManager';

export interface TaskProvider {
  getTasks(): Promise<TaskItem[]>;
}

export abstract class BaseTaskProvider implements TaskProvider {
  readonly type: string;
  readonly enabled: boolean;
  protected context: vscode.ExtensionContext | undefined;
  constructor(type: string) {
    this.type = type;
    this.enabled = TaskConfigService.getInstance().isTaskTypeEnabled(type);
    this.context = TaskStateManager.getInstance().getContext();
  }
  abstract getTasks(): Promise<TaskItem[]>;
}
