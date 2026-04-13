import * as vscode from 'vscode';
import * as micromatch from 'micromatch';
import { TaskItem } from '../taskItem';
import { ITaskEnvRule } from './taskEnvTypes';

/**
 * Pure, stateless utility for evaluating `workspaceTasks.taskEnv` rules against a `TaskItem`.
 *
 * All matching is AND-logic across criteria: a rule matches only when every specified field
 * in its `match` object passes. Fields absent from `match` are ignored (wildcard for that
 * dimension).
 */
export class TaskEnvRuleMatcher {
  /**
   * Returns `true` when `rule` applies to `item`.
   *
   * Evaluation order:
   * 1. `enabled === false` → immediate `false`.
   * 2. `taskName` → exact, glob (`*`/`?`), or `/regex/` match against the task's label.
   * 3. `taskType` → case-insensitive match against `item.taskType`; array: any element must match.
   * 4. `source` → `micromatch` glob match against `item.taskFileUri.fsPath`.
   * 5. `workspaceFolder` → exact name match against the workspace folder containing the task file.
   */
  public static matchesRule(item: TaskItem, rule: ITaskEnvRule): boolean {
    if (rule.enabled === false) {
      return false;
    }

    const { match } = rule;

    // ── taskName criterion ────────────────────────────────────────────────────
    if (match.taskName !== undefined) {
      const name = item.originalLabel ?? (item.label as string);
      if (!TaskEnvRuleMatcher.matchesName(name, match.taskName)) {
        return false;
      }
    }

    // ── taskType criterion (case-insensitive) ────────────────────────────────
    if (match.taskType !== undefined) {
      const types = Array.isArray(match.taskType) ? match.taskType : [match.taskType];
      const itemType = item.taskType.toLowerCase();
      if (!types.some((t) => t.toLowerCase() === itemType)) {
        return false;
      }
    }

    // ── source criterion — match against item.taskFileUri fsPath ─────────────
    if (match.source !== undefined) {
      const filePath = item.taskFileUri?.fsPath;
      if (!filePath) {
        return false;
      }
      const patterns = Array.isArray(match.source) ? match.source : [match.source];
      // Normalise to forward-slashes for cross-platform glob matching
      const normalized = filePath.replace(/\\/g, '/');
      const normPatterns = patterns.map((p) => p.replace(/\\/g, '/'));
      if (!micromatch.isMatch(normalized, normPatterns)) {
        return false;
      }
    }

    // ── workspaceFolder criterion — match against workspace folder name ───────
    if (match.workspaceFolder !== undefined) {
      const fileUri = item.taskFileUri ?? item.resourceUri;
      if (!fileUri) {
        return false;
      }
      const wsFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (!wsFolder || wsFolder.name !== match.workspaceFolder) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the subset of `rules` that match `item`, preserving array order.
   */
  public static getMatchingRules(item: TaskItem, rules: ITaskEnvRule[]): ITaskEnvRule[] {
    return rules.filter((rule) => TaskEnvRuleMatcher.matchesRule(item, rule));
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Evaluates a single `taskName` pattern against a task name string.
   *
   * - `/…/` wrapper → compile as `RegExp`.
   * - Contains `*` or `?` → `micromatch` glob.
   * - Otherwise → case-sensitive exact match.
   */
  private static matchesName(name: string, pattern: string): boolean {
    // /regex/ form — must start and end with / with content in between
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      try {
        return new RegExp(pattern.slice(1, -1)).test(name);
      } catch {
        return false;
      }
    }

    // glob form — at least one wildcard character
    if (pattern.includes('*') || pattern.includes('?')) {
      return micromatch.isMatch(name, pattern);
    }

    // exact match
    return name === pattern;
  }
}
