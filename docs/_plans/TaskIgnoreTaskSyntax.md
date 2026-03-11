# Task-Level `.tasksignore` Syntax — Implementation Plan

## Overview

`.tasksignore` currently operates at **file granularity**: if a file path matches a rule, every task discovered from that file is excluded. This document defines the design and implementation plan for extending `.tasksignore` to support **task-level granularity** using a `filepath@taskname` syntax.

---

## Proposed Syntax

The `@` character is used as a separator between the file-glob portion and the task-name portion of a rule. The leading `!` negation from standard gitignore syntax is retained.

### Rule Forms

| Rule | Meaning |
| ------ | --------- |
| `package.json` | Ignore all tasks from any `package.json` (existing behavior, unchanged) |
| `package.json@release` | Ignore **only** the `release` task from `package.json` |
| `!package.json@release` | **Re-include** the `release` task from `package.json` (negation; typically used after a file-wide ignore rule) |
| `scripts/build.sh@*` | Ignore all tasks whose names match `*` (any name) from `scripts/build.sh` (equivalent to the file-only form) |

### Interaction with File-Level Rules

Rules are evaluated in the order they appear in the file, matching gitignore semantics:

```ignore
# Hide every task from package.json …
package.json
# … but let the release task through
!package.json@release
```

```ignore
# Hide only the release task; everything else from package.json is visible
package.json@release
```

```ignore
# Hide all tasks from the scripts directory …
scripts/
# … except the deploy task from scripts/deploy.sh
!scripts/deploy.sh@deploy
```

### Task Name Matching Rules

- Task names are **case-sensitive** (reflecting how names appear in the source file).
- Only **exact name matching** is supported in the initial implementation. Glob/wildcard support for task names (`package.json@build:*`) is a future enhancement.
- Whitespace in task names is supported by specifying the name exactly as it appears (no quoting required; `@` is the only new reserved character).

---

## Affected Files

| File | Change Class | Summary |
| ------ | ------------- | --------- |
| `src/services/taskFilesService.ts` | **Core logic** | Parse `@` rules; new `shouldIgnoreTask()` method |
| `src/taskTreeDataProvider.ts` | **Filtering** | Apply task-level filter after task items are assembled |
| `src/services/taskCacheService.ts` | **Cache** | Pass task name through to filter check; invalidate on `.tasksignore` change (already wired) |
| `res/syntaxes/tasksignore.tmLanguage.json` | **Grammar** | Tokenize `filename@taskname` syntax |
| `res/syntaxes/tasksignore-language-configuration.json` | **Language** | No changes required |
| `docs/TasksIgnore.md` | **Documentation** | Document the new syntax with examples |
| `src/test/suite/taskFilesService.test.ts` | **Tests** | New test cases for `shouldIgnoreTask()` and parsing |

---

## Detailed Design

### 1. New Data Structures in `taskFilesService.ts`

#### `TaskIgnoreRule` interface

```ts
interface TaskIgnoreRule {
  /** The file-path glob portion (the part before `@`). */
  filePattern: string;
  /** The exact task name (the part after `@`). */
  taskName: string;
  /** True when the original line started with `!`. */
  negated: boolean;
}
```

#### Updated `IgnoreFile` interface

```ts
interface IgnoreFile {
  folderUri: vscode.Uri;
  /** Handles file-level ignore rules (no `@` syntax). Unchanged from today. */
  ig: ignore.Ignore;
  /** Handles task-level rules (`filepath@taskname`). */
  taskRules: TaskIgnoreRule[];
}
```

The `ignore` npm package is **not used** for task rules — it only understands file-path patterns, not the `@taskname` extension. Task rules are matched with `micromatch` (already a dependency) for the file portion and a string comparison for the task-name portion.

---

### 2. Rule Parsing in `loadIgnoreFile()` and `isIgnoredByDiskRules()`

#### Parsing Algorithm

Both `loadIgnoreFile()` (in-memory path) and `isIgnoredByDiskRules()` (disk read path) share a common line-parsing helper:

```ts
function parseIgnoreLines(lines: string[]): {
  fileRules: string[];
  taskRules: TaskIgnoreRule[];
} {
  const fileRules: string[] = [];
  const taskRules: TaskIgnoreRule[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    const negated = line.startsWith('!');
    const body = negated ? line.slice(1) : line;

    const atIndex = body.indexOf('@');
    if (atIndex === -1) {
      // Standard file-level rule — pass to the `ignore` package unchanged
      fileRules.push(line);
    } else {
      // Task-level rule: split on the first `@`
      const filePattern = body.slice(0, atIndex);
      const taskName = body.slice(atIndex + 1);
      if (filePattern && taskName) {
        taskRules.push({ filePattern, taskName, negated });
      } else {
        // Malformed rule (e.g. "@taskname" or "file@") — treat as a file-level rule
        // so the user gets visible feedback via gitignore matching failure rather than silence.
        fileRules.push(line);
      }
    }
  }

  return { fileRules, taskRules };
}
```

#### `loadIgnoreFile()` changes

```ts
// Before:
if (rules.length > 0) {
  const ig = ignore();
  ig.add(rules);
  this.ignoreFiles.push({ folderUri, ig });
}

// After:
const { fileRules, taskRules } = parseIgnoreLines(lines);
const ig = ignore();
if (fileRules.length > 0) {
  ig.add(fileRules);
}
this.ignoreFiles.push({ folderUri, ig, taskRules });
```

The `taskRules` array is stored even when empty so that `shouldIgnoreTask()` can iterate `ignoreFiles` without needing to null-check.

#### `isIgnoredByDiskRules()` changes

`isIgnoredByDiskRules()` performs an **on-disk traversal** used during cache builds and is the authoritative check for files not yet in the loaded `ignoreFiles` list. It must also be updated to parse and evaluate task rules.

The updated variant will:

1. Parse lines with the same `parseIgnoreLines()` helper.
2. Check the file portion via the `ignore` package (file rules) as before.
3. Return the resulting `taskRules` array to the caller via an extended return type, since the caller now needs to check task-level rules later.

Because `isIgnoredByDiskRules()` is currently called only during the **file-level** cache build (where task names are not yet known), the task rules extracted here must be stored and made accessible to `shouldIgnoreTask()`.

**Approach**: When `isIgnoredByDiskRules()` finds a `.tasksignore` file with task rules that are not yet in `ignoreFiles`, it should call `loadIgnoreFile()` to ensure the rules are loaded into memory. This is safe because the ignore files are already de-duplicated by folder path. After this, `shouldIgnoreTask()` can read from `ignoreFiles` in all cases.

---

### 3. New Public Method: `shouldIgnoreTask()`

```ts
/**
 * Returns true if the named task from the given file URI should be excluded
 * based on `.tasksignore` task-level rules.
 *
 * Evaluation order mirrors rule declaration order (last match wins), consistent
 * with gitignore semantics.
 *
 * @param fileUri  The URI of the file that contains the task.
 * @param taskName The exact task name as it appears in the source file.
 */
public shouldIgnoreTask(fileUri: vscode.Uri, taskName: string): boolean {
  const targetPath = this.normalizePathForComparison(fileUri.fsPath);

  // Collect applicable ignore files (same ancestor logic as shouldIgnore())
  const applicable = this.ignoreFiles.filter((ig) => {
    const ignoreFolder = this.normalizePathForComparison(ig.folderUri.fsPath);
    return targetPath !== ignoreFolder && targetPath.startsWith(`${ignoreFolder}${path.sep}`);
  });

  // Sort deepest first (same as shouldIgnore())
  applicable.sort((a, b) => b.folderUri.fsPath.length - a.folderUri.fsPath.length);

  let ignored = false;

  for (const ignoreFile of applicable) {
    const ignoreFolder = this.normalizePathForComparison(ignoreFile.folderUri.fsPath);
    const relativePath = targetPath.slice(ignoreFolder.length + 1).replace(/\\/g, '/');
    if (!relativePath) {
      continue;
    }

    for (const rule of ignoreFile.taskRules) {
      const fileMatches = micromatch.isMatch(relativePath, rule.filePattern, { dot: true });
      const taskMatches = rule.taskName === taskName; // exact match for v1

      if (fileMatches && taskMatches) {
        ignored = !rule.negated; // last matching rule wins
      }
    }
  }

  return ignored;
}
```

**Last-match-wins semantics**: The loop does not `break` early; every applicable rule is evaluated so that later negation rules override earlier ignore rules. This matches gitignore behavior.

---

### 4. Integrating Task-Level Filtering into the Tree

Task-level filtering must happen **after tasks are created** from discovered files, because the filter depends on the task name which is not known at file-discovery time.

The most suitable integration point is `TaskCacheService` (or equivalent), where all task items are aggregated before being stored.

#### Option A — `TaskCacheService.getTasks()` (preferred)

After each provider's `getTasks()` results are collected, apply a post-filter:

```ts
// In TaskCacheService or wherever tasks are aggregated after provider calls:
const raw = await provider.getTasks();
const filtered = raw.filter((item) => {
  if (!item.taskFileUri) {
    return true; // no file URI; can't match a task-level rule
  }
  return !TaskFilesService.getInstance().shouldIgnoreTask(item.taskFileUri, item.originalLabel || String(item.label));
});
```

This keeps filtering **centralized** and requires no changes to individual task providers.

#### Option B — Per-provider filtering

Each provider filters its own task list after assembly. This is more work (touches every provider) and fragments the filtering logic; not recommended.

#### Recommended: Option A in `TaskCacheService.refreshProvider()` / `refresh()`

The `TaskCacheService` already calls each provider's `getTasks()` and caches the results. A single filter step added there is the minimal, non-invasive change.

---

### 5. Grammar — `tasksignore.tmLanguage.json`

The grammar currently only highlights comment lines (`^\s*#.*`). The new task-level syntax needs an additional rule:

```json
{
  "name": "meta.task-rule.tasksignore",
  "match": "^(!?)([^@#\\s]+)(@)(.+)$",
  "captures": {
    "1": { "name": "keyword.operator.negation.tasksignore" },
    "2": { "name": "entity.name.tag.file-pattern.tasksignore" },
    "3": { "name": "punctuation.separator.tasksignore" },
    "4": { "name": "entity.name.function.task-name.tasksignore" }
  }
}
```

This tokenizes:

- `!` (if present) as a negation operator
- The file-pattern portion in a distinct scope
- `@` as a separator punctuation
- The task name as a function/identifier scope

The new rule must be listed **before** the fallback pattern-line rule so it takes priority.

---

### 6. Documentation — `docs/TasksIgnore.md`

A new section titled **"Task-Level Filtering"** should be added immediately after the existing "Pattern Syntax" table.

The section should cover:

- The `filepath@taskname` syntax and what it does
- How negation (`!file@task`) works in combination with file-level rules
- A table of rule forms with plain-English descriptions
- Two worked examples:
  1. Hide a single task while keeping the rest of the file visible
  2. Hide all tasks from a file but re-include one specific task

---

## Implementation Sequence

The tasks below are ordered with fewest dependencies first.

### Phase 1 — Core Parsing and In-Memory Filter

1. **Add `TaskIgnoreRule` interface** to `taskFilesService.ts`.
2. **Add `taskRules: TaskIgnoreRule[]` field** to the `IgnoreFile` interface.
3. **Extract `parseIgnoreLines()` helper** (handles splitting `@`, negation, malformed rules).
4. **Update `loadIgnoreFile()`** to call `parseIgnoreLines()` and populate `taskRules`.
5. **Update `isIgnoredByDiskRules()`** to call `parseIgnoreLines()` and — when task rules are found — call `loadIgnoreFile()` to ensure in-memory state is consistent.
6. **Add `shouldIgnoreTask()` public method**.

### Phase 2 — Wire Filtering into Task Assembly

1. **Add task-level filter step** in `TaskCacheService` (after each provider's `getTasks()` is called).

### Phase 3 — Grammar Update

1. **Update `tasksignore.tmLanguage.json`** to tokenize `filepath@taskname` rules.

### Phase 4 — Documentation

1. **Update `docs/TasksIgnore.md`** with the "Task-Level Filtering" section.

### Phase 5 — Tests

1. **Unit tests for `parseIgnoreLines()`**: plain rules passthrough, `@` splitting, negation, malformed edge cases.
2. **Unit tests for `shouldIgnoreTask()`**:
    - Rule matches file and task name → `true`
    - Rule matches file but not task name → `false`
    - Rule does not match file → `false`
    - Negation re-includes after file-level ignore → `false`
    - Last-match-wins: two rules for same file/task, last is negated → `false`
    - Nested `.tasksignore` files (deeper rule overrides shallower)
3. **Integration tests** — wire `shouldIgnoreTask()` through `TaskCacheService` and verify that tree items for ignored tasks are absent while non-ignored tasks remain.

---

## Edge Cases and Decisions

| Scenario | Decision |
| ---------- | --------- |
| `@taskname` (no file prefix) | Treated as a **malformed rule**; falls through to file-level processing (the `ignore` package will likely not match it, and the user gets no silent failure). A warning is logged. |
| `file@` (no task name) | Same as above — treated as malformed, logged, passed to `ignore` package as a file rule. |
| `file@@task` (double `@`) | First `@` is the separator; the rest (including the second `@`) becomes the task name. |
| Task name with spaces | Supported — the full string after the first `@` is the task name. |
| Glob in task name (`file@build:*`) | **Not supported in v1.** reserved as a future enhancement. The `*` is passed as a literal character; no tasks will match unless a task is actually named `build:*`. |
| File pattern with gitignore negation AND task negation (`!file@task`) | The leading `!` applies to the whole rule (negated=true in `TaskIgnoreRule`). A double-negation (`!!file`) is not possible with this syntax. |
| Multiple `@` characters in task name | All characters after the first `@` form the task name, preserving any additional `@` symbols. |
| Case sensitivity of task names | Task names are matched **case-sensitively** to preserve fidelity with how they appear in source files. |
| Task from workspace-level `tasks.json` | Tasks from `.vscode/tasks.json` also have a `taskFileUri`. The `@` syntax applies identically. |

---

## Out of Scope for This Feature

- Glob/wildcard matching in the task-name portion (e.g. `package.json@build:*`)
- Per-task visibility toggling via the UI "Hide Task" command (that uses `FilteredTaskService`, a separate system)
- Wildcard file patterns combined with task names from `.tasksignore` in non-workspace-relative paths

---

## Related Documents

- [TasksIgnore.md](TasksIgnore.md) — User-facing documentation for `.tasksignore`
- [TaskFiltering.md](TaskFiltering.md) — Documentation for the runtime "Hide Task" feature
- [FilesCacheImplementationPlan.md](FilesCacheImplementationPlan.md) — Background on the `TaskFilesService` cache design
