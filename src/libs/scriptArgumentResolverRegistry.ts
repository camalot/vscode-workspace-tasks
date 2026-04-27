import * as path from 'path';
import { ScriptArgumentResolver, ArgumentResolveResult } from './scriptArgumentResolver';
import { LoggerService } from '../services/loggerService';

/**
 * Registry that maps file extensions to an ordered list of `ScriptArgumentResolver`
 * instances.
 *
 * When `resolveForFile()` is called the registry iterates through the registered
 * resolvers for the file's extension in registration order, returning the first
 * result that is `supported` with at least one parameter.
 *
 * Usage:
 * ```typescript
 * const registry = ScriptArgumentResolverRegistry.getInstance();
 * registry.register('.ps1', new PwshGetHelpResolver());
 * registry.register('.ps1', new PwshStaticParamBlockResolver());
 * registry.register('.py',  new PythonArgparseResolver());
 * ```
 */
export class ScriptArgumentResolverRegistry {
  private static instance: ScriptArgumentResolverRegistry;
  private readonly resolvers = new Map<string, ScriptArgumentResolver[]>();
  private readonly logger = LoggerService.getInstance();

  private constructor() {}

  public static getInstance(): ScriptArgumentResolverRegistry {
    if (!ScriptArgumentResolverRegistry.instance) {
      ScriptArgumentResolverRegistry.instance = new ScriptArgumentResolverRegistry();
    }
    return ScriptArgumentResolverRegistry.instance;
  }

  /**
   * Register a resolver for a file extension.
   *
   * @param extension  File extension including the leading dot, e.g. `'.ps1'`.
   *                   Matching is case-insensitive.
   * @param resolver   The resolver to add.  Resolvers are tried in the order
   *                   they were registered; register higher-priority resolvers first.
   */
  public register(extension: string, resolver: ScriptArgumentResolver): void {
    const key = extension.toLowerCase();
    if (!this.resolvers.has(key)) {
      this.resolvers.set(key, []);
    }
    this.resolvers.get(key)!.push(resolver);
  }

  /**
   * Remove all resolvers registered for the given extension.
   * Primarily intended for use in tests.
   */
  public unregisterAll(extension: string): void {
    this.resolvers.delete(extension.toLowerCase());
  }

  /**
   * Try every registered resolver for the file's extension in order, returning
   * the first `supported` result that contains at least one parameter.
   *
   * Returns `undefined` when no resolvers are registered for the extension, or
   * when all resolvers returned `supported: false` / zero parameters.
   */
  public async resolveForFile(filePath: string, content: string): Promise<ArgumentResolveResult | undefined> {
    const ext = path.extname(filePath).toLowerCase();
    const candidates = this.resolvers.get(ext) ?? [];

    for (const resolver of candidates) {
      if (!resolver.canHandle(filePath)) {
        continue;
      }
      try {
        const result = await resolver.resolve(filePath, content);
        if (result.supported && result.parameters.length > 0) {
          this.logger.debug(`[ScriptArgumentResolverRegistry] '${resolver.name}' resolved ${result.parameters.length} parameter(s) for ${filePath}`);
          return result;
        }
      } catch (err) {
        this.logger.warn(`[ScriptArgumentResolverRegistry] Resolver '${resolver.name}' threw for ${filePath}: ${err}`);
      }
    }

    return undefined;
  }

  /**
   * Returns the list of resolver names registered for an extension.
   * Used in tests to verify registration.
   */
  public getResolverNames(extension: string): string[] {
    return (this.resolvers.get(extension.toLowerCase()) ?? []).map((r) => r.name);
  }
}
