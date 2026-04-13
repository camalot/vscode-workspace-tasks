import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskItem } from '../../taskItem';
import { TaskEnvRuleMatcher } from '../../services/taskEnvRuleMatcher';
import { ITaskEnvRule } from '../../services/taskEnvTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  label: string,
  taskType: string,
  taskFileUri?: vscode.Uri,
): TaskItem {
  const item = new TaskItem(label, vscode.TreeItemCollapsibleState.None, taskType);
  item.originalLabel = label;
  if (taskFileUri) {
    item.taskFileUri = taskFileUri;
  }
  return item;
}

function makeRule(
  match: ITaskEnvRule['match'],
  overrides?: Partial<Omit<ITaskEnvRule, 'match'>>,
): ITaskEnvRule {
  return { match, env: { KEY: 'value' }, ...overrides };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskEnvRuleMatcher Test Suite', () => {
  let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

  setup(() => {
    originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
  });

  teardown(() => {
    (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
  });

  // ── enabled flag ──────────────────────────────────────────────────────────

  test('matchesRule: enabled=false always returns false', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({}, { enabled: false });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: enabled=true (default) allows matching', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({});
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── taskName — exact match ────────────────────────────────────────────────

  test('matchesRule: taskName exact match succeeds', () => {
    const item = makeItem('publish', 'npm');
    const rule = makeRule({ taskName: 'publish' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: taskName exact match fails on different name', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({ taskName: 'publish' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: taskName exact match is case-sensitive', () => {
    const item = makeItem('Publish', 'npm');
    const rule = makeRule({ taskName: 'publish' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  // ── taskName — glob match ─────────────────────────────────────────────────

  test('matchesRule: taskName glob publish* matches publishNpm', () => {
    const item = makeItem('publishNpm', 'npm');
    const rule = makeRule({ taskName: 'publish*' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: taskName glob publish* does not match build', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({ taskName: 'publish*' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: taskName glob with ? matches single char', () => {
    const item = makeItem('test1', 'npm');
    const rule = makeRule({ taskName: 'test?' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── taskName — /regex/ match ──────────────────────────────────────────────

  test('matchesRule: taskName /^publish.*/ matches publishNpm', () => {
    const item = makeItem('publishNpm', 'npm');
    const rule = makeRule({ taskName: '/^publish.*/' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: taskName /^publish.*/ does not match build', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({ taskName: '/^publish.*/' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: taskName with invalid regex returns false', () => {
    const item = makeItem('build', 'npm');
    const rule = makeRule({ taskName: '/[invalid/' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: a single / is treated as exact string, not regex', () => {
    const item = makeItem('/', 'npm');
    const rule = makeRule({ taskName: '/' });
    // length === 1, so not a regex form
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── taskType — string ────────────────────────────────────────────────────

  test('matchesRule: taskType string match succeeds (case-insensitive)', () => {
    const item = makeItem('build', 'NPM');
    const rule = makeRule({ taskType: 'npm' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: taskType string match fails for different type', () => {
    const item = makeItem('build', 'shell');
    const rule = makeRule({ taskType: 'npm' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  // ── taskType — array ──────────────────────────────────────────────────────

  test('matchesRule: taskType array — any element must match', () => {
    const item = makeItem('build', 'maven');
    const rule = makeRule({ taskType: ['npm', 'maven'] });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: taskType array — no match when type absent from array', () => {
    const item = makeItem('build', 'gradle');
    const rule = makeRule({ taskType: ['npm', 'maven'] });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  // ── source ────────────────────────────────────────────────────────────────

  test('matchesRule: source glob **/package.json matches npm task file', () => {
    const item = makeItem('test', 'npm', vscode.Uri.file('/workspace/packages/api/package.json'));
    const rule = makeRule({ source: '**/package.json' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: source glob does not match different file', () => {
    const item = makeItem('test', 'npm', vscode.Uri.file('/workspace/Makefile'));
    const rule = makeRule({ source: '**/package.json' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: source absent on item returns false when source criterion specified', () => {
    const item = makeItem('test', 'npm'); // no taskFileUri
    const rule = makeRule({ source: '**/package.json' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: source as string array — any pattern must match', () => {
    const item = makeItem('test', 'gradle', vscode.Uri.file('/workspace/build.gradle'));
    const rule = makeRule({ source: ['**/package.json', '**/build.gradle'] });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── workspaceFolder ───────────────────────────────────────────────────────

  test('matchesRule: workspaceFolder matches workspace folder name', () => {
    const fileUri = vscode.Uri.file('/workspace/api/package.json');
    const item = makeItem('test', 'npm', fileUri);

    (vscode.workspace as any).getWorkspaceFolder = () => ({
      uri: vscode.Uri.file('/workspace/api'),
      name: 'api',
      index: 0,
    });

    const rule = makeRule({ workspaceFolder: 'api' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  test('matchesRule: workspaceFolder does not match if name differs', () => {
    const fileUri = vscode.Uri.file('/workspace/api/package.json');
    const item = makeItem('test', 'npm', fileUri);

    (vscode.workspace as any).getWorkspaceFolder = () => ({
      uri: vscode.Uri.file('/workspace/api'),
      name: 'api',
      index: 0,
    });

    const rule = makeRule({ workspaceFolder: 'backend' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: workspaceFolder returns false when item has no file URI', () => {
    const item = makeItem('test', 'npm'); // no taskFileUri
    const rule = makeRule({ workspaceFolder: 'api' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: workspaceFolder returns false when getWorkspaceFolder returns undefined', () => {
    const fileUri = vscode.Uri.file('/workspace/api/package.json');
    const item = makeItem('test', 'npm', fileUri);

    (vscode.workspace as any).getWorkspaceFolder = () => undefined;

    const rule = makeRule({ workspaceFolder: 'api' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  // ── empty match — matches all tasks ──────────────────────────────────────

  test('matchesRule: empty match {} matches any task', () => {
    const item = makeItem('anything', 'shell');
    const rule = makeRule({});
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── AND logic across criteria ─────────────────────────────────────────────

  test('matchesRule: AND logic — all criteria must pass', () => {
    const item = makeItem('publish', 'shell');
    // taskName matches but taskType does not
    const rule = makeRule({ taskName: 'publish', taskType: 'npm' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), false);
  });

  test('matchesRule: AND logic — both criteria pass', () => {
    const item = makeItem('publish', 'npm');
    const rule = makeRule({ taskName: 'publish', taskType: 'npm' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });

  // ── getMatchingRules ──────────────────────────────────────────────────────

  test('getMatchingRules: returns only matching rules in original array order', () => {
    const item = makeItem('publish', 'npm');
    const rules: ITaskEnvRule[] = [
      makeRule({ taskName: 'build' }),    // no match
      makeRule({ taskType: 'npm' }),       // match
      makeRule({ taskName: 'publish' }),   // match
      makeRule({ taskType: 'shell' }),     // no match
    ];
    const matches = TaskEnvRuleMatcher.getMatchingRules(item, rules);
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0], rules[1]);
    assert.strictEqual(matches[1], rules[2]);
  });

  test('getMatchingRules: returns empty array when no rules match', () => {
    const item = makeItem('build', 'npm');
    const rules: ITaskEnvRule[] = [
      makeRule({ taskName: 'publish' }),
      makeRule({ taskType: 'shell' }),
    ];
    const matches = TaskEnvRuleMatcher.getMatchingRules(item, rules);
    assert.deepStrictEqual(matches, []);
  });

  test('getMatchingRules: skips disabled rules', () => {
    const item = makeItem('build', 'npm');
    const rules: ITaskEnvRule[] = [
      makeRule({ taskType: 'npm' }, { enabled: false }), // disabled
      makeRule({}),                                       // matches all
    ];
    const matches = TaskEnvRuleMatcher.getMatchingRules(item, rules);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0], rules[1]);
  });

  test('getMatchingRules: rule with only taskType:npm matches all npm tasks', () => {
    const items = [
      makeItem('test', 'npm'),
      makeItem('build', 'npm'),
      makeItem('deploy', 'shell'),
    ];
    const rule = makeRule({ taskType: 'npm' });
    const npmMatches = items.filter((i) => TaskEnvRuleMatcher.matchesRule(i, rule));
    assert.strictEqual(npmMatches.length, 2);
    assert.ok(npmMatches.every((i) => i.taskType === 'npm'));
  });

  // ── originalLabel takes precedence over label ─────────────────────────────

  test('matchesRule: uses originalLabel for name matching when set', () => {
    const item = makeItem('build', 'npm');
    item.originalLabel = 'build:prod';
    const rule = makeRule({ taskName: 'build:prod' });
    assert.strictEqual(TaskEnvRuleMatcher.matchesRule(item, rule), true);
  });
});
