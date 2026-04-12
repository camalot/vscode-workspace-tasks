import * as vscode from 'vscode';
import * as fs from 'fs';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import * as path from 'path';
import { TaskIconService } from '../services/taskIconService';
import { TaskConfigService } from '../services/taskConfigService';

interface ShellConfig {
  extensions: string[];
  configKey: string;
  defaultInterpreter: string;
  /**
   * When true, only files that contain a shebang line (`#!`) are included as tasks.
   * Defaults to false — all files with matching extensions are included regardless.
   */
  requireShebang?: boolean;
  /**
   * When true, files that contain a shebang line (`#!`) are executed directly by the OS
   * (e.g. `./script.py`), letting the kernel invoke the interpreter named in the shebang.
   * The configured interpreter is still used for files that do not have a shebang.
   * Defaults to false.
   */
  useShebang?: boolean;
}

interface ShellTypeBatch {
  type: string;
  def: ShellConfig;
  interpreter: string;
  items: { file: vscode.Uri; hasShebang: boolean }[];
  elapsedMs: number;
  fileCount: number;
  shebangReads: number;
  cacheHits: number;
}

const BUILT_IN_SHELLS: Record<string, ShellConfig> = {
  bash: { extensions: ['sh', 'bash'], configKey: 'bash', defaultInterpreter: 'bash', requireShebang: false, useShebang: true },
  zsh: { extensions: ['zsh'], configKey: 'zsh', defaultInterpreter: 'zsh', requireShebang: false, useShebang: true },
  fish: { extensions: ['fish'], configKey: 'fish', defaultInterpreter: 'fish', requireShebang: false, useShebang: false },
  pwsh: { extensions: ['ps1'], configKey: 'pwsh', defaultInterpreter: 'pwsh', requireShebang: false, useShebang: false },
  batch: { extensions: ['bat', 'cmd'], configKey: 'batch', defaultInterpreter: 'cmd.exe', requireShebang: false, useShebang: false },
  python: { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python3', requireShebang: false, useShebang: true },
  perl: { extensions: ['pl'], configKey: 'perl', defaultInterpreter: 'perl', requireShebang: false, useShebang: true },
  ruby: { extensions: ['rb'], configKey: 'ruby', defaultInterpreter: 'ruby', requireShebang: false, useShebang: true },
  sh: { extensions: ['sh'], configKey: 'sh', defaultInterpreter: 'sh', requireShebang: false, useShebang: true },
  nushell: { extensions: ['nu'], configKey: 'nushell', defaultInterpreter: 'nu', requireShebang: false, useShebang: false },
};

export class ShellTaskProvider extends BaseTaskProvider implements TaskProvider {
  private shebangCache = new Map<string, { hasShebang: boolean; mtime: number }>();
  private shebangInFlight = new Map<string, Promise<boolean>>();

  public clearShebangCache(): void {
    this.shebangCache.clear();
  }

  constructor() {
    // Collect all extensions
    const extensions = new Set<string>();
    for (const key in BUILT_IN_SHELLS) {
      BUILT_IN_SHELLS[key].extensions.forEach((ext) => extensions.add(ext));
    }
    const glob = `**/*.{${Array.from(extensions).join(',')}}`;
    super('shell', glob);
  }

  override getFilePatterns(): string[] {
    const patterns = super.getFilePatterns();
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const enabledTypes = config.get<Record<string, boolean>>('shellEnabledTaskTypes') || {};
    const additional = config.get<Record<string, string>>('shellAdditionalExtensions') || {};

    // Register individual per-extension patterns (e.g. '**/*.sh', '**/*.bash') in addition to
    // the combined brace-glob stored in filePattern. TaskFilesService's coverage check is exact
    // string equality, so '**/*.{sh,bash,...}' does not cover '**/*.sh' lookups issued by
    // _processShellType. Returning them here ensures providers/index.ts registers them all,
    // converting every _processShellType findFiles call into a cache hit on warm reload.
    const seen = new Set<string>(patterns);
    for (const def of Object.values(BUILT_IN_SHELLS)) {
      for (const ext of def.extensions) {
        const p = `**/*.${ext}`;
        if (!seen.has(p)) {
          seen.add(p);
          patterns.push(p);
        }
      }
    }

    if (enabledTypes['other']) {
      for (const [ext] of Object.entries(additional)) {
        let extClean = ext;
        if (extClean.startsWith('.')) {
          extClean = extClean.slice(1);
        }
        patterns.push(`**/*.${extClean}`);
      }
    }
    return patterns;
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const enabledTypes = config.get<Record<string, boolean>>('shellEnabledTaskTypes') || {};
    const shellPaths = config.get<Record<string, string>>('shellPaths') || {};
    const additional = config.get<Record<string, string>>('shellAdditionalExtensions') || {};

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const processedFiles = new Set<string>();

    const totalStart = Date.now();
    this.logger.debug('[ShellTaskProvider] Starting shell task discovery');

    // 1. Process Built-in Types — all types run concurrently (Phase 1, Steps 1.1–1.2)
    const typeResults = await Promise.allSettled(
      Object.entries(BUILT_IN_SHELLS).map(([type, def]) =>
        this._processShellType(type, def, filesService, enabledTypes, shellPaths),
      ),
    );

    // Step 1.3: cross-type deduplication in the same deterministic order as BUILT_IN_SHELLS
    for (const result of typeResults) {
      if (result.status === 'rejected') {
        this.logger.warn(`[ShellTaskProvider] A shell type batch failed: ${result.reason}`);
        continue;
      }
      const { type, def, interpreter, items, elapsedMs, fileCount, shebangReads, cacheHits } = result.value;

      if (!enabledTypes[type] || !TaskConfigService.getInstance().isTaskTypeEnabled(type)) {
        continue;
      }

      let typeTaskCount = 0;
      for (const { file, hasShebang } of items) {
        // Avoid duplicates if extensions overlap across types
        if (processedFiles.has(file.fsPath)) {
          continue;
        }

        // Skip the file if a shebang is mandatory but absent
        if (def.requireShebang && !hasShebang) {
          continue;
        }

        let effectiveInterpreter = interpreter;
        let usesShebang = false;

        // When shebang execution is enabled and the file has a shebang, run it
        // directly so the OS can invoke the correct interpreter from the shebang line
        if (def.useShebang && hasShebang) {
          effectiveInterpreter = '';
          usesShebang = true;
        }

        processedFiles.add(file.fsPath);
        tasks.push(this.createShellTaskItem(file, effectiveInterpreter, type, usesShebang));
        typeTaskCount++;
      }

      const cacheStatsMsg =
        def.requireShebang || def.useShebang ? ` (${shebangReads} shebang reads, ${cacheHits} cache hits)` : '';
      this.logger.info(
        `[ShellTaskProvider] ${type}: ${typeTaskCount} task(s) from ${fileCount} file(s) in ${elapsedMs}ms${cacheStatsMsg}`,
      );
    }

    // 2. Process "Other" / Additional Extensions
    if (enabledTypes['other'] && Object.keys(additional).length > 0) {
      const otherStart = Date.now();
      let otherCount = 0;
      for (const [ext, interpreter] of Object.entries(additional)) {
        let extClean = ext;
        if (extClean.startsWith('.')) {
          extClean = extClean.slice(1);
        }
        const files = await filesService.findFiles([`**/*.${extClean}`], [constants.GLOB_SHELL_EXCLUDE]);

        for (const file of files) {
          if (processedFiles.has(file.fsPath)) {
            continue;
          }

          processedFiles.add(file.fsPath);
          // For custom types, we assume 'shell' as sub-type or derived from extension
          const ext = path.extname(file.fsPath).replace('.', '');
          tasks.push(this.createShellTaskItem(file, interpreter, ext || 'shell'));
          otherCount++;
        }
      }
      this.logger.info(`[ShellTaskProvider] other: ${otherCount} task(s) in ${Date.now() - otherStart}ms`);
    }

    const totalMs = Date.now() - totalStart;
    this.logger.info(`[ShellTaskProvider] Completed — ${tasks.length} total shell task(s) loaded in ${totalMs}ms`);

    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
  }

  private async _processShellType(
    type: string,
    def: ShellConfig,
    filesService: TaskFilesService,
    enabledTypes: Record<string, boolean>,
    shellPaths: Record<string, string>,
  ): Promise<ShellTypeBatch> {
    if (!enabledTypes[type] || !TaskConfigService.getInstance().isTaskTypeEnabled(type)) {
      this.logger.debug(`[ShellTaskProvider] Skipping disabled shell type: ${type}`);
      return { type, def, interpreter: '', items: [], elapsedMs: 0, fileCount: 0, shebangReads: 0, cacheHits: 0 };
    }

    const typeStart = Date.now();
    this.logger.debug(`[ShellTaskProvider] Processing shell type: ${type} (extensions: ${def.extensions.join(', ')})`);

    const interpreter = shellPaths[type] || def.defaultInterpreter;
    const patterns = def.extensions.map((ext) => `**/*.${ext}`);
    const files = await filesService.findFiles(patterns, [constants.GLOB_SHELL_EXCLUDE]);

    this.logger.debug(`[ShellTaskProvider] Found ${files.length} candidate file(s) for shell type: ${type}`);

    // Step 1.1: parallelize shebang checks within this shell type
    const checkResults = await Promise.allSettled(
      files.map(async (file): Promise<{ file: vscode.Uri; hasShebang: boolean; fromCache: boolean; shebangSkipped?: boolean }> => {
        if (!def.requireShebang && !def.useShebang) {
          // Shebang check not needed for this type; mark as skipped so it's excluded from metrics
          return { file, hasShebang: false, fromCache: false, shebangSkipped: true };
        }
        const result = await this.checkForShebang(file);
        return { file, ...result };
      }),
    );

    const resolved = checkResults
      .filter(
        (r): r is PromiseFulfilledResult<{ file: vscode.Uri; hasShebang: boolean; fromCache: boolean; shebangSkipped?: boolean }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);

    const items: { file: vscode.Uri; hasShebang: boolean }[] = resolved.map(({ file, hasShebang }) => ({
      file,
      hasShebang,
    }));
    const shebangReads = resolved.filter((r) => !r.shebangSkipped && !r.fromCache).length;
    const cacheHits = resolved.filter((r) => !r.shebangSkipped && r.fromCache).length;

    const elapsedMs = Date.now() - typeStart;
    this.logger.debug(`[ShellTaskProvider] Finished shell type: ${type} — ${items.length} file(s) resolved in ${elapsedMs}ms`);

    return { type, def, interpreter, items, elapsedMs, fileCount: files.length, shebangReads, cacheHits };
  }

  private createShellTaskItem(resourceUri: vscode.Uri, interpreter: string, subType: string, useShebang = false): TaskItem {
    const filename = path.basename(resourceUri.fsPath);
    const iconPath = TaskIconService.getInstance().getTaskIcon(subType) || vscode.ThemeIcon.File;

    const item = new TaskItem(
      filename,
      vscode.TreeItemCollapsibleState.None,
      this.type,
      resourceUri,
      {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [resourceUri, 0],
      },
      iconPath,
    );

    item.description = vscode.workspace.asRelativePath(resourceUri);
    // Store interpreter info for TaskFactory
    item.metadata = {
      interpreter: interpreter,
      subType: subType,
      useShebang: useShebang,
    };

    return item;
  }

  private async checkForShebang(uri: vscode.Uri): Promise<{ hasShebang: boolean; fromCache: boolean }> {
    try {
      if (uri.scheme === 'file') {
        const stat = await fs.promises.stat(uri.fsPath);
        const mtime = stat.mtimeMs;
        const cached = this.shebangCache.get(uri.fsPath);
        if (cached && cached.mtime === mtime) {
          this.logger.debug(`[ShellTaskProvider] shebang cache hit: ${uri.fsPath}`);
          return { hasShebang: cached.hasShebang, fromCache: true };
        }
        // Coalesce concurrent reads for the same file path to avoid duplicate open() calls
        const inFlight = this.shebangInFlight.get(uri.fsPath);
        if (inFlight) {
          this.logger.debug(`[ShellTaskProvider] shebang cache hit: ${uri.fsPath}`);
          const hasShebang = await inFlight;
          return { hasShebang, fromCache: true };
        }
        this.logger.debug(`[ShellTaskProvider] shebang cache miss (read): ${uri.fsPath}`);
        // Build and register the read promise synchronously before the first await
        // so any concurrent caller for this path sees it immediately
        const readPromise = (async () => {
          const handle = await fs.promises.open(uri.fsPath, 'r');
          try {
            const buffer = new Uint8Array(2);
            const { bytesRead } = await handle.read(buffer, 0, 2, 0);
            const hasShebang = bytesRead >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21; // #!
            this.shebangCache.set(uri.fsPath, { hasShebang, mtime });
            return hasShebang;
          } finally {
            await handle.close();
          }
        })();
        this.shebangInFlight.set(uri.fsPath, readPromise);
        try {
          const hasShebang = await readPromise;
          return { hasShebang, fromCache: false };
        } finally {
          this.shebangInFlight.delete(uri.fsPath);
        }
      } else {
        // Fallback for virtual filesystems — no caching
        const data = await vscode.workspace.fs.readFile(uri);
        if (data.byteLength < 2) {
          return { hasShebang: false, fromCache: false };
        }
        return { hasShebang: data[0] === 0x23 && data[1] === 0x21, fromCache: false }; // #!
      }
    } catch (e) {
      return { hasShebang: false, fromCache: false };
    }
  }
}
