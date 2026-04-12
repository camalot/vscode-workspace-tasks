import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskHistoryService, ITaskExecutionRecord } from './services/taskHistoryService';
import { TaskMetricsService } from './services/taskMetricsService';

export class TaskHistoryTableViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'workspaceTasksHistoryTableView';

  private _view?: vscode.WebviewView;
  private _updateTimer: ReturnType<typeof setTimeout> | undefined;

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
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    const historyService = TaskHistoryService.getInstance();
    const metricsService = TaskMetricsService.getInstance();

    const changeListener = historyService.onDidChange(() => {
      this.updateWebview();
    });

    const metricsListener = metricsService.onDidChangeMetrics(() => {
      this.updateWebview();
    });

    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateWebview();
      }
    });

    const messageListener = webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'clearMetrics') {
        const taskId: string | undefined = message.taskId;
        // Only per-task clear is supported from the webview; clear-all requires the command palette
        if (taskId) {
          metricsService.clearMetrics(taskId);
        }
      } else if (message.command === 'requestDashboardData') {
        // Respond with full (unstripped) metrics — recentDurations and hourlyRunCounts are
        // needed by the dashboard charts. History is bundled in the same message to guarantee
        // atomicity: renderDashboard() uses the snapshot from this response, not the
        // potentially-stale global historyData that may have been updated by a concurrent loadData.
        const rawMetrics = metricsService.getAllMetrics();
        const history = this._buildHistory();
        webviewView.webview.postMessage({
          command: 'loadDashboardData',
          data: { metrics: rawMetrics, history },
        });
      }
    });

    webviewView.onDidDispose(() => {
      changeListener.dispose();
      metricsListener.dispose();
      visibilityListener.dispose();
      messageListener.dispose();
      this._view = undefined;
    });

    // Initial load
    this.updateWebview();
  }

  private updateWebview() {
    // Debounce: coalesce rapid back-to-back calls (e.g. history change + metrics change
    // firing in the same tick when a task completes) into a single render.
    if (this._updateTimer !== undefined) {
      clearTimeout(this._updateTimer);
    }
    this._updateTimer = setTimeout(() => {
      this._updateTimer = undefined;
      this._doUpdateWebview();
    }, 0);
  }

  private _doUpdateWebview() {
    if (this._view && this._view.visible) {
      const metricsService = TaskMetricsService.getInstance();

      const history = this._buildHistory();

      // Strip large per-task arrays (recentDurations, hourlyRunCounts) before sending to the
      // webview — they are not displayed and can be hundreds of numbers per task.
      const rawMetrics = metricsService.getAllMetrics();
      const metrics = Object.fromEntries(
        Object.entries(rawMetrics).map(([k, v]) => {
          const { recentDurations: _r, hourlyRunCounts: _h, ...rest } = v;
          return [k, rest];
        })
      );

      this._view.webview.postMessage({ command: 'loadData', data: { history, metrics } });
    }
  }

  /**
   * Returns the current filtered, formatted history records.
   * This is the single authoritative method for building the history payload sent to the webview.
   */
  private _buildHistory() {
    const historyService = TaskHistoryService.getInstance();
    const executions = historyService.getAllExecutions()
      .filter(record => historyService.hasFilter(record.status));
    return executions.map(record => this.formatRecord(record));
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
      durationRaw: record.duration,
      metricsKey: `${record.taskSource}:${record.taskName}:${record.scope}`
    };
  }

  private formatDuration(ms?: number): string {
    if (ms === undefined) { return ''; }
    if (ms < 1000) { return `${ms}ms`; }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'res', 'webviews', 'taskHistory.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const nonce = getNonce();

    const chartJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'res', 'webviews', 'lib', 'chart.umd.min.js')
    );

    htmlContent = htmlContent.replace(/{{cspSource}}/g, webview.cspSource);
    htmlContent = htmlContent.replace(/{{nonce}}/g, nonce);
    htmlContent = htmlContent.replace(/{{chartJsUri}}/g, chartJsUri.toString());

    return htmlContent;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
