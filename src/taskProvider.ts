import * as vscode from 'vscode';
import { TaskItem } from './taskItem';

export interface TaskProvider {
    getTasks(): Promise<TaskItem[]>;
}

export abstract class BaseTaskProvider implements TaskProvider {
    abstract getTasks(): Promise<TaskItem[]>;
}
