import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from './taskItem';
import { TaskIconService } from './services/taskIconService';

export abstract class TaskTypeGroupItem extends TaskItem {
  constructor(
    label: string,
    resourceUri?: vscode.Uri,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
  ) {
    // We pass label as type for now
    super(label, collapsibleState, 'type', resourceUri);
    // Explicitly set to File icon to prevent "Folder" icon on expanded items
    this.iconPath = vscode.ThemeIcon.File;
    // CRITICAL: Ensure we initialize the list of children!
    this.children = [];
  }
}

export class NpmTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a root path to ensure it's treated as a file resource
    super('npm', vscode.Uri.file('/package.json'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/package.json'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class VscodeTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('vscode', vscode.Uri.file('/tasks.code-workspace'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/tasks.code-workspace'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class ScriptTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('script', vscode.Uri.file('/script.sh'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/script.sh'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class MakefileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('makefile', vscode.Uri.file('/Makefile'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/Makefile'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class DockerfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('dockerfile', vscode.Uri.file('/Dockerfile'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/Dockerfile'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}


export class DockerComposeTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('docker-compose', vscode.Uri.file('/docker-compose.yml'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/docker-compose.yml'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class JustfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('justfile', vscode.Uri.file('/justfile'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/justfile'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class VenvTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a generic name or the specific file name for the icon
    // We use a fake .py file to get the python icon for the group
    super('venv', vscode.Uri.file('/venv.py'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/venv.py'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class AntTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('ant', undefined, collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/build.xml'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class GruntTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use the Gruntfile name so VS Code shows the default Gruntfile/JS file icon
    super('grunt', vscode.Uri.file('/Gruntfile.js'), collapsibleState);

    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/Gruntfile.js'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class GulpTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a gulpfile path so VS Code shows the default JS/module file icon for the group
    super('gulp', vscode.Uri.file('/gulpfile.js'), collapsibleState);

    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/gulpfile.js'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class GradleTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a build.gradle path so VS Code shows the default Gradle file icon for the group
    super('gradle', vscode.Uri.file('/build.gradle'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/build.gradle'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class ComposerTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('composer', vscode.Uri.file('/composer.json'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/composer.json'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class WorkspaceTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a generic name or the specific file name for the icon
    super('workspace-task', undefined, collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon("task");
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class MsBuildTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('msbuild', vscode.Uri.file('/msbuild.proj'), collapsibleState);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/msbuild.csproj'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class GenericTaskTypeItem extends TaskTypeGroupItem {
  constructor(type: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
    super(type, vscode.Uri.file('/file'), collapsibleState);

    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label);
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class TaskTypeFactory {
  public static create(type: string, collapsibleState?: vscode.TreeItemCollapsibleState): TaskTypeGroupItem {
    switch (type) {
      case 'npm':
        return new NpmTaskTypeItem(collapsibleState);
      case 'vscode':
        return new VscodeTaskTypeItem(collapsibleState);
      case 'script':
        return new ScriptTaskTypeItem(collapsibleState);
      case 'makefile':
        return new MakefileTaskTypeItem(collapsibleState);
      case 'dockerfile':
        return new DockerfileTaskTypeItem(collapsibleState);
      case 'docker-compose':
        return new DockerComposeTaskTypeItem(collapsibleState);
      case 'justfile':
        return new JustfileTaskTypeItem(collapsibleState);
      case 'venv':
        return new VenvTaskTypeItem(collapsibleState);
      case 'ant':
        return new AntTaskTypeItem(collapsibleState);
      case 'grunt':
        return new GruntTaskTypeItem(collapsibleState);
      case 'gulp':
        return new GulpTaskTypeItem(collapsibleState);
      case 'gradle':
        return new GradleTaskTypeItem(collapsibleState);
      case 'msbuild':
        return new MsBuildTaskTypeItem(collapsibleState);
      case 'workspace-task':
        return new WorkspaceTaskTypeItem(collapsibleState);
      case 'composer':
        return new ComposerTaskTypeItem(collapsibleState);
      default:
        return new GenericTaskTypeItem(type, collapsibleState);
    }
  }
}
