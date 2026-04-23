# Plan: Use `just --json` to Parse Justfile Recipes

## TL;DR

Replace the fragile regex-based justfile parser in `JustfileTaskProvider` with a call to
`just --justfile <path> --dump --dump-format json` which returns a machine-readable JSON dump
of all recipes. This eliminates parsing bugs caused by body lines containing shell keywords
(e.g. `for`, `echo`) that the regex incorrectly matched as recipe names.

If `just` is unavailable or fails for any reason, the provider logs to the output channel and
produces no tasks for that justfile — there is no regex fallback. If the user cannot run `just`,
they cannot execute the tasks anyway.

Additionally, when `workspaceTasks.groups.justfile.enabled` is `true`, recipes that carry a
`[group('name')]` attribute are surfaced under collapsible group nodes in the tree. Group nodes
are non-runnable and display the justfile icon. The setting defaults to `false`.

---

## Background

### The Bug

The current `JustfileTaskProvider.getTasks()` method reads each justfile as text, splits on
newlines, and applies this regex to every (trimmed) line:

```
/^@?([a-zA-Z_][a-zA-Z0-9_-]*)\s*.*:/
```

This regex has two compounding flaws:

1. **`trim()` destroys indentation information.** Recipe body lines are indented (4 spaces), but
   trimming them makes them indistinguishable from recipe header lines (which start at column 0).

2. **`.*:` is greedy.** It matches any `:` anywhere in the line, not just the recipe-separator
   colon. Body lines like:

   ```
   @for i in {1..10}; do echo "Progress: $i/10"; sleep 1; done
   @echo "Current directory: {{justfile_directory()}}"
   ```

   are trimmed and then matched, producing phantom task names `for` and `echo`.

The reserved-keyword exclusion list (`mod`, `import`, `export`, `alias`, `set`) is incomplete and
cannot cover all shell built-ins that may appear in recipe bodies.

### The Fix

`just` itself provides a `--json` flag (also available as `--dump --dump-format json`) that
returns a machine-readable JSON dump of all recipes in a justfile:

```
just --justfile path/to/justfile --dump --dump-format json
```

Since `just` 0.10.4 (November 2021) `--dump-format json` has been available, and since `just` 1.15.0
(October 2023) the JSON format has been marked stable. Using this eliminates all regex ambiguity.
Note: `--json` is a shorthand added in 1.48.0 (March 2026); the implementation uses the longer
form for maximum compatibility.

---

## Requirements

1. `JustfileTaskProvider.getTasks()` MUST invoke `just --justfile <path> --dump --dump-format json`
   for each discovered justfile to obtain recipe names, and use the result as the primary and
   **only** source of truth.
2. If `just` is not installed, returns a non-zero exit code, is not found in PATH, or the
   `applicationPath.just` setting does not resolve to a valid binary, the provider MUST log a
   message to the output channel, skip that justfile entirely, and return no tasks. There is no
   regex fallback. A user who cannot run `just` cannot execute the tasks.
3. Private recipes (marked with `[private]` or prefixed with `_`) returned in the JSON are
   included as tasks (consistent with current behaviour).
4. The `startLine` of each task item MUST still be resolved against the file content so that
   "Open File At Line" navigation works correctly.
5. A `tooltip` is populated from the recipe's `doc` field when present in the JSON output.
6. The `just` binary path is resolved using the existing `ExecutableService.getCommand()` so that
   any user-configured `applicationPath.just` setting is respected.
7. When `workspaceTasks.groups.justfile.enabled` is `true`, recipes that carry a `[group()]`
   attribute are placed under collapsible group nodes in the tree. Group nodes:
   - Use the justfile icon.
   - Have `collapsibleState: Collapsed`.
   - Have no runnable command and no action-bar buttons.
   - Are children of the enclosing justfile type item (or workspace folder item) like any other
     group in the extension.
8. Recipes without a group attribute are listed directly (ungrouped) even when groups are enabled.
9. A new boolean setting `workspaceTasks.groups.justfile.enabled` is added to `package.json`
   under the **Display** configuration group with a default of `false`.
10. 100% test coverage for all new and changed code.
11. Existing tests must be updated to work with the `execFile`-based path.
12. Documentation in `docs/` must be updated to describe the improved parsing behaviour,
    minimum recommended `just` version, and the groups setting.

---

## JSON Output Shape

The JSON produced by `just --justfile <path> --dump --dump-format json` has the following relevant
shape (as of `just` 1.15.0+):

```json
{
  "first": "default",
  "recipes": {
    "build": {
      "name": "build",
      "doc": "Build the project",
      "body": [["cargo build"]],
      "dependencies": [],
      "parameters": [],
      "priors": 0,
      "private": false,
      "quiet": false,
      "shebang": false,
      "attributes": [
        { "name": "group", "value": "Build" }
      ]
    }
  },
  "settings": { ... },
  "variables": { ... }
}
```

Only the `recipes` map is consumed. Each key in `recipes` is the recipe name (identical to the
`name` field). The `doc` field is `null` when there is no doc-comment.

The `attributes` array contains objects with a `name` field and optional `value` field. The
`[group('name')]` attribute appears as `{ "name": "group", "value": "<group name>" }`. Recipes
without a group attribute have an empty `attributes` array or an array containing only non-group
entries. The exact shape of the `attributes` objects should be verified against the actual `just`
binary version in use, as it has evolved across versions.

> **Note:** `[group()]` support was added in `just` 1.13.0 (August 2023). Older versions produce
> an empty `attributes` array, which means all recipes will be ungrouped — the correct and safe
> behaviour for the fallback case.

---

## Key Design Decisions

### Use `execFile` with the configured `just` binary

Consistent with the `RakeTaskProvider` pattern, the provider will use `promisify(execFile)` to
run `just`. The command is resolved via `ExecutableService.getCommand()` (respecting
`applicationPath.just` user settings) and the working directory is set to the directory containing
the justfile so that `just` can locate any imported files correctly.

### No fallback: log and skip on error

If `just` is unavailable, exits non-zero, or cannot be resolved, the provider logs the error to
the output channel (at warning level) and skips that justfile — returning no tasks for it. There
is **no regex fallback**. This is intentional: if the user cannot run `just`, they cannot run any
of the discovered tasks, so surfacing them would be misleading. The earlier regex fallback was also
the source of the original bug.

### Justfile recipe groups

Just recipes may carry a `[group('name')]` attribute (available since just 1.13.0). When the
`workspaceTasks.groups.justfile.enabled` setting is `true`, the provider groups recipes under
collapsible `TaskItem` group nodes, following the same pattern used by the BitBucket Pipelines
provider for file-level group items.

Group items are created with:
- `collapsibleState: Collapsed`
- `taskType = 'justfile'` and `metadata = { type: 'group', groupName: '<name>' }`
- The justfile icon (via `TaskIconService`)
- `children` array populated with the recipe `TaskItem` instances for that group
- No `command` — they are not runnable

The `taskItem.ts` `updateContextValue()` method must be updated to recognise
`taskType === 'justfile' && metadata?.type === 'group'` as a group node (following the same
pattern as `isBitbucketFileGroup`), which will set `contextValue = 'justfileGroup'`. Because no
`when` clause in `package.json` menus targets `'justfileGroup'`, these nodes will have no action
bar buttons.

Recipes with no group attribute are placed directly in the flat list (ungrouped), even when groups
are enabled. Groups and ungrouped recipes may coexist in the same justfile.

### `startLine` resolution after JSON parsing

The JSON output does not include source line numbers. After collecting recipe names from JSON, the
provider re-reads the file content (which it already opened to read the text) and scans for the
line matching `^@?<recipeName>\b` to determine `startLine`. This is a fast single-pass scan.

### Typed interfaces for JSON output

A pair of interfaces (`JustRecipe`, `JustfileJsonOutput`) are defined in the provider file to
type the parsed JSON, avoiding use of `any`. An additional `JustRecipeAttribute` interface types
the attribute objects in the `attributes` array.

---

## Implementation Plan

### Phase 1 — Refactor `justfileTaskProvider.ts`

**Files changed:** `src/providers/justfileTaskProvider.ts`

#### 1a. Add imports

```typescript
import { promisify } from 'util';
import { execFile } from 'child_process';
```

Note: `execFileAsync` is defined as a **protected class property** (not module-level) to allow
test overriding:

```typescript
protected execFileAsync = promisify(execFile);
```

#### 1b. Add typed interfaces

```typescript
interface JustRecipeAttribute {
  name: string;
  value?: string;
}

interface JustRecipe {
  name: string;
  doc: string | null;
  parameters: unknown[];
  private: boolean;
  quiet: boolean;
  body: string[][];
  dependencies: unknown[];
  attributes: JustRecipeAttribute[];
  shebang: boolean;
  priors: number;
}

interface JustfileJsonOutput {
  first: string;
  recipes: Record<string, JustRecipe>;
  settings: Record<string, unknown>;
  variables: Record<string, unknown>;
}
```

#### 1c. Add `getJustJsonOutput()` (primary and only path)

```typescript
private async getJustJsonOutput(
  justfilePath: string,
  justCmd: ExecutableResult,
): Promise<JustfileJsonOutput | null> {
  try {
    const { stdout, stderr } = await this.execFileAsync(
    if (stderr) { this.logger.debug(`[JustfileTaskProvider] just --dump stderr: ${stderr}`); }
      justCmd.command,
      [...justCmd.args, '--justfile', justfilePath, '--dump', '--dump-format', 'json'],
      {
        cwd: path.dirname(justfilePath),
        timeout: 10000,
      },
    );
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed.recipes !== 'object' || parsed.recipes === null) {
      this.logger.warn(`[JustfileTaskProvider] just --dump returned unexpected JSON shape for ${justfilePath}`);
      return null;
    }
    return parsed as JustfileJsonOutput;
  } catch (err) {
    this.logger.warn(
      `[JustfileTaskProvider] Could not run just --dump for ${justfilePath}. ` +
      'Tasks from this justfile will not be shown. Ensure just is installed and ' +
      'applicationPath.just is configured correctly if needed.',
      err,
    );
    return null;
  }
}
```

#### 1d. Add `findRecipeLineNumber()` helper

```typescript
private findRecipeLineNumber(lines: string[], recipeName: string): number {
  const escaped = recipeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^@?${escaped}(?:\\s|:|$)`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return 0;
}
```

#### 1e. Add `getRecipeGroup()` helper

Extracts the `[group('name')]` attribute value from a recipe's attributes array. Returns `null`
if no group attribute is present.

```typescript
private getRecipeGroup(recipe: JustRecipe): string | null {
  const groupAttr = recipe.attributes.find(
    (attr) => attr.name === 'group' && typeof attr.value === 'string',
  );
  return groupAttr?.value ?? null;
}
```

#### 1f. Rewrite `getTasks()`

```typescript
async getTasks(): Promise<TaskItem[]> {
  if (!this.enabled) { return []; }

  const tasks: TaskItem[] = [];
  const filesService = TaskFilesService.getInstance();
  const iconService = TaskIconService.getInstance();
  const configService = ConfigurationService.getInstance();
  const groupsEnabled = configService.get<boolean>('groups.justfile.enabled', false);
  const files = await filesService.findFiles([constants.GLOB_JUST]);

  for (const file of files) {
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const content = document.getText();
      const lines = content.split('\n');
      const fallback: vscode.Uri = vscode.Uri.file(
        path.join(path.dirname(file.fsPath || ''), 'justfile'),
      );
      const iconPath = iconService.getTaskIcon(this.type, fallback);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
      if (!workspaceFolder) { continue; }
      const justCmd = this.getCommand(workspaceFolder.uri);

      const jsonOutput = await this.getJustJsonOutput(file.fsPath, justCmd);
      if (!jsonOutput) {
        // Error already logged inside getJustJsonOutput; skip this file.
        continue;
      }

      const recipes = Object.values(jsonOutput.recipes);

      if (groupsEnabled) {
        // Build a map of group name → group TaskItem
        const groupItems = new Map<string, TaskItem>();

        for (const recipe of recipes) {
          const groupName = this.getRecipeGroup(recipe);
          const line = this.findRecipeLineNumber(lines, recipe.name);
          const item = this.createRecipeTaskItem(recipe, file, iconPath, line);

          if (groupName) {
            if (!groupItems.has(groupName)) {
              const groupItem = new TaskItem(
                groupName,
                vscode.TreeItemCollapsibleState.Collapsed,
                'justfile',
                file,
                undefined,
                iconPath,
              );
              groupItem.metadata = { type: 'group', groupName };
              groupItem.children = [];
              groupItems.set(groupName, groupItem);
            }
            const groupItem = groupItems.get(groupName)!;
            item.parent = groupItem;
            groupItem.children!.push(item);
          } else {
            // Ungrouped recipes appear at the top level
            tasks.push(item);
          }
        }

        // Append all group items after the ungrouped recipes
        for (const groupItem of groupItems.values()) {
          tasks.push(groupItem);
        }
      } else {
        // Flat list (groups disabled)
        for (const recipe of recipes) {
          const line = this.findRecipeLineNumber(lines, recipe.name);
          tasks.push(this.createRecipeTaskItem(recipe, file, iconPath, line));
        }
      }
    } catch (e) {
      this.logger.error(`[JustfileTaskProvider] Error processing justfile: ${file.fsPath}`, e);
    }
  }
  return tasks;
}
```

#### 1g. Extract `createRecipeTaskItem()` helper

Factors out the repeated task-item construction:

```typescript
private createRecipeTaskItem(
  recipe: JustRecipe,
  file: vscode.Uri,
  iconPath: unknown,
  line: number,
): TaskItem {
  const item = new TaskItem(
    recipe.name,
    vscode.TreeItemCollapsibleState.None,
    this.type,
    file,
    undefined,
    iconPath,
  );
  item.taskFileUri = file;
  item.description = vscode.workspace.asRelativePath(file);
  item.startLine = line;
  if (recipe.doc) {
    item.tooltip = recipe.doc;
  }
  item.onOpenActionCommand = {
    command: 'workspaceTasks.openFileAtLine',
    title: 'Open File',
    arguments: [file, line],
  };
  return item;
}
```

#### 1h. Update `taskItem.ts` `updateContextValue()`

Add justfile group recognition following the same pattern as `isBitbucketFileGroup`:

```typescript
const isJustfileGroup = this.taskType === 'justfile' && this.metadata?.type === 'group';
```

And include `isJustfileGroup` in the group-node conditional so the item gets
`contextValue = 'justfileGroup'` (no action buttons) instead of being treated as a task leaf.

---

### Phase 2 — Update Tests (`src/test/suite/justfile.test.ts`)

The existing tests mock `vscode.workspace.openTextDocument` but NOT `execFile`. With the new
implementation, `execFile` is called first. Tests must be updated to mock the JSON execution path.

#### 2a. Mock `execFileAsync` via class property override

Because `execFileAsync` is a protected class property, tests override it directly on the provider
instance — no module patching needed:

```typescript
// In setup:
provider = new JustfileTaskProvider();
// Default: simulate just not found (no tasks returned for that file)
(provider as any).execFileAsync = async () => { throw new Error('just not found'); };
```

Note: with no fallback, the default mock means no tasks are returned for any file. Each test must
explicitly set up the JSON mock to get tasks.

#### 2b. Helper to mock successful JSON output

```typescript
function mockJustDump(provider: JustfileTaskProvider, recipes: Record<string, Partial<JustRecipe>>): void {
  const output = {
    first: Object.keys(recipes)[0] ?? '',
    recipes: Object.fromEntries(
      Object.entries(recipes).map(([name, r]) => [
        name,
        { name, doc: null, parameters: [], private: false, quiet: false, body: [],
          dependencies: [], attributes: [], shebang: false, priors: 0, ...r }
      ])
    ),
    settings: {},
    variables: {},
  };
  (provider as any).execFileAsync = async () => ({ stdout: JSON.stringify(output), stderr: '' });
}
```

#### 2c. New test suite: JSON path

Add a new `suite('uses just --dump when available', ...)` with tests:

- `parses recipes from JSON output` — returns tasks matching the recipe names in JSON
- `populates tooltip from doc comment` — task tooltip set when `doc` is non-null
- `does not include variables from JSON` — only `recipes` keys are used
- `returns no tasks when just --dump fails` — execFileAsync throws, file is skipped, array is empty
- `returns no tasks when JSON is malformed` — execFileAsync returns invalid JSON, file is skipped
- `returns no tasks when JSON shape is invalid` — missing `recipes` key, file is skipped

#### 2d. New test suite: groups

Add a `suite('justfile recipe groups', ...)` with tests:

- `groups disabled: all recipes returned flat` — recipes with group attr are in flat list
- `groups enabled: recipes with [group()] placed under group items` — returns group TaskItems with
  children containing the grouped recipes; ungrouped recipes remain at top level
- `groups enabled: ungrouped recipes coexist with group items` — mixed justfile with some grouped,
  some ungrouped
- `groups enabled: group item has justfile icon and no command` — no runnable command on group node
- `groups enabled: recipes with no group attribute are not nested` — recipe with empty attributes
  appears in flat list
- `getRecipeGroup returns null for empty attributes` — unit test of the helper
- `getRecipeGroup returns group name from attribute` — unit test of the helper

#### 2e. Update existing tests

Existing tests exercised the old regex path. They must be updated to set up the `execFileAsync`
mock (via `mockJustDump`) to return the expected recipes so they exercise the new JSON path.

---

### Phase 3 — Unit Tests for Helper Methods

Tests for `getJustJsonOutput`, `findRecipeLineNumber`, `getRecipeGroup`, and `createRecipeTaskItem`
as unit tests using the extracted private methods (accessed via `(provider as any).methodName()`)
are added as additional `suite()` blocks within the existing `justfile.test.ts`.

---

### Phase 4 — Configuration Setting

**Files changed:** `package.json`, `package.nls.json`

Add the following to the **Display** configuration section in `package.json` (the section with
title `%config.group.display.title%`):

```json
"workspaceTasks.groups.justfile.enabled": {
  "title": "%config.workspaceTasks.groups.justfile.enabled%",
  "type": "boolean",
  "default": false,
  "description": "%config.workspaceTasks.groups.justfile.enabled.description%",
  "markdownDescription": "%config.workspaceTasks.groups.justfile.enabled.markdown%"
}
```

Add the corresponding string keys to `package.nls.json`:

```json
"config.workspaceTasks.groups.justfile.enabled": "Enable justfile recipe groups",
"config.workspaceTasks.groups.justfile.enabled.description": "When enabled, justfile recipes decorated with [group('name')] are shown as collapsible group nodes in the task tree.",
"config.workspaceTasks.groups.justfile.enabled.markdown": "When enabled, justfile recipes decorated with `[group('name')]` are shown as collapsible group nodes in the task tree. Requires just \u2265 1.13.0. Defaults to `false`."
```

---

### Phase 5 — Update Sample Justfile

`sample/sample-workspace-tasks/justfile/justfile` currently triggers the bug. Add a comment
documenting that this file previously exposed the parsing bug (optional).

---

### Phase 6 — Documentation

**Files changed:** `docs/task-types/task-runners/` (new `just.md` or update `index.md`)

Add a section documenting:
- The `just` task type and supported justfile names
- The `applicationPath.just` setting
- That the provider uses `just --dump --dump-format json` for reliable recipe discovery (since just ≥ 0.10.4, stable ≥ 1.15.0)
- Behaviour when `just` is not installed or fails (output channel log, no tasks shown)
- The `workspaceTasks.groups.justfile.enabled` setting and `[group()]` attribute (requires just ≥ 1.13.0)

---

## Files Modified / Created

| File | Change |
|------|--------|
| `src/providers/justfileTaskProvider.ts` | Major refactor: JSON-only path, no regex fallback, groups support, `protected execFileAsync`, workspace folder guard |
| `src/taskItem.ts` | Add `isJustfileGroup` recognition in `updateContextValue()` |
| `src/test/suite/justfile.test.ts` | Rewrite existing tests for JSON path, add groups test suite, add helper unit tests |
| `package.json` | Add `workspaceTasks.groups.justfile.enabled` to Display settings group |
| `package.nls.json` | Add NLS strings for the new setting |
| `docs/task-types/task-runners/just.md` | New documentation |
| `README.md` | Note improved just recipe discovery |

---

## Test Coverage Goals

- All new methods (`getJustJsonOutput`, `findRecipeLineNumber`, `getRecipeGroup`, `createRecipeTaskItem`) reach 100% coverage
- Groups enabled/disabled paths both covered
- Error/skip path (just not available) covered
- Malformed JSON, timeout, empty recipe list all covered

---

## Out of Scope

- Supporting `just` modules/submodules (`mod` statements — recipes from sub-modules are not
  currently navigated to; this remains an existing limitation)
- Changing the task execution command format (still `just --justfile <path> <recipe>`)
- The `--json` flag shorthand was added in `just` 1.48.0 (March 2026). The plan uses
  `--dump --dump-format json` which is supported since 0.10.4 (November 2021) and has a stable
  output format since 1.15.0 (October 2023).
- Providing a regex-based fallback for users without `just` installed.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `just` binary not on PATH in VS Code environment | Log warning to output channel; no tasks shown for that justfile (user cannot run them anyway) |
| `just --dump` fails for a syntactically invalid justfile | Catch error, log warning, skip file |
| Very large justfiles with many recipes | 10-second timeout on `execFile`; timeout error is caught and logged |
| Line number resolution finds wrong line (e.g. a comment with the same name) | Pattern anchors to column 0 and requires a word boundary or `:` after the name, minimizing false matches |
| `[group()]` attribute shape differs between just versions | `getRecipeGroup` checks `attr.name === 'group' && typeof attr.value === 'string'`; missing/wrong shape silently returns `null` (recipe shown ungrouped) |
| just < 1.13.0 produces no group attributes | `attributes` array is empty; all recipes shown ungrouped regardless of `groups.justfile.enabled` |

---

## Review Notes

The following issues were identified during rubber duck review and have been incorporated into the plan above:

### Critical Issues Found and Fixed

**1. `--json` flag requires just ≥ 1.48.0 (March 2026) — nearly all current users would silently fall back to the broken regex**

The `--json` shorthand was added in just 1.48.0 (March 2026). Any user on just 1.15.0–1.47.x
(the vast majority) would hit the regex fallback on every invocation, defeating the purpose of the
change. The Background section incorrectly stated "Since just 0.10.4 this flag has been available"
— that is the `--dump-format json` flag, not `--json`.

**Fix applied:** Replaced `--json` with `--dump --dump-format json` throughout. This has been
available since just 0.10.4 (Nov 2021) and the format was stabilized in 1.15.0 (Oct 2023).

```typescript
['--justfile', justfilePath, '--dump', '--dump-format', 'json']
```

**2. Module-level `execFileAsync` prevents test mocking**

The plan initially proposed `const execFileAsync = promisify(execFile)` at module level (as in
`rakeTaskProvider.ts`). This is captured by value at import time — patching
`child_process.execFile` afterwards has no effect, and the happy-path (JSON) tests would be
unmockable. This is exactly why the rake tests only test the failure path.

**Fix applied:** `execFileAsync` is defined as an overrideable protected class property:

```typescript
protected execFileAsync = promisify(execFile);
```

Tests override it directly: `(provider as any).execFileAsync = async () => ({ stdout: ... })`.

### Major Issues Found and Fixed

**3. Malformed JSON bypassed the regex fallback**

`JSON.parse` exceptions were caught inside `getJustJsonOutput`, but a structurally valid JSON
object missing the `recipes` key would cause `Object.values(jsonOutput.recipes)` to throw in the
outer try/catch in `getTasks()`, returning no tasks (not falling back to regex).

**Fix applied:** Added shape validation inside `getJustJsonOutput` before returning.

**4. Missing `getWorkspaceFolder` guard**

The plan called `this.getCommand(file)` passing the justfile URI directly. The `RakeTaskProvider`
pattern uses `vscode.workspace.getWorkspaceFolder(file)` first to get the workspace folder URI,
which is what `ExecutableService` uses to resolve workspace-folder-relative settings. Without this
guard, justfiles outside the workspace would silently get wrong settings.

**Fix applied:** Added workspace folder guard following the rake pattern.

**5. Two test files for one provider**

The plan proposed splitting tests into `justfile.test.ts` and `justfileJson.test.ts`. This
diverges from the established convention (one test file per provider) and creates confusion.

**Fix applied:** All tests consolidated into `justfile.test.ts`.

### Minor Issues Found and Fixed

**6. Incomplete regex escaping in `findRecipeLineNumber`**

`recipeName.replace(/[-]/g, '\\$&')` only escapes `-` (which doesn't need escaping outside
character classes). Replaced with a complete metacharacter escape:
```typescript
recipeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
```

**7. `stderr` silently discarded**

Added debug-level logging of `just --dump` stderr to aid troubleshooting:
```typescript
if (stderr) { this.logger.debug(`[JustfileTaskProvider] just --dump stderr: ${stderr}`); }
```

**8. `README.md` missing from updated files list**

Added `README.md` to the Files Modified table.

### Items Confirmed as Non-Issues

- **Windows path handling**: `path.dirname` and Node.js `execFile`'s `cwd` handle OS-native
  separators transparently.
- **`just --dump` evaluating backtick expressions**: `just --dump --dump-format json` produces
  a static AST dump and does NOT evaluate backtick expressions. The risk table entry was removed.

---

## Revised Files Modified / Created

| File | Change |
|------|--------|
| `src/providers/justfileTaskProvider.ts` | Major refactor: JSON-only path, no regex fallback, groups support, `protected execFileAsync`, workspace folder guard |
| `src/taskItem.ts` | Add `isJustfileGroup` recognition in `updateContextValue()` |
| `src/test/suite/justfile.test.ts` | Rewrite existing tests for JSON path, add groups test suite, add helper unit tests |
| `package.json` | Add `workspaceTasks.groups.justfile.enabled` to Display settings group |
| `package.nls.json` | Add NLS strings for the new setting |
| `docs/task-types/task-runners/just.md` | New documentation |
| `README.md` | Update to note improved just recipe discovery |
