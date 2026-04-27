# Plan: Rake Task Discovery Fix (I13)

**Status:** Final (post rubber-duck review)
**Area:** Task Discovery / Rake provider

---

## 1. Rubber-Duck Review Summary

The draft proposed a static regex fallback parser as an equal alternative to the CLI. The sub-agent identified important corrections:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** Static regex fallback misses namespaces, dynamic definitions, imported tasks | High | Adopted — static fallback is explicitly "best-effort" and documented as such; CLI remains primary/authoritative |
| **C2** CLI startLine mapping: CLI output doesn't include line numbers | Medium | Adopted — static line-finding is only used after static parse; CLI-discovered tasks use text-search fallback for startLine |
| **C3** ENOENT warning should be one-time per workspace, not per-file per-refresh | Medium | Adopted — use a `_rakeNotFoundWarned` flag to emit the warning once per provider lifetime |
| **C4** CLI path should remain primary; trust-gating already exists | Low | Confirmed — existing `!vscode.workspace.isTrusted` guard is preserved |
| **C5** No tests for namespaced tasks, multiline definitions | Medium | Acknowledged — documented as known limitation; test plan updated |
| **C6** Divergence between CLI and static parse creates user confusion | Medium | Adopted — document that static fallback produces "best-effort" tasks; tasks discovered via static parse are labeled differently in tooltip |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Show static-fallback tasks differently (e.g., different icon) | Provider-level task metadata changes are out of scope for this fix; tooltip note is sufficient |
| Defer static parser to a separate enhancement | The static fallback directly resolves the "tasks not discovered when rake not in PATH" problem, which is the primary user-reported issue |

---

## 2. Root Cause Analysis

`RakeTaskProvider.getTasks()` fails silently when:
1. `rake` is not in PATH (ENOENT error) — most common
2. `.rake` files have external dependencies that fail when run in isolation
3. Rake outputs unexpected formats

No fallback exists; zero tasks are returned.

---

## 3. Proposed Fix

### 3.1 Static Parse Fallback (Best-Effort)

When CLI invocation fails, fall back to regex-based static parsing:

```typescript
private parseRakeFileFallback(content: string, fileUri: vscode.Uri): TaskItem[] {
  const tasks: TaskItem[] = [];
  const lines = content.split('\n');
  const iconPath = this.iconService.getTaskIcon(this.type);

  // Simple task pattern: task :name or task 'name' or task "name"
  // Optional desc on the preceding non-blank, non-comment line
  const taskPattern = /^\s*task\s+[:'""]?([A-Za-z0-9_:-]+)['":]?\s*/;
  let pendingDesc: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('#')) {
      pendingDesc = undefined;
      continue;
    }

    const descMatch = trimmed.match(/^desc\s+['"]([^'"]+)['"]/);
    if (descMatch) {
      pendingDesc = descMatch[1];
      continue;
    }

    const taskMatch = trimmed.match(taskPattern);
    if (taskMatch) {
      const taskName = taskMatch[1];
      const item = new TaskItem(
        taskName,
        vscode.TreeItemCollapsibleState.None,
        this.type,
        fileUri,
        undefined,
        iconPath,
      );
      item.taskFileUri = fileUri;
      item.startLine = i;
      item.description = vscode.workspace.asRelativePath(fileUri);
      item.tooltip = pendingDesc ? `${taskName}: ${pendingDesc} (static parse)` : `${taskName} (static parse)`;
      item.onOpenActionCommand = {
        command: 'workspaceTasks.openFileAtLine',
        title: 'Open File',
        arguments: [fileUri, i],
      };
      tasks.push(item);
      pendingDesc = undefined;
    } else if (trimmed.length > 0) {
      pendingDesc = undefined;
    }
  }

  return tasks;
}
```

### 3.2 One-Time ENOENT Warning

```typescript
private _rakeNotFoundWarned = false;

// In catch block:
if ((error as any)?.code === 'ENOENT' && !this._rakeNotFoundWarned) {
  this._rakeNotFoundWarned = true;
  this.logger.warn(
    `[RakeTaskProvider] 'rake' executable not found. ` +
    `Falling back to static file parsing. ` +
    `Install rake or configure 'applicationPath.rake' in settings.`
  );
}
```

### 3.3 `startLine` for CLI-Discovered Tasks

CLI-discovered tasks (from `rake --tasks`) do not include line numbers. Use the static `parseRakeFileFallback` to generate a name→line map, then annotate CLI-discovered items:

```typescript
const lineMap = this.buildTaskLineMap(textContent); // name → line index
// For each CLI-discovered task:
item.startLine = lineMap.get(taskName) ?? 0;
```

```typescript
private buildTaskLineMap(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = content.split('\n');
  const taskPattern = /^\s*task\s+[:'""]?([A-Za-z0-9_:-]+)['":]?\s*/;
  for (let i = 0; i < lines.length; i++) {
    const taskMatch = lines[i].trim().match(taskPattern);
    if (taskMatch) {
      map.set(taskMatch[1], i);
    }
  }
  return map;
}
```

---

## 4. Implementation

**File:** `src/providers/rakeTaskProvider.ts`

1. Add `private _rakeNotFoundWarned = false` field
2. Add `parseRakeFileFallback(content, fileUri)` method
3. Add `buildTaskLineMap(content)` method
4. In `getTasks()`, read file content before attempting CLI so it's available for fallback
5. In the `catch` block: log appropriately (ENOENT one-time warning vs. other errors), then call `parseRakeFileFallback`
6. For CLI-discovered tasks: call `buildTaskLineMap` and set `item.startLine`

---

## 5. Testing Plan

**File:** `src/test/suite/rakeTaskProvider.test.ts`

| Test | Description |
|---|---|
| T01 | `parseRakeFileFallback`: `task :build do` → task named `build` at correct line |
| T02 | `parseRakeFileFallback`: `desc "Run tests"` captures description for next task |
| T03 | `parseRakeFileFallback`: `task 'name'` string syntax parsed correctly |
| T04 | `parseRakeFileFallback`: comment lines (`# comment`) are skipped |
| T05 | `parseRakeFileFallback`: sets `item.startLine` to 0-based line index |
| T06 | When CLI throws ENOENT, fallback tasks are returned |
| T07 | ENOENT warning is logged only once (first failure, not on every subsequent file) |
| T08 | When CLI succeeds, CLI results are used and fallback is not called |
| T09 | `buildTaskLineMap`: returns correct name→line mapping |

**Known limitation (documented, not tested):** Namespaced tasks (`namespace :db do task :migrate end`) are not parsed by the static fallback.

---

## 6. Documentation Plan

No user-visible documentation changes required. Rake task discovery improvement is an internal reliability fix.

---

## 7. Risks

- **False positives:** The regex may match `task` in strings or DSL-style code. Lines starting with `#` are excluded. Acceptable false positive rate for initial implementation.
- **Namespace omission:** Static parser does not produce `namespace:task` qualified names. CLI path handles namespaced tasks correctly when available.
- **`_rakeNotFoundWarned` across multiple workspace folders:** The flag is per-provider-instance. For multi-root workspaces, a warning is emitted once per provider lifetime (acceptable).
