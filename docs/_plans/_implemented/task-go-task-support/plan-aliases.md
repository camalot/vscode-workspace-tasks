# Plan: Task Aliases as Separate Tree Items

## TL;DR

Task aliases (`aliases:` field in Taskfile) are already stored in `item.metadata.aliases` by the
`TaskfileTaskProvider`. This plan surfaces each alias as a child `TaskItem` under its primary task in
the tree view, controlled by a new opt-in setting `workspaceTasks.taskfile.showAliases`. When enabled
(default `false`), any task with one or more aliases is rendered as a collapsible parent whose
children are individually runnable alias items.

---

## Requirements

- Each alias for a task is surfaced as a named child `TaskItem` under the primary task.
- Alias children are individually runnable: executing an alias child invokes `task <alias>`.
- Alias children share the same `taskFileUri` and `startLine` as their parent.
- Alias children have an "open file" action that opens the parent's Taskfile at the same line.
- The feature is controlled by `workspaceTasks.taskfile.showAliases` (boolean, default `true`).
- When disabled, the provider behaves exactly as it does today (no children, metadata preserved).
- No changes to `taskTreeDataProvider.ts` or `TaskItem` class are required — the existing
  `children` array and `getChildren()` already support child items.
- Achieve 100% test coverage for all new/changed code paths.

---

## Key Design Decisions

### Why children and not separate top-level items?

Aliases are alternative names for the same underlying task. Surfacing them as children of the
primary task:

- Preserves the primary name as the canonical identity for the task.
- Avoids duplicate entries at the top level that could confuse users.
- Is consistent with how `vscodeTaskProvider` renders `dependsOn` relationships using the
  existing `TaskItem.children` mechanism.

### Alias child execution

`task <alias>` is a first-class invocation. The Task CLI routes aliases to their target tasks
internally. Therefore alias children can use the standard task execution path in `taskFactory.ts`
without any modification — only the `label` (and thus `taskLabel`) differs.

### CollapsibleState mutation

`TaskItem.collapsibleState` is `readonly` in the constructor. Changing it after construction
requires `(item as any).collapsibleState = ...`. The precedent for this pattern exists in
`vscodeTaskProvider.ts`:

```typescript
(task as any).collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
```

An alternative is to construct the primary item with the correct initial state. This is preferred:
check `entry.aliases?.length` before calling `new TaskItem(...)` and pass
`vscode.TreeItemCollapsibleState.Collapsed` when aliases exist.

### Configuration key location

The setting `workspaceTasks.taskfile.showAliases` follows the same namespace pattern as the planned
`workspaceTasks.taskfile.discoverGlobalTaskfiles` setting (see `plan-global-taskfiles.md`). This keeps
all Task-specific behavioral settings under the `workspaceTasks.taskfile.*` namespace rather than
mixing them into `applicationPath.*`.

---

## Self-Critique & Viability Assessment

**Strengths:**

- No changes to tree infrastructure: `TaskItem.children`, `getChildren()`, and `parent` chaining
  already work correctly for collapsible items.
- Alias children are runnable without any `taskFactory.ts` changes because the alias name is
  simply used as the task label, which flows through to `taskLabel` in the factory.
- The opt-in setting provides a clear escape hatch for users who don't want visual noise from
  aliases.

**Risks / Weaknesses:**

- **`collapsibleState` is `readonly`:** Constructing with the correct state (passing
  `Collapsed` vs `None` upfront) is cleaner than post-construction mutation. The `parseOutput`
  method must determine collapsibility before constructing the `TaskItem`.
- **Task IDs:** `TaskStateManager.getTaskId()` is called in the `TaskItem` constructor. Two
  items with the same label and taskFileUri will collide. Alias children will always have a
  different label (the alias name), so collision is not a concern here.
- **Alias items and favorites/recents:** Because alias children are `TaskItem` instances with
  proper `id` values, they can be favorited or added to recents independently — which may or may
  not be desired. This is acceptable for v1 and consistent with how other child items behave.
- **Context values:** `updateContextValue()` is called in the `TaskItem` constructor and cascades
  to children automatically through `parent` assignment. Alias children need their `parent` set
  after both items are constructed.

**Verdict:** Viable, low-risk, well-scoped. The existing tree infrastructure handles children
correctly. The main implementation detail is passing `Collapsed` to the primary item's constructor
when aliases exist, and then constructing the alias children and assigning `parent`.

---

## Implementation

### Phase 1 — Configuration

#### `package.json`

Add under the `workspaceTasks` configuration object (alongside `applicationPath.taskfile`):

```json
"workspaceTasks.taskfile.showAliases": {
  "type": "boolean",
  "default": true,
  "description": "%config.workspaceTasks.taskfile.showAliases%",
  "scope": "resource"
}
```

#### `package.nls.json`

```json
"config.workspaceTasks.taskfile.showAliases": "Show Task aliases as child tree items under their primary task."
```

### Phase 2 — Provider Changes

#### `src/providers/taskTaskProvider.ts`

In `parseOutput()`, read the `showAliases` configuration and conditionally populate children.

**Import addition:**

```typescript
import { Configuration } from '../libs/configuration';
```

**Modified `parseOutput()` loop body** (diff-style):

```typescript
const showAliases = Configuration.getInstance().get<boolean>('task.showAliases') ?? true;
const aliases = entry.aliases ?? [];
const hasAliases = showAliases && aliases.length > 0;

const item = new TaskItem(
  entry.name,
  hasAliases ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  'task',
  taskFileUri,
  undefined,
  iconPath,
);
item.taskFileUri = taskFileUri;
item.description = vscode.workspace.asRelativePath(taskFileUri);
item.tooltip = entry.desc || entry.name;
item.startLine = entry.location?.line ? entry.location.line - 1 : 0;
item.metadata = {
  aliases,
  summary: entry.summary ?? '',
};
item.onOpenActionCommand = {
  command: 'workspaceTasks.openFileAtLine',
  title: 'Open File',
  arguments: [taskFileUri, item.startLine],
};

if (hasAliases) {
  for (const alias of aliases) {
    const aliasItem = new TaskItem(
      alias,
      vscode.TreeItemCollapsibleState.None,
      'task',
      taskFileUri,
      undefined,
      iconPath,
    );
    aliasItem.taskFileUri = taskFileUri;
    aliasItem.description = vscode.workspace.asRelativePath(taskFileUri);
    aliasItem.tooltip = `Alias for: ${entry.name}`;
    aliasItem.startLine = item.startLine;
    aliasItem.metadata = { isAlias: true, primaryTask: entry.name };
    aliasItem.onOpenActionCommand = {
      command: 'workspaceTasks.openFileAtLine',
      title: 'Open File',
      arguments: [taskFileUri, item.startLine],
    };
    aliasItem.parent = item;
    item.children.push(aliasItem);
  }
}

tasks.push(item);
```

> **No changes to `taskFactory.ts`:** Alias items have `taskType = 'task'` and their `label` is
> the alias name. The existing `case 'task':` block uses `item.originalLabel ?? item.label` as
> the task name, so alias children are executed correctly via `task <alias>`.

### Phase 3 — Tests

#### `src/test/suite/taskTaskProvider.test.ts`

Add a new `parseOutput — alias children` sub-suite with 100% coverage of the new code paths:

| Test | Description |
|------|-------------|
| `showAliases enabled: primary item is Collapsed when aliases exist` | `item.collapsibleState === Collapsed` |
| `showAliases enabled: primary item is None when no aliases` | `item.collapsibleState === None` |
| `showAliases enabled: alias child items are created` | `item.children.length === aliases.length` |
| `showAliases enabled: alias child label matches alias name` | `child.label === alias` |
| `showAliases enabled: alias child taskFileUri matches parent` | Same URI |
| `showAliases enabled: alias child startLine matches parent` | Same `startLine` |
| `showAliases enabled: alias child tooltip says "Alias for: <name>"` | Tooltip format |
| `showAliases enabled: alias child metadata.isAlias is true` | `metadata.isAlias === true` |
| `showAliases enabled: alias child metadata.primaryTask is primary name` | Correct primary name |
| `showAliases enabled: alias child parent is primary item` | `child.parent === item` |
| `showAliases disabled: primary item is None even with aliases` | No children when disabled |
| `showAliases disabled: no children created` | `item.children.length === 0` |

**Fixture additions:**

Add a fixture JSON entry with `"aliases": ["b", "bld"]` to the existing
`valid-output.json` fixture (or create a dedicated `aliases-output.json`).

#### `src/test/suite/taskFactoryTask.test.ts`

Add 2 tests:

| Test | Description |
|------|-------------|
| `alias child item runs alias name (not primary)` | `task.name === alias` in created vscode.Task |
| `alias child cwd is same Taskfile directory` | `cwd` matches parent's Taskfile directory |

### Phase 4 — Documentation

#### `docs/task-types/task.md`

Add a new **Aliases** section:

> Task supports aliases (alternative names for a task). When `workspaceTasks.taskfile.showAliases`
> is `true` (the default), tasks with aliases appear as expandable items in the tree. Each alias
> is listed as a child item and can be run independently.
>
> To disable aliases in the tree, add to VS Code settings:
> ```json
> { "workspaceTasks.taskfile.showAliases": false }
> ```

#### `docs/configuration/` (general or task-specific page)

Add `workspaceTasks.taskfile.showAliases` setting reference entry.

#### `sample/sample-workspace-tasks/task/Taskfile.yml`

Add an alias to the `build` task to demonstrate the feature:

```yaml
build:
  desc: Build the application
  aliases: [b, bld]
  cmds:
    - echo "Building {{.APP_NAME}}..."
```

---

## File Change Summary

| File | Change |
|------|--------|
| `src/providers/taskTaskProvider.ts` | Modified — alias child logic in `parseOutput()` |
| `package.json` | Add `workspaceTasks.taskfile.showAliases` setting |
| `package.nls.json` | Add NLS string for new setting |
| `src/test/suite/taskTaskProvider.test.ts` | New alias test cases |
| `src/test/suite/taskFactoryTask.test.ts` | New alias execution test cases |
| `src/test/task-files/task/aliases-output.json` | New fixture with aliases |
| `docs/task-types/task.md` | Add Aliases section |
| `sample/sample-workspace-tasks/task/Taskfile.yml` | Add `aliases: [b, bld]` to build task |

---

## Open Questions / Future Work

- **Alias items in favorites/recents:** Should alias children be excluded from favorites? Could
  be gated by `metadata.isAlias` if user feedback indicates confusion.
- **Alias tooltip localization:** The "Alias for: X" tooltip is currently hardcoded English.
  Should use NLS if the extension adds full localization support.
