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

    // Mock context with workspaceState
    mockContext = {
      workspaceState: {
        get: <T>(key: string) => workspaceStorage.get(key) as T | undefined,
        update: async (key: string, value: unknown) => { workspaceStorage.set(key, value); },
        keys: () => [...workspaceStorage.keys()],
      },
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

    // Mock isGitTracked on the service instance
    originalIsGitTracked = service.isGitTracked.bind(service);
    service.isGitTracked = async (filePath: string) => gitTrackedFiles.has(filePath);
  });

  teardown(() => {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.env as any).openExternal = originalOpenExternal;
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
});
