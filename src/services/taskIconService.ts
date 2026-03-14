import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LoggerService } from './loggerService';

export interface TaskIcon {
  light: vscode.Uri;
  dark: vscode.Uri;
}

export interface TaskIconUri {
  TaskIcon?: TaskIcon;
  DisplayUri?: vscode.Uri;
}

// gets an icon for a task based on its type, e.g., "gulp", "ant", "script"
// if the context is available, it will use the extension's icon resources if possible
// otherwise it will return undefined
export class TaskIconService {
  private static instance: TaskIconService;
  private context?: vscode.ExtensionContext;
  private readonly logger = LoggerService.getInstance();

  constructor() { }

  public static getInstance(): TaskIconService {
    if (!TaskIconService.instance) {
      TaskIconService.instance = new TaskIconService();
    }
    return TaskIconService.instance;
  }

  public initialize(context: vscode.ExtensionContext): TaskIconService {
    this.context = context;
    return this;
  }

  private mapLookup(type: string, map: { [key: string]: string }): string {
    // create generic map and merge with provided map
    const genericMap: { [key: string]: string } = {
      'npm': 'npm',
      'node': 'npm',
      'nodejs': 'npm',
      'yarn': 'npm',
      'dockerfile': 'docker',
      'docker-compose': 'docker'
    };
    const combinedMap = { ...genericMap, ...map };
    return combinedMap[type.toLowerCase()] || type;
  }

  public getTaskTypeIcon(type: string, fallback?: vscode.Uri): TaskIconUri | undefined {
    if (!this.context) {
      return {
        TaskIcon: undefined,
        DisplayUri: fallback || undefined,
      };
    }
    const mappedType = this.mapLookup(type, {});
    let iconUri: TaskIcon | vscode.Uri | undefined = {
      light: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', `${mappedType}.svg`)),
      dark: vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', `${mappedType}.svg`)),
    };

    if (!fs.existsSync(iconUri.light.fsPath) || !fs.existsSync(iconUri.dark.fsPath)) {
      iconUri = undefined;
    }

    return {
      TaskIcon: iconUri as TaskIcon | undefined,
      DisplayUri: fallback || undefined,
    };
  }

  private isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext);
  }

  /**
   * Extensions that popular VS Code file icon themes (Seti, Material, etc.) are
   * known to have specific icons for. Any filename whose extension is NOT in this
   * set (e.g. "bad.file", "custom.stuff") would only receive a generic unknown-file
   * icon, so we fall through to the task.png default instead.
   */
  private static readonly KNOWN_FILE_TYPE_EXTENSIONS: ReadonlySet<string> = new Set([
    // JavaScript / TypeScript
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
    // JSON / YAML / TOML / XML / INI
    '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf',
    // CSS ecosystems
    '.css', '.scss', '.sass', '.less',
    // HTML / templates
    '.html', '.htm', '.vue', '.svelte', '.astro', '.njk', '.ejs',
    // Documentation
    '.md', '.mdx', '.rst', '.txt',
    // Compiled / systems languages
    '.py', '.pyi', '.rb', '.rs', '.go', '.java', '.kt', '.kts', '.swift',
    '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.lua', '.r', '.scala',
    // Shell / scripts
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
    // Data / query / schema formats
    '.csv', '.tsv', '.sql', '.graphql', '.gql', '.proto', '.prisma',
    // Build tools
    '.lock', '.gradle',
  ]);

  /** Well-known filenames (no extension, or dotfiles) that icon themes recognize. */
  private static readonly KNOWN_BASENAMES: ReadonlySet<string> = new Set([
    'makefile', 'dockerfile', 'jenkinsfile', 'vagrantfile', 'procfile', 'brewfile',
    '.gitignore', '.dockerignore', '.npmignore', '.gitattributes', '.editorconfig', '.env',
  ]);

  /**
   * Returns `true` when common VS Code file icon themes are expected to provide a
   * meaningful icon for the given filename — either by full basename match or by
   * file extension.
   */
  private hasKnownFileTypeIcon(filename: string): boolean {
    const basename = path.basename(filename).toLowerCase();
    if (TaskIconService.KNOWN_BASENAMES.has(basename)) {
      return true;
    }
    const ext = path.extname(basename);
    return ext.length > 0 && TaskIconService.KNOWN_FILE_TYPE_EXTENSIONS.has(ext);
  }

  private resolveIconPath(iconPath: string): string | undefined {
    if (!iconPath) {
      return undefined;
    }
    if (path.isAbsolute(iconPath) && this.isImageFile(iconPath) && fs.existsSync(iconPath)) {
      return iconPath;
    }
    if (this.context) {
      const resolved = path.join(this.context.extensionPath, iconPath);
      if (this.isImageFile(resolved) && fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return undefined;
  }

  /**
   * Resolves the icon for a workspace-defined task type.
   *
   * Priority:
   * 1. Built-in SVG icon for the type name (from the extension's `res/icons/` folders).
   * 2. If `iconUri` is a `{ dark, light }` object whose paths resolve to real image files —
   *    use it as the explicit custom icon.
   * 3. If `iconUri` is an absolute or extension-relative path to a real image file — use it.
   * 4. If `iconUri` is a codicon reference of the form `$(name)` — resolve and use that
   *    symbolic icon before falling back to file-name based detection.
   * 5. If `iconUri` is a filename whose extension (or full basename) is recognized by common
   *    VS Code icon themes (e.g. `"tsconfig.json"`, `"Makefile"`) — return it as `DisplayUri`
   *    so the caller can display the matching file-type icon.  Unrecognized extensions (e.g.
   *    `"bad.file"`) return empty so the caller falls back to the default `task.png` icon.
   */
  public resolveWorkspaceTaskTypeIcon(
    type: string,
    iconUri?: string | { dark: string; light: string },
  ): TaskIconUri {
    // 1. Try built-in SVG by type name
    const builtIn = this.getTaskTypeIcon(type);
    if (builtIn?.TaskIcon) {
      this.logger.debug(`[TaskIconService] ${type} resolved using built-in type icon`, {
        type,
        iconUri,
        light: builtIn.TaskIcon.light.fsPath,
        dark: builtIn.TaskIcon.dark.fsPath,
      });
      return builtIn;
    }

    if (!iconUri) {
      this.logger.debug(`[TaskIconService] ${type} icon resolution returned empty: no iconUri provided`);
      return { TaskIcon: undefined, DisplayUri: undefined };
    }

    // 2. Handle { dark, light } object
    if (typeof iconUri === 'object') {
      const darkPath = this.resolveIconPath(iconUri.dark);
      const lightPath = this.resolveIconPath(iconUri.light);
      if (darkPath && lightPath) {
        const result = {
          TaskIcon: {
            dark: vscode.Uri.file(darkPath),
            light: vscode.Uri.file(lightPath),
          },
          DisplayUri: vscode.Uri.file(lightPath),
        };
        this.logger.debug(`[TaskIconService] ${type} resolved using iconUri object`, {
          type,
          iconUri,
          light: lightPath,
          dark: darkPath,
        });
        return result;
      }
      // Invalid paths — fall through to return empty
      this.logger.debug(`[TaskIconService] ${type} iconUri object did not resolve to existing files`, {
        type,
        iconUri,
        context: this.context?.extensionPath,
      });
      return { TaskIcon: undefined, DisplayUri: undefined };
    }

    // 3. Handle codicon-like syntax "$(name)" by resolving to bundled SVG pair.
    const iconNameMatch = iconUri.match(/^\$\(([a-zA-Z0-9_-]+)\)$/);
    if (iconNameMatch && this.context) {
      const iconName = iconNameMatch[1];
      const lightPath = path.join(this.context.extensionPath, 'res', 'icons', 'light', `${iconName}.svg`);
      const darkPath = path.join(this.context.extensionPath, 'res', 'icons', 'dark', `${iconName}.svg`);
      if (fs.existsSync(lightPath) && fs.existsSync(darkPath)) {
        const result = {
          TaskIcon: {
            dark: vscode.Uri.file(darkPath),
            light: vscode.Uri.file(lightPath),
          },
          DisplayUri: vscode.Uri.file(lightPath),
        };

        this.logger.debug(`[TaskIconService] ${type} resolved from $(iconName) syntax`, {
          type,
          iconUri,
          iconName,
          light: lightPath,
          dark: darkPath,
        });
        return result;
      }

      this.logger.debug(`[TaskIconService] ${type} $(iconName) syntax matched but files are missing`, {
        type,
        iconUri,
        iconName,
        light: lightPath,
        dark: darkPath,
        extensionPath: this.context.extensionPath,
      });
    }

    // 4. Handle string iconUri — check if it resolves to a real image
    if (path.isAbsolute(iconUri) && this.isImageFile(iconUri) && fs.existsSync(iconUri)) {
      const uri = vscode.Uri.file(iconUri);
      this.logger.debug(`[TaskIconService] ${type} resolved from absolute image path`, {
        type,
        iconUri,
        path: uri.fsPath,
      });
      return { TaskIcon: { dark: uri, light: uri }, DisplayUri: uri };
    }

    if (this.context) {
      // Check light/dark icon subdirectories
      const lightPath = path.join(this.context.extensionPath, 'res', 'icons', 'light', iconUri);
      const darkPath = path.join(this.context.extensionPath, 'res', 'icons', 'dark', iconUri);
      if (this.isImageFile(iconUri) && fs.existsSync(lightPath) && fs.existsSync(darkPath)) {
        const result = {
          TaskIcon: {
            dark: vscode.Uri.file(darkPath),
            light: vscode.Uri.file(lightPath),
          },
          DisplayUri: vscode.Uri.file(lightPath),
        };
        this.logger.debug(`[TaskIconService] ${type} resolved from res/icons/{light,dark} relative image path`, {
          type,
          iconUri,
          light: lightPath,
          dark: darkPath,
        });
        return result;
      }

      // Check directly relative to the extension root
      const directPath = path.join(this.context.extensionPath, iconUri);
      if (this.isImageFile(directPath) && fs.existsSync(directPath)) {
        const uri = vscode.Uri.file(directPath);
        this.logger.debug(`[TaskIconService] ${type} resolved from extension-relative image path`, {
          type,
          iconUri,
          path: uri.fsPath,
        });
        return { TaskIcon: { dark: uri, light: uri }, DisplayUri: uri };
      }
    }

    // 5. Non-image filenames (e.g. "eslint.config.mjs", "tsconfig.json") — only return a
    // DisplayUri when the extension is one that VS Code icon themes are known to support.
    // Unrecognized extensions (e.g. "bad.file") would render as a generic unknown-file icon,
    // which is less useful than the task.png fallback, so we return empty in that case.
    if (!this.isImageFile(iconUri)) {
      if (this.hasKnownFileTypeIcon(iconUri)) {
        const basename = path.basename(iconUri);
        this.logger.debug(`[TaskIconService] ${type} fell back to file-type DisplayUri`, {
          type,
          iconUri,
          basename,
        });
        return {
          TaskIcon: undefined,
          DisplayUri: vscode.Uri.file('/' + basename),
        };
      }
      this.logger.debug(`[TaskIconService] ${type} returned empty: unknown non-image iconUri extension`, {
        type,
        iconUri,
      });
      return { TaskIcon: undefined, DisplayUri: undefined };
    }
    this.logger.debug(`[TaskIconService] ${type} returned empty: image iconUri could not be resolved`, {
      type,
      iconUri,
      extensionPath: this.context?.extensionPath,
    });
    return { TaskIcon: undefined, DisplayUri: undefined };
  }

  public getTaskIcon(
    type: string,
    fallback?: vscode.Uri,
  ): string | vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
    const config = vscode.workspace.getConfiguration('workspaceTasks');
    const iconType = config.get<string>('task.iconType', 'type');

    if (iconType === 'gear') {
      return new vscode.ThemeIcon('settings-gear');
    } else if (iconType === 'run') {
      return new vscode.ThemeIcon('play');
    } else if (iconType === 'file') {
      // return vscode.ThemeIcon.File;
      return undefined;
    } else if (iconType === 'custom') {
      const customPath = config.get<string>('task.iconTypeCustom', '');
      if (customPath) {
        // if customPath matches /\$\([a-zA-Z0-9_-]+\)/, treat it as a ThemeIcon
        const themeIconMatch = customPath.match(/^\$\(([a-zA-Z0-9_-]+)\)$/);
        if (themeIconMatch) {
          const iconName = themeIconMatch[1];
          return new vscode.ThemeIcon(iconName);
        }
        // Try to resolve path
        // Check if absolute
        let uri: vscode.Uri | undefined;
        if (path.isAbsolute(customPath)) {
          uri = vscode.Uri.file(customPath);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
          // Resolve relative to first workspace folder (simplification)
          uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, customPath);
        }

        if (uri && fs.existsSync(uri.fsPath)) {
          return uri;
        }
      }
      // Fallback to type if custom fails
    }

    // Default 'type' behavior
    const typeIcon = this.getTaskTypeIcon(type, fallback);
    return typeIcon?.TaskIcon;
  }

  /**
   * Returns the default task-group icon (`res/icons/light/task.png` and
   * `res/icons/dark/task.png`) bundled with the extension. Used as the
   * final fallback when no other icon can be resolved for a task-type group.
   */
  public getDefaultGroupIcon(): TaskIcon | undefined {
    if (!this.context) {
      return undefined;
    }
    const light = vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'light', 'task.png'));
    const dark = vscode.Uri.file(path.join(this.context.extensionPath, 'res', 'icons', 'dark', 'task.png'));
    if (!fs.existsSync(light.fsPath) || !fs.existsSync(dark.fsPath)) {
      return undefined;
    }
    return { light, dark };
  }
}
