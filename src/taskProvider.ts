import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskConfigService } from './services/taskConfigService';

export interface TaskProvider {
  getTasks(): Promise<TaskItem[]>;
}

export abstract class BaseTaskProvider implements TaskProvider {
  readonly type: string;
  readonly enabled: boolean;
  constructor(type: string) {
    this.type = type;
    this.enabled = TaskConfigService.getInstance().isTaskTypeEnabled(type);
  }
  abstract getTasks(): Promise<TaskItem[]>;
}
