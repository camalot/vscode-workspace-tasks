import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskSecretWarningService } from '../../services/taskSecretWarningService';
import { TaskEnvFileResolver } from '../../services/taskEnvFileResolver';
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

  // ── checkConfiguredEnvFilesForGitTracking ─────────────────────────────────

  suite('checkConfiguredEnvFilesForGitTracking', () => {
    let subOriginalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let originalResolveFileReferences: typeof TaskEnvFileResolver.resolveFileReferences;
    let originalWorkspaceFoldersDescriptor: PropertyDescriptor | undefined;

    /** Paths returned by the mocked resolveFileReferences for envFiles */
    let resolvedEnvFiles: string[];
    /** Paths returned by the mocked resolveFileReferences for secretFiles */
    let resolvedSecretFiles: string[];
    /** Controls the mocked value of workspaceTasks.envVars.warnIfGitTracked */
    let warnEnabled: boolean;

    setup(() => {
      resolvedEnvFiles = [];
      resolvedSecretFiles = [];
      warnEnabled = true;

      // Mock getConfiguration.
      // Sentinel values ('env-marker', 'secret-marker') let the resolveFileReferences mock
      // return different paths depending on which setting is being resolved.
      subOriginalGetConfiguration = vscode.workspace.getConfiguration;
      (vscode.workspace as any).getConfiguration = (section?: string) => {
        if (section === 'workspaceTasks') {
          return {
            get: <T>(key: string, def?: T): T => {
              if (key === 'envVars.warnIfGitTracked') { return warnEnabled as unknown as T; }
              if (key === 'envVars.envFiles') { return 'env-marker' as unknown as T; }
              if (key === 'envVars.secretFiles') { return 'secret-marker' as unknown as T; }
              return def as T;
            },
          };
        }
        return subOriginalGetConfiguration(section);
      };

      // Ensure workspaceFolders always has at least one entry so the internal loop runs.
      originalWorkspaceFoldersDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        get: () => [{ uri: vscode.Uri.file('/test/workspace'), name: 'workspace', index: 0 }],
        configurable: true,
      });

      // Stub resolveFileReferences to avoid real filesystem/glob operations.
      originalResolveFileReferences = TaskEnvFileResolver.resolveFileReferences.bind(TaskEnvFileResolver) as any;
      (TaskEnvFileResolver as any).resolveFileReferences = async (ref: any, _folder: any): Promise<string[]> => {
        if (ref === 'env-marker') { return [...resolvedEnvFiles]; }
        if (ref === 'secret-marker') { return [...resolvedSecretFiles]; }
        return [];
      };
    });

    teardown(() => {
      (vscode.workspace as any).getConfiguration = subOriginalGetConfiguration;
      if (originalWorkspaceFoldersDescriptor) {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', originalWorkspaceFoldersDescriptor);
      }
      (TaskEnvFileResolver as any).resolveFileReferences = originalResolveFileReferences;
    });

    /** Convenience: returns diagnostics for the given absolute path from the service's collection. */
    function getDiagnostics(filePath: string): readonly vscode.Diagnostic[] {
      const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
      return collection.get(vscode.Uri.file(filePath)) ?? [];
    }

    test('warnIfGitTracked disabled: no diagnostics emitted even when file is git-tracked', async () => {
      warnEnabled = false;
      resolvedEnvFiles = ['/project/.env'];
      gitTrackedFiles.add('/project/.env');

      await service.checkConfiguredEnvFilesForGitTracking();

      const diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 0, 'No diagnostics should be emitted when warnIfGitTracked is false');
    });

    test('envFiles: git-tracked file produces config-env-file-git-tracked diagnostic', async () => {
      resolvedEnvFiles = ['/project/.env'];
      gitTrackedFiles.add('/project/.env');

      await service.checkConfiguredEnvFilesForGitTracking();

      const diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 1, 'Should have exactly one diagnostic');
      assert.strictEqual(diags[0].code, 'config-env-file-git-tracked',
        `Diagnostic code should be config-env-file-git-tracked, got: ${diags[0].code}`);
      assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Warning);
      assert.strictEqual(diags[0].source, 'Workspace Tasks');
      assert.ok(
        diags[0].message.includes('envFiles'),
        `Diagnostic message should mention 'envFiles', got: ${diags[0].message}`,
      );
      assert.ok(
        diags[0].message.includes('.gitignore'),
        `Diagnostic message should recommend .gitignore, got: ${diags[0].message}`,
      );
    });

    test('secretFiles: git-tracked file produces config-secret-file-git-tracked diagnostic', async () => {
      resolvedSecretFiles = ['/project/.secret'];
      gitTrackedFiles.add('/project/.secret');

      await service.checkConfiguredEnvFilesForGitTracking();

      const diags = getDiagnostics('/project/.secret');
      assert.strictEqual(diags.length, 1, 'Should have exactly one diagnostic');
      assert.strictEqual(diags[0].code, 'config-secret-file-git-tracked',
        `Diagnostic code should be config-secret-file-git-tracked, got: ${diags[0].code}`);
      assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Warning);
      assert.ok(
        diags[0].message.includes('secretFiles'),
        `Diagnostic message should mention 'secretFiles', got: ${diags[0].message}`,
      );
    });

    test('non-tracked envFiles file produces no diagnostic', async () => {
      resolvedEnvFiles = ['/project/.env'];
      // gitTrackedFiles is empty — file is not tracked by git

      await service.checkConfiguredEnvFilesForGitTracking();

      const diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 0, 'Non-tracked file should produce no diagnostic');
    });

    test('clearConfigFileDiagnostics: preserves task-run diagnostics', async () => {
      // Add a pre-existing task-run diagnostic (suspicious-env-key) on the same file.
      const collection = (service as any).diagnosticCollection as vscode.DiagnosticCollection;
      const uri = vscode.Uri.file('/project/.env');
      const taskRunDiag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        'Environment key `MY_TOKEN` matches a secret pattern in a git-tracked file.',
        vscode.DiagnosticSeverity.Warning,
      );
      taskRunDiag.source = 'Workspace Tasks';
      taskRunDiag.code = 'suspicious-env-key';
      collection.set(uri, [taskRunDiag]);

      // Produce a config-file diagnostic on the same file.
      resolvedEnvFiles = ['/project/.env'];
      gitTrackedFiles.add('/project/.env');
      await service.checkConfiguredEnvFilesForGitTracking();

      let diags = collection.get(uri) ?? [];
      assert.strictEqual(diags.length, 2, 'Prerequisite: both task-run and config-file diagnostics should exist');

      // Clear only config-file diagnostics.
      (service as any).clearConfigFileDiagnostics();

      diags = collection.get(uri) ?? [];
      assert.strictEqual(diags.length, 1, 'Should retain the task-run diagnostic after clearing config diagnostics');
      assert.strictEqual(diags[0].code, 'suspicious-env-key', 'Surviving diagnostic should be the task-run one');
    });

    test('re-run after disabling warnIfGitTracked clears existing config diagnostics', async () => {
      // First run with the setting enabled — should produce a diagnostic.
      resolvedEnvFiles = ['/project/.env'];
      gitTrackedFiles.add('/project/.env');
      await service.checkConfiguredEnvFilesForGitTracking();

      let diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 1, 'Prerequisite: diagnostic should exist after first run');

      // Second run with the setting disabled — diagnostic should be cleared.
      warnEnabled = false;
      await service.checkConfiguredEnvFilesForGitTracking();

      diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 0, 'Config diagnostic should be removed after disabling warnIfGitTracked');
    });

    test('duplicate calls do not create duplicate diagnostics', async () => {
      resolvedEnvFiles = ['/project/.env'];
      gitTrackedFiles.add('/project/.env');

      await service.checkConfiguredEnvFilesForGitTracking();
      await service.checkConfiguredEnvFilesForGitTracking();

      const diags = getDiagnostics('/project/.env');
      assert.strictEqual(diags.length, 1, 'Should not duplicate config-file diagnostics across repeated calls');
    });
  });
});
