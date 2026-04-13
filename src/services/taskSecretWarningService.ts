import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as micromatch from 'micromatch';
import { IResolvedEnvEntry } from './taskEnvTypes';
import { LoggerService } from './loggerService';

const SUPPRESS_KEY_PREFIX = 'workspaceTasks.secretWarning.suppressed.';
const LEARN_MORE_URL = 'https://camalot.github.io/vscode-workspace-tasks/features/task-environment-variables.html';

/**
 * Singleton service that analyses a resolved env map for security risks and
 * shows one-time per-file warnings when:
 *
 * 1. A non-secret key whose name matches `workspaceTasks.envVars.secretPatterns` is
 *    sourced from a git-tracked file (`.env`, `.workspace-tasks.json`, `settings.json`).
 * 2. A `.secret` file itself is tracked by git.
 *
 * Warnings include a **"Don't warn again"** action that persists suppression to
 * `workspaceState` keyed by the origin file path.
 *
 * Call `initialize(context)` once in `extension.ts` `activate()`.
 */
export class TaskSecretWarningService {
  private static _instance: TaskSecretWarningService;
  private readonly logger = LoggerService.getInstance();
  private context?: vscode.ExtensionContext;

  private constructor() {}

  public static getInstance(): TaskSecretWarningService {
    if (!TaskSecretWarningService._instance) {
      TaskSecretWarningService._instance = new TaskSecretWarningService();
    }
    return TaskSecretWarningService._instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  /**
   * Inspects `resolvedMap` for two classes of risk and shows VS Code warning
   * messages as appropriate.
   *
   * @param taskLabel      Human-readable task name used in the warning message.
   * @param resolvedMap    The full resolved env map from `TaskEnvService.resolveTaskEnv`.
   * @param secretPatterns Patterns from `workspaceTasks.envVars.secretPatterns`.
   */
  public async checkAndWarn(
    taskLabel: string,
    resolvedMap: Map<string, IResolvedEnvEntry>,
    secretPatterns: string[],
  ): Promise<void> {
    if (!this.context || secretPatterns.length === 0) {
      return;
    }

    // ── 1. Suspicious non-secret keys (name matches a secret pattern) ────────────────
    // Group by sourceFilePath so we issue one warning per origin file.
    const suspiciousByFile = new Map<string, string[]>();
    for (const [key, entry] of resolvedMap) {
      if (entry.isSecret || !entry.sourceFilePath) {
        continue;
      }
      if (this.matchesAnyPattern(key, secretPatterns)) {
        const existing = suspiciousByFile.get(entry.sourceFilePath) ?? [];
        existing.push(key);
        suspiciousByFile.set(entry.sourceFilePath, existing);
      }
    }

    for (const [filePath, keys] of suspiciousByFile) {
      if (this.isSuppressed(filePath)) {
        continue;
      }
      const tracked = await this.isGitTracked(filePath);
      if (!tracked) {
        continue;
      }

      const keyList = keys.map((k) => `\`${k}\``).join(', ');
      const basename = path.basename(filePath);
      const msg =
        `Task '${taskLabel}' has environment keys matching secret patterns (${keyList}) ` +
        `in a git-tracked file \`${basename}\`. ` +
        `Move them to a \`.secret\` file or use **Workspace Tasks: Store Secret** to save them securely.`;

      this.logger.warn(`[TaskEnv] ${msg}`);

      const action = await vscode.window.showWarningMessage(msg, 'Learn more', "Don't warn again");
      if (action === 'Learn more') {
        await vscode.env.openExternal(vscode.Uri.parse(LEARN_MORE_URL));
      } else if (action === "Don't warn again") {
        await this.suppress(filePath);
      }
    }

    // ── 2. Git-tracked secret files ──────────────────────────────────────────────────
    const secretFilePaths = new Set<string>();
    for (const entry of resolvedMap.values()) {
      if (
        entry.isSecret &&
        entry.sourceFilePath &&
        entry.source !== 'taskSecretStorage' &&
        entry.source !== 'ruleSecretStorage'
      ) {
        secretFilePaths.add(entry.sourceFilePath);
      }
    }

    for (const filePath of secretFilePaths) {
      if (this.isSuppressed(filePath)) {
        continue;
      }
      const tracked = await this.isGitTracked(filePath);
      if (!tracked) {
        continue;
      }

      const basename = path.basename(filePath);
      const msg = `\`${basename}\` is tracked by git. Secret files should be gitignored.`;

      this.logger.warn(`[TaskEnv] ${msg}`);

      const action = await vscode.window.showWarningMessage(msg, 'Learn more', "Don't warn again");
      if (action === 'Learn more') {
        await vscode.env.openExternal(vscode.Uri.parse(LEARN_MORE_URL));
      } else if (action === "Don't warn again") {
        await this.suppress(filePath);
      }
    }
  }

  /**
   * Returns `true` when `key` matches any of the provided glob-style secretPatterns.
   * Uses micromatch for gitignore-compatible glob matching (case-sensitive).
   */
  public matchesAnyPattern(key: string, patterns: string[]): boolean {
    return micromatch.isMatch(key, patterns, { nocase: false });
  }

  /**
   * Checks whether `filePath` is tracked by git using `git ls-files --error-unmatch`.
   * Times out after 2 seconds and returns `false` on error or timeout.
   */
  public async isGitTracked(filePath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const cwd = path.dirname(filePath);
      const child = cp.execFile(
        'git',
        ['ls-files', '--error-unmatch', filePath],
        { timeout: 2000, cwd },
        (err) => {
          resolve(!err);
        },
      );
      child.on('error', () => resolve(false));
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private suppressKey(filePath: string): string {
    return `${SUPPRESS_KEY_PREFIX}${filePath}`;
  }

  private isSuppressed(filePath: string): boolean {
    return this.context?.workspaceState.get<boolean>(this.suppressKey(filePath)) === true;
  }

  private async suppress(filePath: string): Promise<void> {
    await this.context?.workspaceState.update(this.suppressKey(filePath), true);
  }
}
