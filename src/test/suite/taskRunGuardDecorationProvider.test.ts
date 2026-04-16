import * as assert from 'assert';
import * as vscode from 'vscode';
import { TaskRunGuardDecorationProvider } from '../../services/taskRunGuardDecorationProvider';
import { TaskRunGuardService } from '../../services/taskRunGuardService';
import { TaskCacheService } from '../../services/taskCacheService';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('TaskRunGuardDecorationProvider Test Suite', () => {
  let guardChangeEmitter: vscode.EventEmitter<void>;
  let cacheUpdateEmitter: vscode.EventEmitter<void>;
  let originalGuardInstance: any;
  let originalCacheInstance: any;

  setup(() => {
    guardChangeEmitter = new vscode.EventEmitter<void>();
    cacheUpdateEmitter = new vscode.EventEmitter<void>();
    originalGuardInstance = (TaskRunGuardService as any)._instance;
    originalCacheInstance = (TaskCacheService as any).instance;

    // Stub guard service with no-op defaults
    (TaskRunGuardService as any)._instance = {
      onDidChangeGuards: guardChangeEmitter.event,
      isGuarded: () => false,
      isGuardedById: () => false,
    };

    // Stub cache service with no-op defaults
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getTaskById: () => undefined,
    };
  });

  teardown(() => {
    (TaskRunGuardService as any)._instance = originalGuardInstance;
    (TaskCacheService as any).instance = originalCacheInstance;
    guardChangeEmitter.dispose();
    cacheUpdateEmitter.dispose();
  });

  // ── Decoration event subscriptions ────────────────────────────────────────

  test('fires onDidChangeFileDecorations when onDidChangeGuards fires', () => {
    const provider = new TaskRunGuardDecorationProvider();
    let fired = false;
    provider.onDidChangeFileDecorations(() => { fired = true; });

    guardChangeEmitter.fire();

    assert.strictEqual(fired, true, 'decoration change should fire when guard list changes');
  });

  test('fires onDidChangeFileDecorations when TaskCacheService.onDidUpdate fires', () => {
    const provider = new TaskRunGuardDecorationProvider();
    let fired = false;
    provider.onDidChangeFileDecorations(() => { fired = true; });

    cacheUpdateEmitter.fire();

    assert.strictEqual(fired, true,
      'decoration change should fire when cache updates (covers guardedByDefinition changes from .workspace-tasks.json saves)');
  });

  test('fires onDidChangeFileDecorations for each event independently', () => {
    const provider = new TaskRunGuardDecorationProvider();
    let fireCount = 0;
    provider.onDidChangeFileDecorations(() => { fireCount++; });

    guardChangeEmitter.fire();
    cacheUpdateEmitter.fire();

    assert.strictEqual(fireCount, 2, 'each event source should independently trigger decoration refresh');
  });

  // ── provideFileDecoration: URI scheme guard ────────────────────────────────

  test('provideFileDecoration returns undefined for non-workspace-tasks URI', () => {
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.parse('file:///some/path/file.ts');
    assert.strictEqual(provider.provideFileDecoration(uri), undefined);
  });

  test('provideFileDecoration returns undefined for workspace-tasks URI with no query', () => {
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.parse('workspace-tasks:///item');
    assert.strictEqual(provider.provideFileDecoration(uri), undefined);
  });

  // ── provideFileDecoration: guard evaluation ────────────────────────────────

  test('provideFileDecoration returns undefined when task is not guarded', () => {
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.from({ scheme: 'workspace-tasks', path: '/item', query: 'task-id' });
    // Both isGuarded and isGuardedById return false (from setup stubs)
    assert.strictEqual(provider.provideFileDecoration(uri), undefined);
  });

  test('provideFileDecoration returns badge decoration when task is manually guarded (no cache item)', () => {
    (TaskRunGuardService as any)._instance = {
      onDidChangeGuards: guardChangeEmitter.event,
      isGuarded: () => false,
      isGuardedById: () => true, // manual guard found by ID
    };
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.from({ scheme: 'workspace-tasks', path: '/item', query: 'task-id' });
    const decoration = provider.provideFileDecoration(uri);
    assert.ok(decoration, 'Should return a decoration for manually guarded task');
    assert.ok(decoration!.badge, 'Decoration should have a badge');
    assert.ok(decoration!.tooltip, 'Decoration should have a tooltip');
  });

  test('provideFileDecoration uses cached TaskItem for full guard evaluation when available', () => {
    const fakeItem = { guardedByDefinition: true };
    (TaskCacheService as any).instance = {
      onDidUpdate: cacheUpdateEmitter.event,
      getTaskById: () => fakeItem,
    };
    (TaskRunGuardService as any)._instance = {
      onDidChangeGuards: guardChangeEmitter.event,
      isGuarded: (item: any) => item.guardedByDefinition === true,
      isGuardedById: () => false,
    };
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.from({ scheme: 'workspace-tasks', path: '/item', query: 'task-id' });
    const decoration = provider.provideFileDecoration(uri);
    assert.ok(decoration,
      'Should return a decoration when cache item has guardedByDefinition=true (confirm:true in .workspace-tasks.json)');
  });

  test('provideFileDecoration falls back to isGuardedById when task not in cache', () => {
    // Cache returns undefined (item not found); isGuardedById returns true
    (TaskRunGuardService as any)._instance = {
      onDidChangeGuards: guardChangeEmitter.event,
      isGuarded: () => { throw new Error('isGuarded should not be called when no cache item'); },
      isGuardedById: () => true,
    };
    const provider = new TaskRunGuardDecorationProvider();
    const uri = vscode.Uri.from({ scheme: 'workspace-tasks', path: '/item', query: 'task-id' });
    // Should not throw and should return a decoration
    assert.doesNotThrow(() => {
      const decoration = provider.provideFileDecoration(uri);
      assert.ok(decoration, 'Should return a decoration via isGuardedById fallback');
    });
  });
});
