import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskHistoryService, ITaskExecutionRecord } from './services/taskHistoryService';

export class TaskHistoryTableViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'workspaceTasksHistoryTableView';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
  ) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview();

    const historyService = TaskHistoryService.getInstance();
    const changeListener = historyService.onDidChange(() => {
      this.updateWebview();
    });

    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateWebview();
      }
    });

    webviewView.onDidDispose(() => {
      changeListener.dispose();
      visibilityListener.dispose();
    });

    // Initial load
    this.updateWebview();
  }

  private updateWebview() {
    if (this._view && this._view.visible) {
      const historyService = TaskHistoryService.getInstance();
      const executions = historyService.getAllExecutions()
        .filter(record => historyService.hasFilter(record.status));
      const data = executions.map(record => this.formatRecord(record));
      this._view.webview.postMessage({ command: 'loadData', data: data });
    }
  }

  private formatRecord(record: ITaskExecutionRecord) {
    let sourcePath = '';
    if (record.definition) {
      const defAny = record.definition as any;
      if (defAny.path) {
        sourcePath = defAny.path;
      } else if (defAny.cwd) {
        sourcePath = defAny.cwd;
      }
    }

    return {
      status: record.status,
      type: record.taskSource,
      task: record.taskName,
      source: sourcePath,
      timestamp: new Date(record.startTime).toLocaleString(),
      timestampRaw: record.startTime,
      exitCode: record.exitCode,
      executionTime: this.formatDuration(record.duration),
      durationRaw: record.duration
    };
  }

  private formatDuration(ms?: number): string {
    if (ms === undefined) { return ''; }
    if (ms < 1000) { return `${ms}ms`; }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private _getHtmlForWebview(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'res', 'webviews', 'taskHistory.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
    return htmlContent;
  }
}
