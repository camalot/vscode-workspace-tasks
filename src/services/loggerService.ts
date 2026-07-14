import * as vscode from 'vscode';

export const LogLevel = {
  Debug: 0,
  Info: 1,
  Warn: 2,
  Error: 3,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

const LOG_LEVEL_NAMES: Record<number, string> = {
  [LogLevel.Debug]: 'Debug',
  [LogLevel.Info]: 'Info',
  [LogLevel.Warn]: 'Warn',
  [LogLevel.Error]: 'Error',
};

export class LoggerService {
  private static instance: LoggerService;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.Info;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Workspace Tasks');
  }

  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  public initialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(this.outputChannel);
    this.updateConfiguration();
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workspaceTasks.debug')) {
          this.updateConfiguration();
        }
      })
    );
  }

  private updateConfiguration() {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const debug = config.get<boolean>('debug', false);
    this.logLevel = debug ? LogLevel.Debug : LogLevel.Info;
  }

  public debug(message: string, ...args: any[]) {
    this.log(LogLevel.Debug, message, ...args);
  }

  public info(message: string, ...args: any[]) {
    this.log(LogLevel.Info, message, ...args);
  }

  public warn(message: string, ...args: any[]) {
    this.log(LogLevel.Warn, message, ...args);
  }

  public error(message: string | Error, ...args: any[]) {
    if (message instanceof Error) {
      this.log(LogLevel.Error, message.message, ...(message.stack ? [message.stack] : []), ...args);
    } else {
      this.log(LogLevel.Error, message, ...args);
    }
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelString = (LOG_LEVEL_NAMES[level] ?? String(level)).toUpperCase();
    let formattedMessage = `[${timestamp}] [${levelString}] ${message}`;

    if (args && args.length > 0) {
      formattedMessage += ' ' + args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
    }

    this.outputChannel.appendLine(formattedMessage);
  }

  public show() {
    this.outputChannel.show();
  }
}
