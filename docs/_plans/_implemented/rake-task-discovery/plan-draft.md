# Plan: Rake Task Discovery Fix (I13)

**Status:** Draft (pre rubber-duck review)
**Area:** Task Discovery / Rake provider

---

## 1. Overview

`RakeTaskProvider` attempts to enumerate tasks by invoking `rake --tasks --file <path>` via CLI. When `rake` is not in the PATH, or when `.rake` files have external dependencies that prevent standalone execution, task discovery silently fails and zero tasks are returned. No user-visible diagnostic is surfaced.

---

## 2. Root Cause Analysis

The `RakeTaskProvider.getTasks()` method:
1. Runs `rake --tasks --file <path>` for each discovered Rakefile/`.rake` file
2. Catches any `execFileAsync` error and `continue`s silently
3. Returns zero tasks for that file

Known failure modes:
1. **`rake` not in PATH** — ENOENT error; most common cause
2. **`.rake` files with external dependencies** — Many `.rake` files `require` other files (e.g., Rails environment) and fail when run in isolation
3. **Rake version differences** — Output format variations across Rake versions
4. **No static fallback** — There is no alternative parsing path when CLI fails

---

## 3. Proposed Fix

### 3.1 Add Static Parse Fallback

When the CLI invocation fails, fall back to parsing the file content with regex to extract task names. This handles the common case where tasks are defined with the standard `task :name` / `task 'name'` / `desc "..." task :name` pattern.

```typescript
private parseRakeFileFallback(content: string, fileUri: vscode.Uri): TaskItem[] {
  const tasks: TaskItem[] = [];
  const lines = content.split('\n');

  // Match: desc "description" (optional) followed by task :name or task 'name'
  const taskPattern = /^\s*task\s+[:'"]([^'"\s]+)['":]?/;
  let pendingDesc: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Capture desc comment for next task
    const descMatch = line.match(/^\s*desc\s+['"]([^'"]+)['"]/);
    if (descMatch) {
      pendingDesc = descMatch[1];
      continue;
    }

    const taskMatch = line.match(taskPattern);
    if (taskMatch) {
      const taskName = taskMatch[1];
      const item = this.createTaskItem(taskName, fileUri, i, pendingDesc);
      tasks.push(item);
      pendingDesc = undefined;
    } else {
      pendingDesc = undefined;
    }
  }

  return tasks;
}
```

### 3.2 Improve Error Logging

When the CLI invocation fails, log a more actionable message rather than just the raw error:

```typescript
} catch (error: any) {
  if (error?.code === 'ENOENT') {
    this.logger.warn(
      `[RakeTaskProvider] 'rake' executable not found in PATH for ${file.fsPath}. ` +
      `Falling back to static file parsing. Install rake or configure 'applicationPath.rake'.`
    );
  } else {
    this.logger.error(`[RakeTaskProvider] Failed to get tasks from ${file.fsPath}:`, error);
  }
  // Fall back to static parsing
  const content = await vscode.workspace.fs.readFile(file);
  const text = new TextDecoder().decode(content);
  const fallbackTasks = this.parseRakeFileFallback(text, file);
  tasks.push(...fallbackTasks);
}
```

### 3.3 Set `startLine` on All Items

Both CLI-parsed and statically-parsed items should have `startLine` set:
- CLI-parsed items: static parse for line numbers since the CLI output doesn't include them
- Statically-parsed items: use the line index directly

---

## 4. Limitations and Deferred Items

- **Namespace tasks** (e.g., `namespace :db do task :migrate end`): The static regex does not handle namespaces. These would be discovered as `:migrate` without namespace context. A more sophisticated parser could handle this in a follow-up.
- **`task :name => :deps` syntax**: The regex handles basic cases; dependency arrows may cause missed matches in complex task definitions. Known limitation for initial implementation.
- **Rails `Rakefile`**: Running `rake --tasks` on a full Rails Rakefile requires the Rails environment and cannot be done in isolation. The static parser would find standard tasks but not Rails-specific ones.

---

## 5. Implementation Plan

**Files:** `src/providers/rakeTaskProvider.ts`

1. Add `parseRakeFileFallback(content: string, fileUri: vscode.Uri): TaskItem[]` private method
2. In `getTasks()` catch block: replace silent skip with fallback parsing + improved warning
3. Set `item.startLine` on both CLI-discovered and fallback-discovered tasks
4. Create a private `createRakeTaskItem(name, fileUri, line, desc)` helper to avoid duplication

---

## 6. Testing Plan

**File:** `src/test/suite/rakeTaskProvider.test.ts` (create or update)

| Test | Description |
|---|---|
| T01 | `parseRakeFileFallback` correctly parses `task :build do` → task named `build` |
| T02 | `parseRakeFileFallback` captures `desc` comment for next task |
| T03 | `parseRakeFileFallback` handles `task 'name'` string syntax |
| T04 | `parseRakeFileFallback` sets correct `startLine` for each task |
| T05 | When CLI fails with ENOENT, fallback is used and tasks are returned |
| T06 | When CLI succeeds, CLI results are used (not fallback) |
| T07 | CLI failure is logged as a warning with actionable message |

---

## 7. Documentation Plan

No user-visible documentation changes required. The fix improves reliability of an existing feature.

---

## 8. Risks

- **False positives in static parse:** The regex may match `task` in comments or strings. Mitigation: ignore lines starting with `#`.
- **Namespace duplication:** Tasks in namespaces will be discovered without namespace prefix by static parser, which may differ from CLI output. Acceptable for initial fix; can be improved later.
