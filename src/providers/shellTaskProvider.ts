import * as vscode from 'vscode';
import * as fs from 'fs';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import * as path from 'path';
import { TaskIconService } from '../services/taskIconService';

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

    // 1. Process Built-in Types
    for (const [type, def] of Object.entries(BUILT_IN_SHELLS)) {
      if (enabledTypes[type]) {
        const interpreter = shellPaths[type] || def.defaultInterpreter;

        // Construct glob pattern for this type
        const patterns = def.extensions.map((ext) => `**/*.${ext}`);

        // Find files
        const files = await filesService.findFiles(patterns, [constants.GLOB_SHELL_EXCLUDE]);

        for (const file of files) {
          if (processedFiles.has(file.fsPath)) {
            continue;
          } // Avoid duplicates if extensions overlap

          let effectiveInterpreter = interpreter;
          let usesShebang = false;

          // Check shebang when required or when shebang execution is supported
          if (def.requireShebang || def.useShebang) {
            const hasShebang = await this.checkForShebang(file);

            // Skip the file if a shebang is mandatory but absent
            if (def.requireShebang && !hasShebang) {
              continue;
            }

            // When shebang execution is enabled and the file has a shebang, run it
            // directly so the OS can invoke the correct interpreter from the shebang line
            if (def.useShebang && hasShebang) {
              effectiveInterpreter = '';
              usesShebang = true;
            }
          }

          processedFiles.add(file.fsPath);
          tasks.push(this.createShellTaskItem(file, effectiveInterpreter, type, usesShebang));
        }
      }
    }

    // 2. Process "Other" / Additional Extensions
    if (enabledTypes['other']) {
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
        }
      }
    }

    return tasks;
  }

  async getSystemTasks(): Promise<TaskItem[]> {
    if (!this.enabled) {
      return [];
    }
    return [];
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

  private async checkForShebang(uri: vscode.Uri): Promise<boolean> {
    try {
      if (uri.scheme === 'file') {
        const handle = await fs.promises.open(uri.fsPath, 'r');
        const buffer = new Uint8Array(2);
        const { bytesRead } = await handle.read(buffer, 0, 2, 0);
        await handle.close();
        if (bytesRead < 2) {
          return false;
        }
        return buffer[0] === 0x23 && buffer[1] === 0x21; // #!
      } else {
        // Fallback for virtual filesystems
        const data = await vscode.workspace.fs.readFile(uri);
        if (data.byteLength < 2) {
          return false;
        }
        return data[0] === 0x23 && data[1] === 0x21; // #!
      }
    } catch (e) {
      return false;
    }
  }
}
