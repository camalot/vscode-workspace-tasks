import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { IEnvFileReference } from './workspaceTasksService';
import { LoggerService } from './loggerService';

/**
 * Resolves `IEnvFileReference` values into ordered lists of absolute file paths and
 * parses `.env`/`.secret` files into key-value maps.
 *
 * This utility is intentionally pure (no VS Code state) beyond the `vscode.workspace`
 * API surface used for glob expansion.
 */
export class TaskEnvFileResolver {
  private static readonly logger = LoggerService.getInstance();

  /**
   * Expands an `IEnvFileReference` into an ordered list of absolute file paths.
   *
   * Expansion rules:
   * - A single string: treated as one path/glob relative to `workspaceFolder`.
   * - A string array: each element is a path/glob; processed in array order.
   * - An include/exclude object: globs are expanded via `vscode.workspace.findFiles`
   *   and sorted alphabetically by resolved path for determinism.
   *
   * Glob patterns (matched via `vscode.workspace.findFiles`) return results sorted
   * alphabetically.  Non-glob strings that resolve to existing files are kept as-is;
   * non-existing paths are silently skipped.
   *
   * @param ref - The file reference to resolve.
   * @param workspaceFolder - Workspace root used to resolve relative paths.
   * @returns Ordered list of absolute file paths that exist on disk.
   */
  public static async resolveFileReferences(
    ref: IEnvFileReference,
    workspaceFolder: vscode.Uri,
  ): Promise<string[]> {
    if (typeof ref === 'string') {
      return TaskEnvFileResolver.expandSingleRef(ref, workspaceFolder);
    }

    if (Array.isArray(ref)) {
      const results: string[] = [];
      for (const item of ref) {
        const expanded = await TaskEnvFileResolver.expandSingleRef(item, workspaceFolder);
        results.push(...expanded);
      }
      return results;
    }

    // include/exclude object form
    return TaskEnvFileResolver.expandIncludeExclude(ref, workspaceFolder);
  }

  /**
   * Parses a `.env` or `.secret` file and returns a key→value map.
   *
   * Uses `dotenv.parse()` internally so it supports quoted values, inline comments,
   * and `export` prefixes.  Returns an empty object when the file does not exist or
   * cannot be read — callers must tag the origin (env vs. secret) themselves.
   *
   * @param filePath - Absolute path to the file.
   * @returns Parsed key-value pairs, or `{}` on missing/unreadable file.
   */
  public static parseEnvFile(filePath: string): Record<string, string> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return dotenv.parse(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        TaskEnvFileResolver.logger.debug(
          `[TaskEnvFileResolver] File not found, skipping: ${filePath}`,
        );
      } else {
        TaskEnvFileResolver.logger.warn(
          `[TaskEnvFileResolver] Could not read env file: ${filePath}`,
          err,
        );
      }
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Expands a single string (plain path or glob) to an ordered list of absolute paths.
   *
   * If the string contains glob meta-characters (`*`, `?`, `{`, `[`) it is expanded
   * via `vscode.workspace.findFiles` (relative to the workspace root) and the results
   * are sorted alphabetically.  Otherwise it is resolved as a simple path.
   */
  private static async expandSingleRef(
    ref: string,
    workspaceFolder: vscode.Uri,
  ): Promise<string[]> {
    if (TaskEnvFileResolver.isGlob(ref)) {
      return TaskEnvFileResolver.expandGlob(ref, [], workspaceFolder);
    }

    const absolute = TaskEnvFileResolver.toAbsolute(ref, workspaceFolder);
    return fs.existsSync(absolute) ? [absolute] : [];
  }

  /**
   * Expands an include/exclude glob object to an alphabetically sorted list of
   * absolute file paths.
   */
  private static async expandIncludeExclude(
    ref: { include: string[]; exclude?: string[] },
    workspaceFolder: vscode.Uri,
  ): Promise<string[]> {
    const excludePatterns = ref.exclude ?? [];
    const collected: string[] = [];

    for (const pattern of ref.include) {
      const expanded = await TaskEnvFileResolver.expandGlob(
        pattern,
        excludePatterns,
        workspaceFolder,
      );
      collected.push(...expanded);
    }

    // Deduplicate while preserving first-seen order within the sorted set
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const p of collected.sort()) {
      if (!seen.has(p)) {
        seen.add(p);
        unique.push(p);
      }
    }
    return unique;
  }

  /**
   * Expands a single glob pattern via `vscode.workspace.findFiles`, optionally
   * respecting exclude patterns, and returns results sorted alphabetically.
   *
   * For non-glob patterns this still goes through `findFiles` so workspace-relative
   * semantics are respected.
   */
  private static async expandGlob(
    includePattern: string,
    excludePatterns: string[],
    workspaceFolder: vscode.Uri,
  ): Promise<string[]> {
    try {
      // Build a relative pattern anchored to the workspace folder
      const relativePattern = new vscode.RelativePattern(workspaceFolder, includePattern);
      const excludeGlob =
        excludePatterns.length > 0
          ? `{${excludePatterns.join(',')}}`
          : undefined;

      const uris = await vscode.workspace.findFiles(relativePattern, excludeGlob);
      const paths = uris.map((u) => u.fsPath).sort();
      return paths;
    } catch (err) {
      TaskEnvFileResolver.logger.warn(
        `[TaskEnvFileResolver] Failed to expand glob pattern '${includePattern}'`,
        err,
      );
      return [];
    }
  }

  /**
   * Returns `true` when `ref` contains at least one glob meta-character.
   */
  private static isGlob(ref: string): boolean {
    return /[*?{\[]/.test(ref);
  }

  /**
   * Resolves a path relative to `workspaceFolder` when not already absolute.
   */
  private static toAbsolute(ref: string, workspaceFolder: vscode.Uri): string {
    return path.isAbsolute(ref) ? ref : path.join(workspaceFolder.fsPath, ref);
  }
}
