import * as vscode from 'vscode';
import * as fs from 'fs';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import * as path from 'path';

interface ShellConfig {
  extensions: string[];
  configKey: string;
  defaultInterpreter: string;
  checkShebang?: boolean;
}

const BUILT_IN_SHELLS: Record<string, ShellConfig> = {
  'bash': { extensions: ['sh', 'bash'], configKey: 'bash', defaultInterpreter: 'bash', checkShebang: true },
  'zsh': { extensions: ['zsh'], configKey: 'zsh', defaultInterpreter: 'zsh', checkShebang: true },
  'fish': { extensions: ['fish'], configKey: 'fish', defaultInterpreter: 'fish', checkShebang: false },
  'pwsh': { extensions: ['ps1'], configKey: 'pwsh', defaultInterpreter: 'pwsh', checkShebang: false },
  'batch': { extensions: ['bat', 'cmd'], configKey: 'batch', defaultInterpreter: 'cmd.exe', checkShebang: false },
  'python': { extensions: ['py'], configKey: 'python', defaultInterpreter: 'python', checkShebang: true },
  'perl': { extensions: ['pl'], configKey: 'perl', defaultInterpreter: 'perl', checkShebang: true },
  'ruby': { extensions: ['rb'], configKey: 'ruby', defaultInterpreter: 'ruby', checkShebang: true },
  'sh': { extensions: ['sh'], configKey: 'sh', defaultInterpreter: 'sh', checkShebang: true },
  'nushell': { extensions: ['nu'], configKey: 'nushell', defaultInterpreter: 'nu', checkShebang: false },
};

export class ShellTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('shell');
  }

  async getTasks(): Promise<TaskItem[]> {
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
        const patterns = def.extensions.map(ext => `**/*.${ext}`);

        // Find files
        const files = await filesService.findFiles(patterns, [constants.GLOB_SHELL_EXCLUDE]);

        for (const file of files) {
          if (processedFiles.has(file.fsPath)) { continue; } // Avoid duplicates if extensions overlap

          // Check Shebang if required
          if (def.checkShebang) {
            const hasShebang = await this.checkForShebang(file);
            if (!hasShebang) {
              continue;
            }
          }

          processedFiles.add(file.fsPath);
          tasks.push(this.createShellTaskItem(file, interpreter, type));
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
          if (processedFiles.has(file.fsPath)) { continue; }

          processedFiles.add(file.fsPath);
          // For custom types, we assume 'shell' as sub-type or derived from extension
          const ext = path.extname(file.fsPath).replace('.', '');
          tasks.push(this.createShellTaskItem(file, interpreter, ext || 'shell'));
        }
      }
    }

    return tasks;
  }

  private createShellTaskItem(resourceUri: vscode.Uri, interpreter: string, subType: string): TaskItem {
    const filename = path.basename(resourceUri.fsPath);
    const item = new TaskItem(
      filename,
      vscode.TreeItemCollapsibleState.None,
      this.type,
      resourceUri,
      {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [resourceUri, 0]
      },
      vscode.ThemeIcon.File
    );

    item.description = vscode.workspace.asRelativePath(resourceUri);
    // Store interpreter info for TaskFactory
    item.metadata = {
      interpreter: interpreter,
      subType: subType
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
        if (bytesRead < 2) { return false; }
        return buffer[0] === 0x23 && buffer[1] === 0x21; // #!
      } else {
        // Fallback for virtual filesystems
        const data = await vscode.workspace.fs.readFile(uri);
        if (data.byteLength < 2) { return false; }
        return data[0] === 0x23 && data[1] === 0x21; // #!
      }
    } catch (e) {
      return false;
    }
  }
}
