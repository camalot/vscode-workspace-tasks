import { BaseTaskProvider } from './taskProvider';

// Alias so restore() signature is readable without circular wording.
type BaseProvider = BaseTaskProvider;

/**
 * Singleton registry mapping task-type strings to their BaseTaskProvider instances.
 *
 * Providers are registered during extension activation by registerAllProviders()
 * in src/providers/index.ts.
 *
 * The registry is used by _buildTask() in taskFactory.ts to dispatch to the
 * provider's createTask() method before falling back to the legacy switch statement.
 * During the taskFactory refactor, providers are migrated one by one: once a
 * provider's createTask() is implemented and tested, the corresponding legacy switch
 * case is removed. If createTask() returns undefined (the base-class default), the
 * factory falls through to the legacy switch so that not-yet-migrated types keep
 * working unchanged.
 */
export class TaskProviderRegistry {
  private static _instance: TaskProviderRegistry;
  private readonly _registry = new Map<string, BaseTaskProvider>();

  private constructor() {}

  /** Returns the singleton instance, creating it on first call. */
  static getInstance(): TaskProviderRegistry {
    if (!TaskProviderRegistry._instance) {
      TaskProviderRegistry._instance = new TaskProviderRegistry();
    }
    return TaskProviderRegistry._instance;
  }

  /**
   * Registers a provider under its task type.
   * Calling register() with an already-registered type overwrites the previous entry.
   */
  register(type: string, provider: BaseTaskProvider): void {
    this._registry.set(type, provider);
  }

  /** Returns the provider for the given type, or undefined if not registered. */
  get(type: string): BaseTaskProvider | undefined {
    return this._registry.get(type);
  }

  /** Returns a read-only set of all registered type strings. */
  getKnownTypes(): ReadonlySet<string> {
    return new Set(this._registry.keys());
  }

  /** Removes all registrations. Intended for test teardown. */
  clear(): void {
    this._registry.clear();
  }

  /** Removes the registration for a single type. Intended for test teardown. */
  unregister(type: string): void {
    this._registry.delete(type);
  }

  /**
   * Returns a snapshot of the current registry contents.
   * Pair with restore() to isolate tests without permanently clearing production state.
   */
  snapshot(): Map<string, BaseTaskProvider> {
    return new Map(this._registry);
  }

  /**
   * Replaces the registry contents with a previously captured snapshot.
   * Intended for test teardown after setup() called clear().
   */
  restore(snap: Map<string, BaseProvider>): void {
    this._registry.clear();
    for (const [type, provider] of snap) {
      this._registry.set(type, provider);
    }
  }
}
