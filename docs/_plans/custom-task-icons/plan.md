# Plan: Custom Task Icons via Settings

## TL;DR

Allow users to override the icon shown for any **task-type group** (the parent row in the tree
view, e.g. "npm", "shell", "gradle") and — in a separate, subsequent phase — the icon shown on
individual **task items** themselves. Both levels are controlled exclusively through VS Code's
Settings UI; no manual `settings.json` editing is required. The configuration key is an object
whose keys are internal task-type names and whose values are icon strings. If a configured icon
cannot be resolved the extension silently falls back to the built-in default for that type.

---

## Requirements

### Task-type group icons (Part A — this plan)

- A new setting `workspaceTasks.taskTypeIcons` of type `object` allows users to override the
  icon of any task-type group tree item by its internal task-type name.
- Each value is a **string** in one of the following forms:
  - VS Code built-in codicon: `$(cog)`, `$(play)`, `$(symbol-event)`, etc.
  - workspaceTasks bundled icon: `$(npm)`, `$(gulp)`, `$(shell)`, etc. (any name that matches
    a file in `res/icons/{light,dark}/`).
  - Absolute file path to an image: `/home/user/icons/my-icon.svg`.
  - Workspace-relative file path: `icons/my-type.png`.
- The object schema uses `additionalProperties: { type: "string" }` with no fixed keys, so the
  Settings UI renders each entry as a free-form string field that users can add/remove without
  hand-editing JSON.
- If the configured value for a type cannot be resolved (bad path, missing bundled name, invalid
  syntax) the extension logs a debug message and uses the default icon for that type — no
  error is shown to the user.
- Changes to `workspaceTasks.taskTypeIcons` take effect after a treeview refresh (existing
  `onDidChangeConfiguration` wiring handles this).

### Task-item icons (Part B — future plan)

Part B covers overriding individual task item icons (the leaf nodes). It is intentionally scoped
out of this plan because:

- Task items already have a separate, more complex icon pipeline via
  `workspaceTasks.task.iconType` and `workspaceTasks.task.iconTypeCustom` (global overrides).
- Per-task-type item icon overrides require intersecting with that existing pipeline and
  deciding precedence (user per-type override > global iconType > built-in type icon).
- The treeview renders task items from `TaskItem` directly; group items go through
  `TaskTypeGroupItem` subclasses and `TaskTypeFactory` — different code paths.

A separate plan document will be created for Part B when this plan (Part A) is complete.

---

## Key Design Decisions

### Setting shape

The setting is an object (`additionalProperties: string`) rather than an array of `{type, icon}`
tuples. An object is displayed in the VS Code Settings UI as a live-editable key-value grid
(the same widget used by `workspaceTasks.shellPaths`, `workspaceTasks.shellAdditionalExtensions`,
etc.), meaning users never need to open `settings.json`. Each object property is the internal
task-type name; the value is the icon string.

```jsonc
// Example user configuration
"workspaceTasks.taskTypeIcons": {
  "npm":   "$(package)",
  "shell": "$(terminal-bash)",
  "gulp":  "/home/user/icons/gulp.svg"
}
```

### Icon string resolution order

The resolution order within `TaskIconService` for a configured icon string is:

1. **`$(name)` — workspaceTasks bundled icon** — if `res/icons/light/<name>.svg` and
   `res/icons/dark/<name>.svg` both exist, use the SVG pair.
2. **`$(name)` — VS Code ThemeIcon** — always available as a fallback when the bundled SVG
   pair is absent; use `new vscode.ThemeIcon(name)`.
3. **Absolute file path** — if the string is absolute, is an image file, and exists on disk.
4. **Workspace-relative path** — resolve against the first workspace folder root.
5. **Fallback** — if none of the above resolve, return the default built-in type icon (same
   result as if no setting had been provided).

This order means `$(npm)` first tries to render the bundled high-resolution SVG pair, then
gracefully degrades to the VS Code codicon named `npm` if the SVG pair is missing (e.g. in a
stripped production build), ensuring the setting is always meaningful.

### Where the setting is consumed

`TaskTypeFactory.create` already accepts an optional `iconUri` parameter and passes it to
`GenericTaskTypeItem`. The concrete type-specific subclasses (`NpmTaskTypeItem`,
`GulpTaskTypeItem`, etc.) currently ignore `iconUri` — they hard-code their own
`getTaskTypeIcon` call. The plan retrofits those classes so that when a user override is present
it takes priority.

The lookup point is `TaskIconService`: a new public method
`resolveCustomTypeIcon(type: string): TaskIconUri | undefined` reads from
`workspaceTasks.taskTypeIcons`, delegates to the existing resolution logic, and returns the
result (or `undefined` if not configured / not resolvable).

`TaskTypeFactory.create` is updated to call `resolveCustomTypeIcon` first and pass the result
down. Each concrete subclass constructor gains a new optional `customIcon` parameter (type
`TaskIconUri | undefined`); if supplied and non-empty it is used instead of the built-in icon.

### No sub-types (shell sub-groups)

Shell sub-type groups (`bash`, `sh`, `python`, etc.) are also instances of
`GenericTaskTypeItem`. Their type strings match the same `shellEnabledTaskTypes` keys. The
setting therefore works for shell sub-types with no extra code — a user can set
`"workspaceTasks.taskTypeIcons": { "bash": "$(terminal)" }` and the bash sub-group gets the
codicon terminal icon.

### Fallback guarantee

`resolveCustomTypeIcon` returns `undefined` when the configured value cannot be resolved.
Callers treat `undefined` as "use default", preserving existing behavior exactly. There is no
error notification — only a `debug`-level log entry including the raw configured value, the type
name, and the reason for failure.

---

## New Setting

### `workspaceTasks.taskTypeIcons`

| Property | Value |
|---|---|
| **Type** | `object` (additionalProperties: string) |
| **Default** | `{}` |
| **Scope** | `resource` |

```jsonc
"workspaceTasks.taskTypeIcons": {
  "npm":     "$(package)",
  "shell":   "$(terminal-bash)",
  "gradle":  "$(tools)",
  "python":  "/home/user/icons/python-custom.svg"
}
```

Each key is an internal task-type name (the same names used in `workspaceTasks.enabledTaskTypes`
and `workspaceTasks.shellEnabledTaskTypes`). The value is an icon string.

**Accepted icon string formats:**

| Format | Example | Notes |
|---|---|---|
| `$(name)` codicon / bundled | `$(npm)`, `$(cog)` | Bundled SVG pair tried first; VS Code ThemeIcon as fallback |
| Absolute file path | `/Users/me/icons/x.svg` | Must be an image file (`.svg`, `.png`, `.jpg`, `.gif`, `.webp`, `.ico`) |
| Workspace-relative path | `icons/my-icon.svg` | Resolved against first workspace folder |

---

## Implementation Phases

### Phase 1 — Settings (`package.json` / `package.nls.json`)

**Files to change:** `package.json`, `package.nls.json`

Add the new setting to the **"Task Display & Interaction"** configuration group (same section
as `workspaceTasks.task.iconType`):

```jsonc
"workspaceTasks.taskTypeIcons": {
  "type": "object",
  "additionalProperties": { "type": "string" },
  "default": {},
  "scope": "resource",
  "description": "%config.workspaceTasks.taskTypeIcons%",
  "markdownDescription": "%config.workspaceTasks.taskTypeIcons.markdown%"
}
```

**`package.nls.json` strings to add:**

```json
"config.workspaceTasks.taskTypeIcons": "Custom icons for task-type groups",
"config.workspaceTasks.taskTypeIcons.markdown": "Override the icon displayed for any task-type group in the tree view. Each key is an internal task-type name (e.g. `npm`, `shell`, `gradle`, `bash`). The value is an icon string: a VS Code codicon reference such as `$(package)`, a bundled workspaceTasks icon such as `$(npm)`, an absolute file path, or a path relative to the workspace root."
```

**Details:**

- Place the setting after `workspaceTasks.task.iconTypeCustom` and before
  `workspaceTasks.recentTasks.maxItems` to keep task-display settings together.
- Scope is `resource` (not `window`) so per-folder workspace overrides work.
- No `properties` key — using `additionalProperties` alone allows the Settings UI to render
  an "add item" widget without requiring a fixed schema per task type.

---

### Phase 2 — `TaskIconService.resolveCustomTypeIcon()`

**File to change:** `src/services/taskIconService.ts`

Add a new public method that reads the configured icon for a given type and resolves it:

```typescript
/**
 * Returns a resolved icon for `type` from `workspaceTasks.taskTypeIcons`, or
 * `undefined` if no override is configured or the value cannot be resolved.
 * Falling back to `undefined` preserves the built-in default.
 */
public resolveCustomTypeIcon(type: string): TaskIconUri | undefined {
  const config = vscode.workspace.getConfiguration('workspaceTasks');
  const typeIcons = config.get<Record<string, string>>('taskTypeIcons', {});
  const raw = typeIcons[type];
  if (!raw) {
    return undefined;
  }
  return this.resolveIconString(raw, type);
}
```

Add a private helper `resolveIconString(raw: string, type: string): TaskIconUri | undefined`
that follows the resolution order documented in the Key Design Decisions above:

1. Match `$(name)` — try bundled SVG pair first; fall back to `new vscode.ThemeIcon(name)`.
2. Absolute path — `path.isAbsolute(raw) && isImageFile(raw) && fs.existsSync(raw)`.
3. Workspace-relative path — resolve against first workspace folder.
4. If nothing resolves: log debug message and return `undefined`.

The `$(name)` ThemeIcon fallback path (step 1b) needs special treatment: `vscode.ThemeIcon`
instances cannot be stored in `TaskIconUri.TaskIcon` (which only accepts `{ light, dark }`).
Introduce a new optional field on `TaskIconUri`:

```typescript
export interface TaskIconUri {
  TaskIcon?: TaskIcon;       // existing: {light, dark} URI pair
  DisplayUri?: vscode.Uri;   // existing: for file-icon-theme matching
  ThemeIcon?: vscode.ThemeIcon; // NEW: VS Code codicon / ThemeIcon
}
```

Callers that set `this.iconPath` already accept `vscode.ThemeIcon`, so adding `ThemeIcon` to
the interface lets the resolved value flow cleanly through the constructor chain without any
type casts.

**No changes are needed to the existing `resolveWorkspaceTaskTypeIcon` method** — it is used
for workspace-task custom types (`.workspace-tasks.json` iconUri field) and should remain
unchanged. `resolveCustomTypeIcon` is a separate method that reads from the new setting.

---

### Phase 3 — `TaskTypeFactory` and concrete type items

**File to change:** `src/taskTypeItems.ts`

**Step 3.1 — Update `TaskTypeFactory.create`**

`TaskTypeFactory.create` calls `resolveCustomTypeIcon` and passes the result to each branch:

```typescript
public static create(
  type: string,
  collapsibleState?: vscode.TreeItemCollapsibleState,
  iconUri?: string | { dark: string; light: string },
): TaskTypeGroupItem {
  const iconService = TaskIconService.getInstance();
  const customIcon = iconService.resolveCustomTypeIcon(type);

  switch (type) {
    case 'npm':
      return new NpmTaskTypeItem(collapsibleState ?? ..., customIcon);
    // ... all other cases ...
    default:
      return new GenericTaskTypeItem(type, iconUri, collapsibleState ?? ..., customIcon);
  }
}
```

**Step 3.2 — Update concrete subclass constructors**

Each concrete `TaskTypeGroupItem` subclass gains an optional `customIcon?: TaskIconUri`
parameter as its **first** parameter (before `collapsibleState`). The constructor applies it
before the built-in lookup:

```typescript
export class NpmTaskTypeItem extends TaskTypeGroupItem {
  constructor(
    collapsibleState?: vscode.TreeItemCollapsibleState,
    customIcon?: TaskIconUri,
  ) {
    super('npm', undefined, collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    if (customIcon?.ThemeIcon) {
      this.iconPath = customIcon.ThemeIcon;
    } else if (customIcon?.TaskIcon) {
      this.iconPath = customIcon.TaskIcon;
    } else {
      // existing built-in lookup
      const iconUri = TaskIconService.getInstance().getTaskTypeIcon('npm');
      if (iconUri?.TaskIcon) {
        this.iconPath = iconUri.TaskIcon;
      }
    }
  }
}
```

The same pattern applies to all other concrete type items. `GenericTaskTypeItem` already
accepts an `iconUri` string — it gains an additional `customIcon?: TaskIconUri` parameter and
applies the custom override before calling `resolveWorkspaceTaskTypeIcon`.

**Affected subclasses (all in `taskTypeItems.ts`):**

`NpmTaskTypeItem`, `DenoTaskTypeItem`, `VscodeTaskTypeItem`, `ScriptTaskTypeItem`,
`MakefileTaskTypeItem`, `DockerfileTaskTypeItem`, `DockerComposeTaskTypeItem`,
`JustfileTaskTypeItem`, `VenvTaskTypeItem`, `AntTaskTypeItem`, `GruntTaskTypeItem`,
`GulpTaskTypeItem`, `GradleTaskTypeItem`, `MsBuildTaskTypeItem`, `WorkspaceTaskTypeItem`,
`ComposerTaskTypeItem`, `MiseTaskTypeItem`, `CakeTaskTypeItem`, `GithubActionsTaskTypeItem`,
`GenericTaskTypeItem`.

---

### Phase 4 — `onDidChangeConfiguration` wiring

**File to change:** `src/extension.ts` (or wherever `onDidChangeConfiguration` is registered)

Add `workspaceTasks.taskTypeIcons` to the list of configuration keys that trigger a treeview
refresh. The existing handler pattern is:

```typescript
vscode.workspace.onDidChangeConfiguration((e) => {
  if (e.affectsConfiguration('workspaceTasks.taskTypeIcons')) {
    taskTreeDataProvider.refreshLocal();
  }
});
```

Verify that `refreshLocal()` (which fires `_onDidChangeTreeData`) causes `TaskTypeFactory.create`
to be called again with the new icons. If the treeview caches group items across refreshes, a
full `refresh()` (cache bust) may be required — audit the `getChildren` path in
`TaskTreeDataProvider` to confirm.

---

### Phase 5 — Tests

**File to change:** `src/test/suite/taskIconService.test.ts`, `src/test/suite/taskTypeItems.test.ts`

#### `taskIconService.test.ts` — new suite `resolveCustomTypeIcon`

| Test | Description |
|---|---|
| `no override configured: returns undefined` | `taskTypeIcons` is `{}`; assert return is `undefined` for any type. |
| `$(npm) configured: resolved to bundled SVG pair` | SVG pair exists in temp dir; assert `TaskIcon.light`/`dark` set. |
| `$(cog) configured: no bundled SVG pair: falls back to ThemeIcon` | No `cog.svg` in temp dir; assert `ThemeIcon.id === 'cog'`. |
| `absolute path to image: resolved to TaskIcon URI pair` | Supply a real image path; assert `TaskIcon.light.fsPath` matches. |
| `workspace-relative path: resolved against workspace folder` | Mock `workspaceFolders`; assert resolved path. |
| `invalid value (bad path): returns undefined` | Supply a non-existent absolute path; assert `undefined`. |
| `invalid value (unknown extension): returns undefined` | Supply `"bad.xyz"`; assert `undefined`. |
| `type not in taskTypeIcons: returns undefined` | `taskTypeIcons` has entry for `npm` only; query `gradle`; assert `undefined`. |

#### `taskTypeItems.test.ts` — additions to existing suites

| Test | Description |
|---|---|
| `NpmTaskTypeItem: customIcon ThemeIcon overrides built-in icon` | Pass `TaskIconUri { ThemeIcon: new vscode.ThemeIcon('cog') }`; assert `item.iconPath` is `ThemeIcon`. |
| `NpmTaskTypeItem: customIcon TaskIcon overrides built-in SVG` | Pass `TaskIconUri { TaskIcon: { light: uri, dark: uri } }`; assert `item.iconPath` matches. |
| `NpmTaskTypeItem: customIcon undefined: falls back to built-in` | Pass `undefined`; assert existing icon behavior unchanged. |
| `TaskTypeFactory.create: calls resolveCustomTypeIcon and passes result` | Stub `resolveCustomTypeIcon` to return a ThemeIcon; assert the returned item's iconPath matches. |
| `GenericTaskTypeItem: customIcon takes precedence over iconUri string` | Provide both `customIcon` (ThemeIcon) and `iconUri` (path); assert ThemeIcon wins. |

---

### Phase 6 — Documentation

**Files to change:**

- `docs/configuration/display-interaction/task-display.md` (or the task-icon settings page)
  - Add `workspaceTasks.taskTypeIcons` to the property table.
  - Document accepted value formats with examples.
  - Note the internal task-type name list (same as `enabledTaskTypes` keys, plus
    `shellEnabledTaskTypes` keys for shell sub-types).

- `README.md`
  - One-sentence mention in the Key Features bullet about icon customisation, linking to the
    docs page.

---

## Files Modified Summary

| File | Change |
|---|---|
| `package.json` | Add `workspaceTasks.taskTypeIcons` setting with `additionalProperties: string` schema |
| `package.nls.json` | Add NLS strings for the new setting |
| `src/services/taskIconService.ts` | Add `ThemeIcon` field to `TaskIconUri`; add `resolveCustomTypeIcon()` and `resolveIconString()` private/public methods |
| `src/taskTypeItems.ts` | Add `customIcon?: TaskIconUri` to all concrete `TaskTypeGroupItem` constructors; update `TaskTypeFactory.create` to call `resolveCustomTypeIcon` and pass result |
| `src/extension.ts` | Register `affectsConfiguration('workspaceTasks.taskTypeIcons')` handler |
| `src/test/suite/taskIconService.test.ts` | 8 new tests for `resolveCustomTypeIcon` |
| `src/test/suite/taskTypeItems.test.ts` | 5 new tests covering custom icon override in group items and factory |
| `docs/configuration/display-interaction/task-display.md` | Document new setting |
| `README.md` | One-sentence feature mention |

---

## Out of Scope (Part B — task item icons)

Part B will document how to override the icon on **individual task items** (leaf nodes).
Key differences from Part A that warrant a separate plan:

- Task items already have a four-mode global override (`workspaceTasks.task.iconType` /
  `workspaceTasks.task.iconTypeCustom`). Part B must define precedence for a per-type override
  against the existing global modes.
- The proposed setting for Part B is `workspaceTasks.taskIcons` — same object shape, same value
  formats — applied inside `TaskIconService.getTaskIcon()` after the global `iconType` check.
- The per-type task icon applies to every task whose `taskType` matches the key, regardless of
  which file it came from.
- Part B should also consider whether the icon should appear differently in the **Favorites**
  and **Recent** sub-trees (where tasks are cloned) — those clones carry `taskType` so the same
  lookup works without extra plumbing.
