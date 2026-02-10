import * as vscode from 'vscode';
import { LoggerService } from './loggerService';

export interface ITaskExecutionRecord {
    id: string; // Unique ID for this execution (e.g. uuid or timestamp based)
    taskName: string;
    taskSource: string; // "npm", "workspace", etc.
    definition: vscode.TaskDefinition;
    startTime: number;
    endTime?: number;
    exitCode?: number;
    status: 'Running' | 'Success' | 'Terminated' | 'Failed';
    duration?: number;
}

export interface ITaskHistoryGroup {
    key: string; // Unique key for the task (type + name + source + scope?)
    label: string; // "compile:vsix (project.json)"
    taskName: string;
    source: string;
    executions: ITaskExecutionRecord[];
}

export class TaskHistoryService {
    private static instance: TaskHistoryService;
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private historyGroups: Map<string, ITaskHistoryGroup> = new Map();
    private activeExecutions: Map<vscode.TaskExecution, ITaskExecutionRecord> = new Map();
    private context: vscode.ExtensionContext | undefined;
    private logger = LoggerService.getInstance();
    private filters: Set<string> = new Set(['Running', 'Success', 'Failed', 'Terminated']);

    private constructor() { }

    public static getInstance(): TaskHistoryService {
        if (!TaskHistoryService.instance) {
            TaskHistoryService.instance = new TaskHistoryService();
        }
        return TaskHistoryService.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.registerListeners();
    }

    public toggleFilter(status: string) {
        if (this.filters.has(status)) {
            this.filters.delete(status);
        } else {
            this.filters.add(status);
        }
        this._onDidChange.fire();
    }

    public hasFilter(status: string): boolean {
        return this.filters.has(status);
    }

    private registerListeners() {
        if (!this.context) { return; }

        this.context.subscriptions.push(
            vscode.tasks.onDidStartTask((e) => this.handleTaskStart(e)),
            vscode.tasks.onDidEndTaskProcess((e) => this.handleTaskProcessEnd(e)),
            vscode.tasks.onDidEndTask((e) => this.handleTaskEnd(e))
        );
    }

    private getTaskKey(task: vscode.Task): string {
        const scope = typeof task.scope === 'object' ? (task.scope as vscode.WorkspaceFolder).name : (task.scope?.toString() || 'global');
        return `${task.source}:${task.name}:${scope}`;
    }

    private getTaskLabel(task: vscode.Task): string {
        // "task name (source)" or similar
        // User example: "compile:vsix (project.json)"
        // task.name is generic, we might want detail?
        // Let's stick to name and source
        return `${task.name} (${task.source})`;
    }

    private handleTaskStart(e: vscode.TaskStartEvent) {
        const task = e.execution.task;
        const key = this.getTaskKey(task);

        let group = this.historyGroups.get(key);
        if (!group) {
            group = {
                key,
                label: this.getTaskLabel(task),
                taskName: task.name,
                source: task.source,
                executions: []
            };
            this.historyGroups.set(key, group);
        }

        const record: ITaskExecutionRecord = {
            id: Date.now().toString() + Math.random().toString().substring(2, 5),
            taskName: task.name,
            taskSource: task.source,
            definition: task.definition,
            startTime: Date.now(),
            status: 'Running'
        };

        // Prepend to executions (newest first)
        group.executions.unshift(record);
        this.activeExecutions.set(e.execution, record);

        this._onDidChange.fire();
    }

    private handleTaskProcessEnd(e: vscode.TaskProcessEndEvent) {
        const record = this.activeExecutions.get(e.execution);
        if (record) {
            record.endTime = Date.now();
            record.exitCode = e.exitCode;
            record.duration = record.endTime - record.startTime;

            if (e.exitCode === 0) {
                record.status = 'Success';
            } else if (e.exitCode !== undefined) {
                 record.status = 'Failed'; // Non-zero exit code
            } else {
                record.status = 'Terminated'; // Usually if no exit code, might be terminated?
            }

            this._onDidChange.fire();
        }
    }

    private handleTaskEnd(e: vscode.TaskEndEvent) {
        // Cleanup active execution map
        // Also handle case where process end wasn't fired (some tasks types)
        const record = this.activeExecutions.get(e.execution);
        if (record) {
             if (record.status === 'Running') {
                 // It ended without process event (e.g. shell execution failed to spawn or custom execution)
                 record.endTime = Date.now();
                 record.duration = record.endTime - record.startTime;
                 // We don't have exit code here usually
                 record.status = 'Terminated';
                 this._onDidChange.fire();
             }
             this.activeExecutions.delete(e.execution);
        }
    }

    public getHistoryGroups(): ITaskHistoryGroup[] {
        return Array.from(this.historyGroups.values());
    }

    public getAllExecutions(): ITaskExecutionRecord[] {
        const all: ITaskExecutionRecord[] = [];
        for (const group of this.historyGroups.values()) {
            all.push(...group.executions);
        }
        return all.sort((a, b) => b.startTime - a.startTime);
    }

    public clear() {
        this.historyGroups.clear();
        this.activeExecutions.clear();
        this._onDidChange.fire();
    }
}
