import * as vscode from 'vscode';
import { TaskItem } from './taskItem';
import { TaskIconService } from './services/taskIconService';

export abstract class TaskTypeGroupItem extends TaskItem {
  constructor(
    label: string,
    resourceUri?: vscode.Uri,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
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
    super('npm', vscode.Uri.file('/package.json'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/package.json'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class DenoTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a root path to ensure it's treated as a file resource
    super('deno', vscode.Uri.file('/deno.json'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/deno.json'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class VscodeTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('vscode', vscode.Uri.file('/tasks.code-workspace'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/tasks.code-workspace'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class ScriptTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('script', vscode.Uri.file('/script.sh'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/script.sh'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class MakefileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('makefile', vscode.Uri.file('/Makefile'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/Makefile'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class DockerfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('dockerfile', vscode.Uri.file('/Dockerfile'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/Dockerfile'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}


export class DockerComposeTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('docker-compose', vscode.Uri.file('/docker-compose.yml'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/docker-compose.yml'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class JustfileTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('justfile', vscode.Uri.file('/justfile'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
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
    super('venv', vscode.Uri.file('/venv.py'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/venv.py'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }

  }
}

export class MiseTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('mise', vscode.Uri.file('/mise.toml'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/mise.toml'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class AntTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('ant', undefined, collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
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
    super('grunt', vscode.Uri.file('/Gruntfile.js'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);

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
    super('gulp', vscode.Uri.file('/gulpfile.js'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);

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
    super('gradle', vscode.Uri.file('/build.gradle'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/build.gradle'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class ComposerTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('composer', vscode.Uri.file('/composer.json'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/composer.json'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class GithubActionsTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('github-actions', vscode.Uri.file('/.github/workflows/main.yml'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/.github/workflows/main.yml'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class WorkspaceTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    // Use a generic name or the specific file name for the icon
    super('workspace-task', undefined, collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon("task");
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class MsBuildTaskTypeItem extends TaskTypeGroupItem {
  constructor(collapsibleState?: vscode.TreeItemCollapsibleState) {
    super('msbuild', vscode.Uri.file('/msbuild.proj'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    const iconService = TaskIconService.getInstance();
    const iconUri = iconService.getTaskTypeIcon(this.label, vscode.Uri.file('/msbuild.csproj'));
    if (iconUri?.TaskIcon) {
      this.iconPath = iconUri.TaskIcon;
    }
  }
}

export class GenericTaskTypeItem extends TaskTypeGroupItem {
  constructor(type: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
    super(type, vscode.Uri.file('/file'), collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);

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
      case 'deno':
        return new DenoTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'npm':
        return new NpmTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'vscode':
        return new VscodeTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'github-actions':
        return new GithubActionsTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'script':
        return new ScriptTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'makefile':
        return new MakefileTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'dockerfile':
        return new DockerfileTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'docker-compose':
        return new DockerComposeTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'justfile':
        return new JustfileTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'venv':
        return new VenvTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'ant':
        return new AntTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'grunt':
        return new GruntTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'gulp':
        return new GulpTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'gradle':
        return new GradleTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'msbuild':
        return new MsBuildTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'workspace-task':
        return new WorkspaceTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'composer':
        return new ComposerTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      case 'mise':
        return new MiseTaskTypeItem(collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
      default:
        return new GenericTaskTypeItem(type, collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    }
  }
}
