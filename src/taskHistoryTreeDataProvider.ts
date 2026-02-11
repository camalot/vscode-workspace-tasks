import * as vscode from 'vscode';
import { TaskHistoryService, ITaskHistoryGroup, ITaskExecutionRecord } from './services/taskHistoryService';

export class TaskHistoryTreeDataProvider implements vscode.TreeDataProvider<HistoryItem> {
  private static readonly VIEW_MODE_KEY = 'workspaceTasks.history.viewMode';
  private _onDidChangeTreeData: vscode.EventEmitter<HistoryItem | undefined | null | void> = new vscode.EventEmitter<HistoryItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<HistoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private service: TaskHistoryService;
  private viewMode: 'tree' | 'table' = 'table';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.service = TaskHistoryService.getInstance();
    this.service.initialize(context);

    // Load persisted view mode (default to 'table')
    this.viewMode = context.globalState.get<'tree' | 'table'>(TaskHistoryTreeDataProvider.VIEW_MODE_KEY, 'table');

    this.service.onDidChange(() => {
      this.updateContextKeys();
      this.refresh();
    });
    this.updateContextKeys();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public clear() {
    this.service.clear();
    this.refresh();
  }

  public async toggleViewMode() {
    this.viewMode = this.viewMode === 'tree' ? 'table' : 'tree';

    // Persist the view mode
    await this.context.globalState.update(TaskHistoryTreeDataProvider.VIEW_MODE_KEY, this.viewMode);

    await vscode.commands.executeCommand('setContext', 'workspaceTasks.history.viewMode', this.viewMode);
    this.refresh();

    if (this.viewMode === 'table') {
      vscode.commands.executeCommand('workspaceTasksHistoryTableView.focus');
    } else {
      vscode.commands.executeCommand('workspaceTasksHistoryView.focus');
    }
  }

  public async initializeView() {
    // Focus the appropriate view based on persisted mode
    await vscode.commands.executeCommand('setContext', 'workspaceTasks.history.viewMode', this.viewMode);
    if (this.viewMode === 'table') {
      vscode.commands.executeCommand('workspaceTasksHistoryTableView.focus');
    } else {
      vscode.commands.executeCommand('workspaceTasksHistoryView.focus');
    }
  }

  public toggleFilter(status: string) {
    this.service.toggleFilter(status);
  }

  private updateContextKeys() {
    vscode.commands.executeCommand('setContext', 'workspaceTasks.history.viewMode', this.viewMode);
    vscode.commands.executeCommand('setContext', 'workspaceTasks.history.showRunning', this.service.hasFilter('Running'));
    vscode.commands.executeCommand('setContext', 'workspaceTasks.history.showSuccess', this.service.hasFilter('Success'));
    vscode.commands.executeCommand('setContext', 'workspaceTasks.history.showFailed', this.service.hasFilter('Failed'));
    vscode.commands.executeCommand('setContext', 'workspaceTasks.history.showTerminated', this.service.hasFilter('Terminated'));
  }

  getTreeItem(element: HistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryItem): vscode.ProviderResult<HistoryItem[]> {
    if (!element) {
      // Tree Mode
      const groups = this.service.getHistoryGroups();
      const items: HistoryGroupItem[] = [];
      for (const g of groups) {
        const hasMatching = g.executions.some(e => this.service.hasFilter(e.status));
        if (hasMatching) {
          items.push(new HistoryGroupItem(g));
        }
      }
      return items;
    } else if (element instanceof HistoryGroupItem) {
      return element.group.executions
        .filter(e => this.service.hasFilter(e.status))
        .map(e => new HistoryExecutionItem(e));
    }
    return [];
  }
}

type HistoryItem = HistoryGroupItem | HistoryExecutionItem;

class HistoryGroupItem extends vscode.TreeItem {
  constructor(public readonly group: ITaskHistoryGroup) {
    super(group.taskName, vscode.TreeItemCollapsibleState.Expanded);

    let pathDesc = group.source;
    const firstDef = group.executions[0]?.definition;
    if (firstDef) {
      const defAny = firstDef as any;
      if (defAny.path) {
        pathDesc += ` • ${defAny.path}`;
      } else if (defAny.cwd) {
        pathDesc += ` • ${defAny.cwd}`;
      }
    }

    this.description = pathDesc;
    this.tooltip = group.label;
  }
}

class HistoryExecutionItem extends vscode.TreeItem {
  constructor(public readonly record: ITaskExecutionRecord) {
    super('', vscode.TreeItemCollapsibleState.None);

    const date = new Date(record.startTime);
    const isToday = new Date().toDateString() === date.toDateString();
    const startTimeStr = isToday ? date.toLocaleTimeString() : date.toLocaleString();

    this.label = startTimeStr;
    this.iconPath = this.getStatusIcon(record.status);

    const parts: string[] = [];
    if (record.exitCode !== undefined) {
      parts.push(`Exit Code: ${record.exitCode}`);
    }
    if (record.duration !== undefined) {
      parts.push(`Time: ${this.formatDuration(record.duration)}`);
    }

    this.description = parts.join(' | ');
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'Success': return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      case 'Failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'Terminated': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconSkipped'));
      case 'Running': return new vscode.ThemeIcon('sync~spin');
      default: return new vscode.ThemeIcon('question');
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) { return `${ms}ms`; }
    const seconds = (ms / 1000).toFixed(2);
    return `${seconds}s`;
  }
}
