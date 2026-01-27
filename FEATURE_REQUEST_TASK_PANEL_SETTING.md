# Feature Request: Configurable Task Panel Behavior

**Title:** [Feature]: Add setting to control task terminal panel behavior (Dedicated vs Shared)

## Problem Statement

Currently, all tasks executed through the Workspace Tasks extension use `TaskPanelKind.Dedicated`, which means each task gets its own dedicated terminal panel. When users run many tasks, this can lead to terminal panel proliferation, making it difficult to manage and navigate between different task outputs.

## Proposed Solution

Add a new configuration setting that allows users to control the task panel behavior. The setting should support:

1. **Dedicated** (current default): Each task gets its own dedicated terminal panel
2. **Shared**: Tasks share terminal panels based on their name or type
3. **New**: Always create a new terminal for each task execution (even if the same task is run multiple times)

Example configuration in `package.json`:

```json
"workspaceTasks.taskPanelKind": {
  "type": "string",
  "enum": ["dedicated", "shared", "new"],
  "default": "dedicated",
  "description": "Controls how terminal panels are managed when running tasks",
  "enumDescriptions": [
    "Each task gets its own dedicated terminal panel",
    "Tasks with the same name share a terminal panel",
    "Always create a new terminal for each task execution"
  ]
}
```

Implementation would modify the task execution code in `src/taskRunner.ts` (lines 45-48) to read this configuration and set the appropriate `TaskPanelKind`:

```typescript
const config = vscode.workspace.getConfiguration('workspaceTasks');
const panelKindSetting = config.get<string>('taskPanelKind', 'dedicated');

let panelKind: vscode.TaskPanelKind;
switch (panelKindSetting) {
  case 'shared':
    panelKind = vscode.TaskPanelKind.Shared;
    break;
  case 'new':
    panelKind = vscode.TaskPanelKind.New;
    break;
  case 'dedicated':
  default:
    panelKind = vscode.TaskPanelKind.Dedicated;
    break;
}

task.presentationOptions = {
  ...task.presentationOptions,
  panel: panelKind
};
```

## Alternatives Considered

1. **Always use Shared**: This would solve the proliferation issue but removes the benefit of dedicated panels for users who prefer them
2. **Task-specific configuration**: Allow configuration per task type or pattern, but this would be more complex to implement and configure
3. **Automatic behavior based on workspace size**: Dynamically choose based on the number of tasks, but this could be unpredictable

## Feature Area

Configuration

## Priority

Medium - Would be nice to have

## Use Case

In my workflow, I frequently run multiple tasks (builds, tests, linters, etc.) throughout the day. With the current dedicated panel behavior, I end up with many terminal panels that I need to manually close or navigate through. 

This feature would help by allowing me to configure the extension to use shared panels, reducing clutter while still providing access to task output. Users who prefer the current dedicated behavior could keep it, making this a win for all users.

## Examples

VSCode's built-in task system supports all three panel kinds (`Dedicated`, `Shared`, and `New`) through the `presentation.panel` option in `tasks.json`. This feature would bring the Workspace Tasks extension in line with VSCode's native task behavior.

Reference: [VSCode Task API - TaskPanelKind](https://code.visualstudio.com/api/references/vscode-api#TaskPanelKind)

## Additional Context

- This issue was raised during code review of PR #17 at https://github.com/camalot/vscode-workspace-tasks/pull/17#discussion_r2733218465
- The current implementation is in `src/taskRunner.ts` lines 45-48
- The change should maintain backward compatibility by defaulting to `dedicated` (current behavior)
- Consider adding this setting to the README.md documentation once implemented

## Pre-submission Checklist

- [x] I have searched existing issues to ensure this feature hasn't been requested
- [x] I have checked the documentation to confirm this feature doesn't already exist
- [x] I am willing to help test this feature if implemented
