import * as assert from 'assert';
import * as vscode from 'vscode';
import { LoggerService, LogLevel } from '../../services/loggerService';

suite('LoggerService Test Suite', () => {
  let logger: LoggerService;
  let originalAppendLine: any;
  let loggedMessages: string[] = [];
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let mockDebug = false;

  setup(() => {
    logger = LoggerService.getInstance();
    // Access private properties for testing
    const outputChannel = (logger as any).outputChannel as vscode.OutputChannel;

    // Mock appendLine to capture logs
    originalAppendLine = outputChannel.appendLine;
    outputChannel.appendLine = (message: string) => {
      loggedMessages.push(message);
    };

    // Reset/Ensure log level setup
    // We can't easily reset singleton, but we can reset config or force update
    loggedMessages = [];

    // Mock getConfiguration to return known values so tests don't write real VS Code settings
    mockDebug = false;
    originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        return {
          get: <T>(key: string, defaultValue?: T): T => {
            if (key === 'debug') { return mockDebug as unknown as T; }
            return defaultValue as T;
          },
        };
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    // Restore original method
    const outputChannel = (logger as any).outputChannel as vscode.OutputChannel;
    if (originalAppendLine) {
      outputChannel.appendLine = originalAppendLine;
    }

    // Restore mocked getConfiguration
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('getInstance returns singleton', () => {
    const instance1 = LoggerService.getInstance();
    const instance2 = LoggerService.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  test('Initialization sets up configuration listener', () => {
    // This is hard to test directly without mocking context, but we can verify
    // that the service behaves correctly when config changes.
    // The initialize method is likely called by extension.ts, or we can call it with a mock context if needed.
    // Since it's a singleton likely already initialized or we can validly call initialize again with a mock.

    const contextMock = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    logger.initialize(contextMock);
    assert.strictEqual(contextMock.subscriptions.length, 2); // OutputChannel and ConfigurationListener
  });

  test('Debug logs are ignored by default (LogLevel.Info)', () => {
    // mockDebug is false by default (set in setup) — force the logger to read it
    (logger as any).updateConfiguration();

    logger.debug('This is a debug message');
    assert.strictEqual(loggedMessages.length, 0, 'Debug message should not be logged when level is Info');
  });

  test('Info logs are written', () => {
    logger.info('This is an info message');
    assert.strictEqual(loggedMessages.length, 1);
    assert.match(loggedMessages[0], /\[INFO\] This is an info message/);
  });

  test('Warn logs are written', () => {
    logger.warn('This is a warning');
    assert.strictEqual(loggedMessages.length, 1);
    assert.match(loggedMessages[0], /\[WARN\] This is a warning/);
  });

  test('Error logs are written', () => {
    logger.error('This is an error');
    assert.strictEqual(loggedMessages.length, 1);
    assert.match(loggedMessages[0], /\[ERROR\] This is an error/);
  });

  test('Error logs with Error object', () => {
    const err = new Error('Something went wrong');
    logger.error(err);
    assert.strictEqual(loggedMessages.length, 1);
    assert.match(loggedMessages[0], /\[ERROR\]/);
    assert.ok(loggedMessages[0].includes('Something went wrong'));
  });

  test('Debug logs are written when debug is enabled', () => {
    // Enable debug via the mock then force the logger to re-read it
    mockDebug = true;
    (logger as any).updateConfiguration();

    logger.debug('Debug message visible');
    assert.strictEqual(loggedMessages.length, 1);
    assert.match(loggedMessages[0], /\[DEBUG\] Debug message visible/);
  });

  test('Complex objects are stringified', () => {
    const obj = { foo: 'bar' };
    logger.info('Object:', obj);
    assert.strictEqual(loggedMessages.length, 1);
    assert.ok(loggedMessages[0].includes('{"foo":"bar"}'));
  });
});
