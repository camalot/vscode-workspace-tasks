import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskConfigService } from '../../services/taskConfigService';

suite('TaskConfigService Test Suite', () => {
  let originalGetConfig: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfig = vscode.workspace.getConfiguration.bind(vscode.workspace);
    // Reset singleton so each test gets fresh state
    (TaskConfigService as any).instance = undefined;
  });

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfig;
    (TaskConfigService as any).instance = undefined;
  });

  /**
   * Build a mock getConfiguration stub for 'workspaceTasks' that returns the
   * supplied values for the three settings used by isTaskTypeEnabled.
   */
  function stubConfig(
    enabledTaskTypes: Record<string, boolean>,
    enabledPatterns: string[] = [],
    disabledPatterns: string[] = [],
  ): void {
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      if (section === 'workspaceTasks') {
        const cfg: Record<string, unknown> = {
          enabledTaskTypes,
          enabledTaskTypePatterns: enabledPatterns,
          disabledTaskTypePatterns: disabledPatterns,
        };
        return {
          get: <T>(key: string, def?: T): T =>
            (Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : def) as T,
        };
      }
      return originalGetConfig(section);
    };
  }

  // ── Singleton ──────────────────────────────────────────────────────────────

  test('getInstance returns the same instance each time', () => {
    const a = TaskConfigService.getInstance();
    const b = TaskConfigService.getInstance();
    assert.strictEqual(a, b);
  });

  // ── Step 4 default — no patterns, no explicit config ──────────────────────

  test('default: type absent from enabledTaskTypes returns true', () => {
    stubConfig({});
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('default: type set true in enabledTaskTypes returns true', () => {
    stubConfig({ npm: true });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('default: type set false in enabledTaskTypes returns false', () => {
    stubConfig({ npm: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  // ── Steps 1 & 2 — enabledTaskTypePatterns whitelist ───────────────────────

  test('enabledPatterns: exact match enables type', () => {
    stubConfig({}, ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('enabledPatterns: glob match enables type', () => {
    stubConfig({}, ['n*']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('enabledPatterns: wildcard * enables all types', () => {
    stubConfig({ npm: false }, ['*']);
    // enabledPatterns wins over enabledTaskTypes boolean
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('enabledPatterns: non-matching type is disabled (whitelist mode)', () => {
    stubConfig({}, ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('gradle'), false);
  });

  test('enabledPatterns: whitelist beats enabledTaskTypes true (non-matching type disabled)', () => {
    stubConfig({ gradle: true }, ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('gradle'), false);
  });

  test('enabledPatterns wins over disabledPatterns when both are set', () => {
    // enabledPatterns is non-empty so it has highest priority — disabled patterns are ignored
    stubConfig({}, ['*'], ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  test('enabledPatterns: ["cake","make"] only shows matching types', () => {
    stubConfig({}, ['cake', 'make']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('cake'), true);
    // 'makefile' provider maps to config key 'make' — 'make' pattern matches it
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('makefile'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  // ── Step 3 — disabledTaskTypePatterns ─────────────────────────────────────

  test('disabledPatterns: exact match disables type', () => {
    stubConfig({}, [], ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  test('disabledPatterns: glob match disables type', () => {
    stubConfig({}, [], ['n*']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  test('disabledPatterns: non-matching type unaffected', () => {
    stubConfig({}, [], ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('gradle'), true);
  });

  test('disabledPatterns: wins over enabledTaskTypes explicit true', () => {
    stubConfig({ npm: true }, [], ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  test('disabledPatterns: ["*"] hides all types', () => {
    stubConfig({}, [], ['*']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('gradle'), false);
  });

  test('disabledPatterns: empty array has no effect', () => {
    stubConfig({ npm: true }, [], []);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), true);
  });

  // ── taskTypeMap aliases ────────────────────────────────────────────────────

  test('alias: dockerfile maps to docker config key', () => {
    stubConfig({ docker: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('dockerfile'), false);
  });

  test('alias: docker-compose maps to docker config key', () => {
    stubConfig({ docker: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('docker-compose'), false);
  });

  test('alias: justfile maps to just config key', () => {
    stubConfig({ just: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('justfile'), false);
  });

  test('alias: makefile maps to make config key', () => {
    stubConfig({ make: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('makefile'), false);
  });

  test('alias: typescript maps to typescript config key', () => {
    stubConfig({ typescript: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('typescript'), false);
  });

  test('alias: tsc maps to typescript config key', () => {
    stubConfig({ typescript: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('tsc'), false);
  });

  test('alias: tsc and typescript share the same config key — both disabled together', () => {
    stubConfig({ typescript: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('typescript'), false);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('tsc'), false);
  });

  test('alias: github-action maps to github-actions config key', () => {
    stubConfig({ 'github-actions': false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('github-action'), false);
  });

  test('alias: workspace-task maps to workspace config key', () => {
    stubConfig({ workspace: false });
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('workspace-task'), false);
  });

  test('getConfigKey returns mapped config key for known task types', () => {
    const service = TaskConfigService.getInstance();
    assert.strictEqual(service.getConfigKey('makefile'), 'make');
    assert.strictEqual(service.getConfigKey('docker-compose'), 'docker');
    assert.strictEqual(service.getConfigKey('workspace-task'), 'workspace');
  });

  test('getConfigKey falls back to the original type for unknown task types', () => {
    const service = TaskConfigService.getInstance();
    assert.strictEqual(service.getConfigKey('custom-type'), 'custom-type');
  });

  test('getAdditionalFilePatternConfigKey returns keys only for file-based providers', () => {
    const service = TaskConfigService.getInstance();
    assert.strictEqual(service.getAdditionalFilePatternConfigKey('makefile'), 'make');
    assert.strictEqual(service.getAdditionalFilePatternConfigKey('workspace-task'), 'workspace');
    assert.strictEqual(service.getAdditionalFilePatternConfigKey('gitlab-ci'), 'gitlab-ci');
    assert.strictEqual(service.getAdditionalFilePatternConfigKey('dockerfile'), undefined);
    assert.strictEqual(service.getAdditionalFilePatternConfigKey('eslint'), undefined);
  });

  // ── Patterns match on visible config key (normalised) ──────────────────────

  test('patterns match config key: "docker" enables both dockerfile and docker-compose', () => {
    // Both internal names map to the 'docker' config key — one pattern covers both providers.
    stubConfig({}, ['docker']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('dockerfile'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('docker-compose'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  test('patterns match config key: "docker*" enables both dockerfile and docker-compose', () => {
    stubConfig({}, ['docker*']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('dockerfile'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('docker-compose'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('npm'), false);
  });

  test('patterns: cargo-make not matched by exact "cargo" pattern', () => {
    stubConfig({}, ['cargo']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('cargo'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('cargo-make'), false);
  });

  test('patterns: cargo* matches both cargo and cargo-make', () => {
    stubConfig({}, ['cargo*']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('cargo'), true);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('cargo-make'), true);
  });

  // ── Shell sub-types fall through as own keys ───────────────────────────────

  test('pwsh falls through as its own key when not in taskTypeMap', () => {
    // pwsh is not in taskTypeMap; configKey = 'pwsh'; absent from enabledTaskTypes → true
    stubConfig({});
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('pwsh'), true);
  });

  test('python falls through as its own key when not in taskTypeMap', () => {
    stubConfig({});
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('python'), true);
  });

  test('disabledPatterns can disable shell sub-type by internal name', () => {
    stubConfig({}, [], ['ruby']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('ruby'), false);
  });

  test('enabledPatterns whitelist excludes shell sub-type not in list', () => {
    stubConfig({}, ['npm']);
    assert.strictEqual(TaskConfigService.getInstance().isTaskTypeEnabled('ruby'), false);
  });

  // ── isAnyTaskTypeEnabled ───────────────────────────────────────────────────

  test('isAnyTaskTypeEnabled: true when at least one type is enabled', () => {
    stubConfig({ npm: false });
    assert.strictEqual(
      TaskConfigService.getInstance().isAnyTaskTypeEnabled(['npm', 'gradle']),
      true,
    );
  });

  test('isAnyTaskTypeEnabled: false when all types are disabled', () => {
    stubConfig({}, [], ['*']);
    assert.strictEqual(
      TaskConfigService.getInstance().isAnyTaskTypeEnabled(['npm', 'gradle']),
      false,
    );
  });

  test('isAnyTaskTypeEnabled: false for empty array', () => {
    stubConfig({});
    assert.strictEqual(TaskConfigService.getInstance().isAnyTaskTypeEnabled([]), false);
  });

  // ── areAllTaskTypesEnabled ─────────────────────────────────────────────────

  test('areAllTaskTypesEnabled: true when all types are enabled', () => {
    stubConfig({});
    assert.strictEqual(
      TaskConfigService.getInstance().areAllTaskTypesEnabled(['npm', 'gradle']),
      true,
    );
  });

  test('areAllTaskTypesEnabled: false when one type is disabled', () => {
    stubConfig({ gradle: false });
    assert.strictEqual(
      TaskConfigService.getInstance().areAllTaskTypesEnabled(['npm', 'gradle']),
      false,
    );
  });

  test('areAllTaskTypesEnabled: true for empty array', () => {
    stubConfig({});
    assert.strictEqual(TaskConfigService.getInstance().areAllTaskTypesEnabled([]), true);
  });

  // ── Integration test — real VS Code configuration ─────────────────────────

  test('integration: enabledTaskTypePatterns written via cfg.update controls visibility', async () => {
    const cfg = vscode.workspace.getConfiguration('workspaceTasks');
    const originalEnabled = cfg.get<string[]>('enabledTaskTypePatterns');
    const originalDisabled = cfg.get<string[]>('disabledTaskTypePatterns');

    try {
      // Write a real pattern whitelist and an empty disabled list.
      // This verifies the full path from VS Code config → TaskConfigService → result.
      await cfg.update('enabledTaskTypePatterns', ['npm', 'gradle'], vscode.ConfigurationTarget.Global);
      await cfg.update('disabledTaskTypePatterns', [], vscode.ConfigurationTarget.Global);

      // Re-read after update (singleton must be reset to pick up new config)
      (TaskConfigService as any).instance = undefined;
      const service = TaskConfigService.getInstance();

      assert.strictEqual(service.isTaskTypeEnabled('npm'), true, 'npm should match the whitelist pattern');
      assert.strictEqual(service.isTaskTypeEnabled('gradle'), true, 'gradle should match the whitelist pattern');
      assert.strictEqual(service.isTaskTypeEnabled('maven'), false, 'maven not in pattern list should be hidden');
    } finally {
      await cfg.update('enabledTaskTypePatterns', originalEnabled, vscode.ConfigurationTarget.Global);
      await cfg.update('disabledTaskTypePatterns', originalDisabled, vscode.ConfigurationTarget.Global);
      (TaskConfigService as any).instance = undefined;
    }
  });
});
