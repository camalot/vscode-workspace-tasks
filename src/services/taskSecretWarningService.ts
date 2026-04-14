import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as micromatch from 'micromatch';
import { IResolvedEnvEntry } from './taskEnvTypes';
import { IEnvFileReference } from './workspaceTasksService';
import { TaskEnvFileResolver } from './taskEnvFileResolver';
import { LoggerService } from './loggerService';

const SUPPRESS_KEY_PREFIX = 'workspaceTasks.secretWarning.suppressed.';
const LEARN_MORE_URL = 'https://camalot.github.io/vscode-workspace-tasks/features/task-environment-variables.html';
const DIAGNOSTIC_SOURCE = 'Workspace Tasks';

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
  private diagnosticCollection!: vscode.DiagnosticCollection;

  private constructor() {}

  public static getInstance(): TaskSecretWarningService {
    if (!TaskSecretWarningService._instance) {
      TaskSecretWarningService._instance = new TaskSecretWarningService();
    }
    return TaskSecretWarningService._instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    // Dispose any previously created collection (e.g. when re-initialised in tests)
    this.diagnosticCollection?.dispose();
    this.context = context;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('workspaceTasks');
    context.subscriptions.push(this.diagnosticCollection);
  }

  /**
   * Removes all diagnostics from the Problems panel.
   * Called whenever env / secret sources change so that stale warnings are cleared
   * before the next task run re-evaluates the files.
   */
  public clearAllDiagnostics(): void {
    this.diagnosticCollection?.clear();
  }

  /**
   * Proactively checks all files listed in `workspaceTasks.envVars.envFiles` and
   * `workspaceTasks.envVars.secretFiles` against git on activation and config change.
   *
   * Emits a `DiagnosticSeverity.Warning` in the Problems panel for each file that is
   * currently tracked by git.  No popup is shown — diagnostics only.
   *
   * Controlled by `workspaceTasks.envVars.warnIfGitTracked` (default `true`).
   * When disabled, any previously emitted config-file diagnostics are cleared.
   */
  public async checkConfiguredEnvFilesForGitTracking(): Promise<void> {
    if (!this.diagnosticCollection) {
      return;
    }

    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const warnEnabled = config.get<boolean>('envVars.warnIfGitTracked', true);

    if (!warnEnabled) {
      this.clearConfigFileDiagnostics();
      return;
    }

    const envFilesRef = config.get<IEnvFileReference>('envVars.envFiles') ?? [];
    const secretFilesRef = config.get<IEnvFileReference>('envVars.secretFiles') ?? [];
    const folders = vscode.workspace.workspaceFolders ?? [];

    // Resolve all configured paths across workspace folders, deduplicating by absolute path.
    const envFilePaths = new Set<string>();
    const secretFilePaths = new Set<string>();

    for (const folder of folders) {
      const resolvedEnv = await TaskEnvFileResolver.resolveFileReferences(envFilesRef, folder.uri);
      for (const p of resolvedEnv) {
        envFilePaths.add(p);
      }
      const resolvedSecret = await TaskEnvFileResolver.resolveFileReferences(secretFilesRef, folder.uri);
      for (const p of resolvedSecret) {
        secretFilePaths.add(p);
      }
    }

    // Clear stale config diagnostics before re-populating so removed files don't linger.
    this.clearConfigFileDiagnostics();

    for (const filePath of envFilePaths) {
      const tracked = await this.isGitTracked(filePath);
      if (tracked) {
        this.logger.warn(`[TaskEnv] ${path.basename(filePath)} is configured in envFiles and is tracked by git.`);
        this.addConfigEnvFileDiagnostic(filePath, 'envFiles');
      }
    }

    for (const filePath of secretFilePaths) {
      const tracked = await this.isGitTracked(filePath);
      if (tracked) {
        this.logger.warn(`[TaskEnv] ${path.basename(filePath)} is configured in secretFiles and is tracked by git.`);
        this.addConfigEnvFileDiagnostic(filePath, 'secretFiles');
      }
    }
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

      // Add entries to the VS Code Problems panel
      await this.addSuspiciousKeyDiagnostics(filePath, keys);

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
        this.diagnosticCollection.delete(vscode.Uri.file(filePath));
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

      // Add entry to the VS Code Problems panel
      this.addSecretFileDiagnostic(filePath);

      const basename = path.basename(filePath);
      const msg = `\`${basename}\` is tracked by git. Secret files should be gitignored.`;

      this.logger.warn(`[TaskEnv] ${msg}`);

      const action = await vscode.window.showWarningMessage(msg, 'Learn more', "Don't warn again");
      if (action === 'Learn more') {
        await vscode.env.openExternal(vscode.Uri.parse(LEARN_MORE_URL));
      } else if (action === "Don't warn again") {
        this.diagnosticCollection.delete(vscode.Uri.file(filePath));
        await this.suppress(filePath);
      }
    }
  }

  // ── Diagnostics helpers ───────────────────────────────────────────────────

  /**
   * Adds `DiagnosticSeverity.Warning` entries to the Problems panel for each
   * suspicious key in `keys` found in `filePath`.  Avoids duplicate entries
   * across multiple `checkAndWarn` calls for the same file.
   */
  private async addSuspiciousKeyDiagnostics(filePath: string, keys: string[]): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const existing = [...(this.diagnosticCollection.get(uri) ?? [])];

    for (const key of keys) {
      const msg =
        `Environment key \`${key}\` matches a secret pattern in a git-tracked file. ` +
        `Move it to a \`.secret\` file or use "Workspace Tasks: Store Secret" to save it securely.`;

      if (existing.some((d) => d.message === msg)) {
        continue; // already reported
      }

      const range = await this.findKeyRangeInFile(filePath, key);
      const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
      diag.source = DIAGNOSTIC_SOURCE;
      diag.code = 'suspicious-env-key';
      existing.push(diag);
    }

    this.diagnosticCollection.set(uri, existing);
  }

  /**
   * Adds a `DiagnosticSeverity.Warning` entry to the Problems panel indicating
   * that a secret file is tracked by git.  Avoids duplicates.
   */
  private addSecretFileDiagnostic(filePath: string): void {
    const uri = vscode.Uri.file(filePath);
    const basename = path.basename(filePath);
    const msg = `\`${basename}\` is tracked by git. Secret files should be gitignored.`;
    const existing = [...(this.diagnosticCollection.get(uri) ?? [])];

    if (existing.some((d) => d.message === msg)) {
      return; // already reported
    }

    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      msg,
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = 'secret-file-tracked';
    existing.push(diag);
    this.diagnosticCollection.set(uri, existing);
  }

  /**
   * Emits a `DiagnosticSeverity.Warning` in the Problems panel for a file in
   * `envFiles` or `secretFiles` that is tracked by git.  Avoids duplicates.
   *
   * Diagnostic codes: `'config-env-file-git-tracked'` / `'config-secret-file-git-tracked'`.
   */
  private addConfigEnvFileDiagnostic(filePath: string, settingKey: 'envFiles' | 'secretFiles'): void {
    const uri = vscode.Uri.file(filePath);
    const basename = path.basename(filePath);
    const code = settingKey === 'envFiles' ? 'config-env-file-git-tracked' : 'config-secret-file-git-tracked';
    const msg =
      `\`${basename}\` is configured in workspaceTasks.envVars.${settingKey} and is tracked by git. ` +
      `Files containing environment variables or secrets should be added to .gitignore to avoid ` +
      `accidentally committing sensitive data. Consider using .secret files or VS Code SecretStorage instead.`;
    const existing = [...(this.diagnosticCollection.get(uri) ?? [])];

    if (existing.some((d) => d.message === msg)) {
      return; // already reported
    }

    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      msg,
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = code;
    existing.push(diag);
    this.diagnosticCollection.set(uri, existing);
  }

  /**
   * Removes only config-file-git-tracking diagnostics (codes
   * `'config-env-file-git-tracked'` and `'config-secret-file-git-tracked'`) from the
   * collection without disturbing task-run-time diagnostics on the same files.
   */
  private clearConfigFileDiagnostics(): void {
    const configCodes = new Set<string>(['config-env-file-git-tracked', 'config-secret-file-git-tracked']);
    const urisToUpdate: vscode.Uri[] = [];

    this.diagnosticCollection.forEach((uri, diagnostics) => {
      if (diagnostics.some((d) => configCodes.has(d.code as string))) {
        urisToUpdate.push(uri);
      }
    });

    for (const uri of urisToUpdate) {
      const remaining = (this.diagnosticCollection.get(uri) ?? []).filter(
        (d) => !configCodes.has(d.code as string),
      );
      if (remaining.length === 0) {
        this.diagnosticCollection.delete(uri);
      } else {
        this.diagnosticCollection.set(uri, remaining);
      }
    }
  }

  /**
   * Attempts to locate the exact line and column of `key` inside `filePath`.
   * Handles both `.json` files (`"KEY":` pattern) and `.env`-style files
   * (`KEY=` / `export KEY=` pattern).  Falls back to `(0, 0, 0, 0)` on any
   * failure (file not found, parse error, key not found).
   */
  private async findKeyRangeInFile(filePath: string, key: string): Promise<vscode.Range> {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const lines = document.getText().split(/\r?\n/);
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isJson = path.extname(filePath).toLowerCase() === '.json';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isJson) {
          const m = new RegExp(`"(${escapedKey})"\\s*:`).exec(line);
          if (m) {
            const col = line.indexOf(m[0]);
            return new vscode.Range(i, col, i, col + m[0].length);
          }
        } else {
          // .env style: optional 'export ' prefix, optional whitespace around '='
          const m = new RegExp(`^(?:export\\s+)?(${escapedKey})(?:\\s*=)`).exec(line.trimStart());
          if (m) {
            const col = line.indexOf(m[1]);
            if (col >= 0) {
              return new vscode.Range(i, col, i, col + key.length);
            }
          }
        }
      }
    } catch {
      // File not readable — fall back to the start of the file
    }
    return new vscode.Range(0, 0, 0, 0);
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
