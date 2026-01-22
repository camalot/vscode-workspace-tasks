import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';

export abstract class TaskTypeGroupItem extends TaskItem {
  constructor(label: string, resourceUri?: vscode.Uri) {
    // We pass label as type for now
    super(label, vscode.TreeItemCollapsibleState.Expanded, 'type', resourceUri);
    // Explicitly set to File icon to prevent "Folder" icon on expanded items
    this.iconPath = vscode.ThemeIcon.File;
  }
}

export class NpmTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    // Use a root path to ensure it's treated as a file resource
    super('npm', vscode.Uri.file('/package.json'));
    if (extensionPath) {
      this.iconPath = {
        light: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'light', `${this.label}.svg`)),
        dark: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'dark', `${this.label}.svg`))
      };
    } else {
      this.iconPath = vscode.Uri.file('/package.json');
    }
  }
}

export class VscodeTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('vscode', vscode.Uri.file('/tasks.code-workspace'));
  }
}

export class ScriptTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('script', vscode.Uri.file('/script.sh'));
  }
}

export class MakefileTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('makefile', vscode.Uri.file('/Makefile'));
  }
}

export class DockerfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('dockerfile', vscode.Uri.file('/Dockerfile'));
  }
}

export class JustfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('justfile', vscode.Uri.file('/justfile'));
  }
}

export class VenvTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    // Use a generic name or the specific file name for the icon
    // We use a fake .py file to get the python icon for the group
    super('venv', vscode.Uri.file('/venv.py'));
  }
}

export class AntTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('ant');
    if (extensionPath) {
      this.iconPath = {
        light: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'light', `${this.label}.svg`)),
        dark: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'dark', `${this.label}.svg`))
      };
    } else {
      this.iconPath = vscode.Uri.file('/build.xml');
    }
  }
}


export class WorkspaceTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    // Use a generic name or the specific file name for the icon
    super('workspace-task');
    if (extensionPath) {
      this.iconPath = {
        light: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'light', 'task.svg')),
        dark: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'dark', 'task.svg'))
      };
    } else {
      this.iconPath = vscode.ThemeIcon.File;
    }
  }
}

export class MsBuildTaskTypeItem extends TaskTypeGroupItem {
  constructor(extensionPath?: string) {
    super('msbuild', vscode.Uri.file('/msbuild.proj'));
    if (extensionPath) {
      this.iconPath = {
        light: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'light', `${this.label}.svg`)),
        dark: vscode.Uri.file(path.join(extensionPath, 'res', 'icons', 'dark', `${this.label}.svg`))
      };
    } else {
      this.iconPath = vscode.ThemeIcon.File;
    }
  }
}

export class GenericTaskTypeItem extends TaskTypeGroupItem {
  constructor(type: string) {
    super(type, vscode.Uri.file('/file'));
  }
}

export class TaskTypeFactory {
  public static create(type: string, extensionPath?: string): TaskTypeGroupItem {
    switch (type) {
      case 'npm':
        return new NpmTaskTypeItem(extensionPath);
      case 'vscode':
        return new VscodeTaskTypeItem(extensionPath);
      case 'script':
        return new ScriptTaskTypeItem(extensionPath);
      case 'makefile':
        return new MakefileTaskTypeItem(extensionPath);
      case 'dockerfile':
        return new DockerfileTaskTypeItem(extensionPath);
      case 'justfile':
        return new JustfileTaskTypeItem(extensionPath);
      case 'venv':
        return new VenvTaskTypeItem(extensionPath);
      case 'ant':
        return new AntTaskTypeItem(extensionPath);
      case 'msbuild':
        return new MsBuildTaskTypeItem(extensionPath);
      case 'workspace-task':
        return new WorkspaceTaskTypeItem(extensionPath);
      default:
        return new GenericTaskTypeItem(type);
    }
  }
}
