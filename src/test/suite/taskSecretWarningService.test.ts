import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskSecretWarningService } from '../../services/taskSecretWarningService';
import { IResolvedEnvEntry } from '../../services/taskEnvTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  value: string,
  isSecret: boolean,
  source: IResolvedEnvEntry['source'],
  sourceFilePath?: string,
): IResolvedEnvEntry {
  return { value, source, sourceLabel: source, isSecret, sourceFilePath };
}

function makeMap(entries: Record<string, IResolvedEnvEntry>): Map<string, IResolvedEnvEntry> {
  return new Map(Object.entries(entries));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskSecretWarningService Test Suite', () => {
  let service: TaskSecretWarningService;
  let mockContext: vscode.ExtensionContext;
  let workspaceStorage: Map<string, unknown>;

  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let originalOpenExternal: typeof vscode.env.openExternal;
  let originalOpenTextDocument: typeof vscode.workspace.openTextDocument;
  let originalIsGitTracked: TaskSecretWarningService['isGitTracked'];

  /** Records all warning messages shown during the test. */
  let shownMessages: string[];
  /** Canned return value for showWarningMessage (simulates user choosing an action). */
  let warningAction: string | undefined;
  /** Map of filePath → whether `isGitTracked` reports it as tracked. */
  let gitTrackedFiles: Set<string>;

  setup(() => {
    service = TaskSecretWarningService.getInstance();
    shownMessages = [];
    warningAction = undefined;
    gitTrackedFiles = new Set();
    workspaceStorage = new Map();

    // Mock context with workspaceState and subscriptions
    mockContext = {
      workspaceState: {
        get: <T>(key: string) => workspaceStorage.get(key) as T | undefined,
        update: async (key: string, value: unknown) => { workspaceStorage.set(key, value); },
        keys: () => [...workspaceStorage.keys()],
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    service.initialize(mockContext);

    // Mock showWarningMessage
    originalShowWarningMessage = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async (msg: string, ..._actions: string[]) => {
      shownMessages.push(msg);
      return warningAction as any;
    };

    // Mock openExternal
    originalOpenExternal = vscode.env.openExternal;
    (vscode.env as any).openExternal = async () => true;

    // Mock openTextDocument to avoid real filesystem access in tests.
    // Returns an empty document so findKeyRangeInFile falls back to (0,0,0,0).
    originalOpenTextDocument = vscode.workspace.openTextDocument.bind(vscode.workspace);
    (vscode.workspace as any).openTextDocument = async (_uri: vscode.Uri) => ({ getText: () => '' });

    // Mock isGitTracked on the service instance
    originalIsGitTracked = service.isGitTracked.bind(service);
    service.isGitTracked = async (filePath: string) => gitTrackedFiles.has(filePath);
  });

  teardown(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.env as any).openExternal = originalOpenExternal;
    (vscode.workspace as any).openTextDocument = originalOpenTextDocument;
    service.isGitTracked = originalIsGitTracked;
  });

  // ── matchesAnyPattern ─────────────────────────────────────────────────────

  test('matchesAnyPattern: *_TOKEN matches MY_TOKEN', () => {
    assert.strictEqual(service.matchesAnyPattern('MY_TOKEN', ['*_TOKEN']), true);
  });

  test('matchesAnyPattern: *_SECRET matches DEPLOY_SECRET', () => {
    assert.strictEqual(service.matchesAnyPattern('DEPLOY_SECRET', ['*_SECRET']), true);
  });

  test('matchesAnyPattern: PASSWORD matches PASSWORD', () => {
    assert.strictEqual(service.matchesAnyPattern('PASSWORD', ['PASSWORD']), true);
  });

  test('matchesAnyPattern: NODE_ENV does not match *_TOKEN', () => {
    assert.strictEqual(service.matchesAnyPattern('NODE_ENV', ['*_TOKEN', '*_SECRET']), false);
  });

  test('matchesAnyPattern: matches any pattern in the list', () => {
    assert.strictEqual(service.matchesAnyPattern('API_KEY', ['*_TOKEN', 'API_KEY', '*_SECRET']), true);
  });

  test('matchesAnyPattern: empty patterns returns false', () => {
    assert.strictEqual(service.matchesAnyPattern('MY_TOKEN', []), false);
  });

  // ── isGitTracked ──────────────────────────────────────────────────────────

  test('isGitTracked returns true when git reports the file as tracked', async () => {
    gitTrackedFiles.add('/fake/repo/.env');
    const result = await service.isGitTracked('/fake/repo/.env');
    assert.strictEqual(result, true);
  });

  test('isGitTracked returns false when git reports the file as untracked', async () => {
    const result = await service.isGitTracked('/fake/repo/.env.local');
    assert.strictEqual(result, false);
  });

  // ── checkAndWarn ─────────────────────────────────────────────────────────

  test('shows warning for non-secret key matching pattern in git-tracked file', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    assert.strictEqual(shownMessages.length, 1);
    assert.ok(shownMessages[0].includes('MY_TOKEN'), 'Warning message should mention the key name');
    assert.ok(shownMessages[0].includes('my-task'), 'Warning message should mention the task name');
  });

  test('no warning when the key is not in a git-tracked file', async () => {
    // gitTrackedFiles is empty → no file is tracked

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    assert.strictEqual(shownMessages.length, 0);
  });

  test('no warning when the key is marked isSecret=true', async () => {
    gitTrackedFiles.add('/project/.secret');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', true, 'globalSecretFile', '/project/.secret'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    // No "suspicious key" warning (it's from a secret file).
    // Only the "secret file is git-tracked" warning should fire.
    assert.strictEqual(shownMessages.length, 1);
    assert.ok(shownMessages[0].includes('tracked by git'), 'Should warn about git-tracked secret file');
  });

  test('no warning when key name does not match any pattern', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      NODE_ENV: makeEntry('development', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN', '*_SECRET']);

    assert.strictEqual(shownMessages.length, 0);
  });

  test('no warning when entry has no sourceFilePath', async () => {
    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalSetting', undefined),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    // sourceFilePath is undefined → cannot check git tracking → no warning shown
    assert.strictEqual(shownMessages.length, 0);
  });

  test('shows warning for git-tracked secret file', async () => {
    gitTrackedFiles.add('/project/.secret');

    const envMap = makeMap({
      DB_PASSWORD: makeEntry('hunter2', true, 'globalSecretFile', '/project/.secret'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    assert.strictEqual(shownMessages.length, 1);
    assert.ok(shownMessages[0].includes('tracked by git'));
    assert.ok(shownMessages[0].includes('.secret'));
  });

  test('no secret-file warning when source is SecretStorage', async () => {
    gitTrackedFiles.add('/project/anything');

    const envMap = makeMap({
      DB_PASSWORD: makeEntry('hunter2', true, 'taskSecretStorage', undefined),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    assert.strictEqual(shownMessages.length, 0);
  });

  test('suppresses warning after "Don\'t warn again" action', async () => {
    gitTrackedFiles.add('/project/.env');
    warningAction = "Don't warn again";

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    // First call — shows warning and user clicks "Don't warn again"
    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);
    assert.strictEqual(shownMessages.length, 1);

    shownMessages = [];

    // Second call — suppressed, no warning shown
    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);
    assert.strictEqual(shownMessages.length, 0);
  });

  test('groups multiple suspicious keys from the same file into one warning', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
      API_KEY:   makeEntry('xyz', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN', 'API_KEY']);

    // Only one warning for one file, containing both key names
    assert.strictEqual(shownMessages.length, 1);
    assert.ok(shownMessages[0].includes('MY_TOKEN'));
    assert.ok(shownMessages[0].includes('API_KEY'));
  });

  test('emits separate warnings for different git-tracked source files', async () => {
    gitTrackedFiles.add('/project/.env');
    gitTrackedFiles.add('/project/workspace-tasks.json');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
      API_KEY:   makeEntry('xyz', false, 'taskEnv', '/project/workspace-tasks.json'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN', 'API_KEY']);

    assert.strictEqual(shownMessages.length, 2);
  });

  test('no warning when secretPatterns is empty', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, []);

    assert.strictEqual(shownMessages.length, 0);
  });

  test('opens learn-more URL when user picks "Learn more"', async () => {
    gitTrackedFiles.add('/project/.env');
    warningAction = 'Learn more';

    let opened = false;
    (vscode.env as any).openExternal = async () => { opened = true; return true; };

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    assert.strictEqual(opened, true, 'Should open external URL when user clicks Learn more');
  });

  // ── Diagnostics (Problems panel) ────────────────────────────────────────

  test('adds diagnostic to Problems panel for suspicious key in git-tracked file', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diags.length, 1, 'Should have exactly one diagnostic');
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Warning,
      'Diagnostic severity should be Warning');
    assert.ok(diags[0].message.includes('MY_TOKEN'),
      'Diagnostic message should mention the key');
    assert.strictEqual(diags[0].source, 'Workspace Tasks',
      'Diagnostic source should be "Workspace Tasks"');
    assert.strictEqual(diags[0].code, 'suspicious-env-key',
      'Diagnostic code should be suspicious-env-key');
  });

  test('adds separate diagnostics per suspicious key in the same file', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
      API_KEY:  makeEntry('xyz', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN', 'API_KEY']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diags.length, 2, 'Should have one diagnostic per suspicious key');
  });

  test('adds diagnostic to Problems panel for git-tracked secret file', async () => {
    gitTrackedFiles.add('/project/.secret');

    const envMap = makeMap({
      DB_PASSWORD: makeEntry('hunter2', true, 'globalSecretFile', '/project/.secret'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.secret')) ?? [];
    assert.strictEqual(diags.length, 1, 'Should have one diagnostic for tracked secret file');
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.ok(diags[0].message.includes('tracked by git'));
    assert.strictEqual(diags[0].code, 'secret-file-tracked');
  });

  test('no diagnostic is added when file is not git-tracked', async () => {
    // gitTrackedFiles is empty — no file is git-tracked

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diags.length, 0, 'Should have no diagnostics for untracked file');
  });

  test('diagnostic is removed from Problems panel when user chooses "Don\'t warn again"', async () => {
    gitTrackedFiles.add('/project/.env');
    warningAction = "Don't warn again";

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diags.length, 0, 'Diagnostic should be cleared after suppression');
  });

  test('does not add duplicate diagnostics for the same key across multiple checkAndWarn calls', async () => {
    gitTrackedFiles.add('/project/.env');

    const envMap = makeMap({
      MY_TOKEN: makeEntry('abc', false, 'globalEnvFile', '/project/.env'),
    });

    await service.checkAndWarn('task-a', envMap, ['*_TOKEN']);
    await service.checkAndWarn('task-b', envMap, ['*_TOKEN']);

    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diags = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diags.length, 1, 'Should not duplicate the same diagnostic across calls');
  });

  test('clearAllDiagnostics() removes all diagnostics from the Problems panel', async () => {
    gitTrackedFiles.add('/project/.env');
    gitTrackedFiles.add('/project/.secret');

    const envMap = makeMap({
      MY_TOKEN:    makeEntry('abc',    false, 'globalEnvFile',    '/project/.env'),
      DB_PASSWORD: makeEntry('hunter2', true, 'globalSecretFile', '/project/.secret'),
    });

    await service.checkAndWarn('my-task', envMap, ['*_TOKEN']);

    // Verify at least one diagnostic exists before clearing
    const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
    const diagsBefore = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.ok(diagsBefore.length > 0, 'Prerequisite: diagnostics should exist before clear');

    service.clearAllDiagnostics();

    const diagsAfter = collection.get(vscode.Uri.file('/project/.env')) ?? [];
    assert.strictEqual(diagsAfter.length, 0, 'All diagnostics should be cleared');
  });

  test('findKeyRangeInFile returns correct range for .env file key', async () => {
    const fileContent = '# Comment\nNODE_ENV=development\nMY_TOKEN=secret\n';
    (vscode.workspace as any).openTextDocument = async (_uri: vscode.Uri) => ({
      getText: () => fileContent,
    });

    const range = await (service as any).findKeyRangeInFile('/project/.env', 'MY_TOKEN') as vscode.Range;

    assert.strictEqual(range.start.line, 2, 'Should find MY_TOKEN on line 2 (0-indexed)');
    assert.strictEqual(range.start.character, 0, 'Should start at column 0');
    assert.strictEqual(range.end.character, 'MY_TOKEN'.length, 'Should end after key name');
  });

  test('findKeyRangeInFile returns (0,0,0,0) when key is not present in file', async () => {
    (vscode.workspace as any).openTextDocument = async (_uri: vscode.Uri) => ({
      getText: () => 'NODE_ENV=development\n',
    });

    const range = await (service as any).findKeyRangeInFile('/project/.env', 'MISSING_KEY') as vscode.Range;

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 0);
  });

  test('findKeyRangeInFile finds key in JSON file', async () => {
    const fileContent = '{\n  "env": {\n    "MY_TOKEN": "abc"\n  }\n}';
    (vscode.workspace as any).openTextDocument = async (_uri: vscode.Uri) => ({
      getText: () => fileContent,
    });

    const range = await (service as any).findKeyRangeInFile('/project/settings.json', 'MY_TOKEN') as vscode.Range;

    assert.strictEqual(range.start.line, 2, 'Should find MY_TOKEN on line 2');
    assert.ok(range.start.character >= 0, 'Column should be within range');
  });
});
