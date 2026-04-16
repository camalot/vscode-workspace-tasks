# Plan: Run-with-Args Positional Placeholder (`${args}`) with VS Code Context Token Support

## TL;DR

Extend "Run with Args" so that custom task commands in `.workspace-tasks.json` can contain an
`${args}` placeholder to inject user-supplied arguments at an **arbitrary position** rather than
always appending them at the end. Additionally, support a standard set of VS Code context
variable tokens (`${workspaceFolder}`, `${file}`, `${fileBasename}`, etc.) in command strings,
evaluated at task execution time so that commands adapt to the active editor context without
requiring `.workspace-tasks.json` input prompts for common path values.

---

## Background

### Current arg-appending behaviour

`_buildTask` in `taskFactory.ts` follows two code paths for workspace tasks:

**Path 1 — workspace-task (`item.taskSource` present):**
```typescript
const fullCommand = args ? `${declared} ${args}` : declared;
```
Args are always appended after the resolved command string.

**Path 2 — built-in type switch (e.g. `npm`, `shell`, etc.):**
```typescript
const typeArgs = initialArgs ? [...initialArgs] : [];
typeArgs.push('run', taskLabel);
if (args) {
  typeArgs.push(...args.split(' ')); // naive split, no quoting
}
```
Again, args always come last.

### Template token precedent

`WorkspaceTasksService.resolveTaskCommand()` already substitutes `{{ .FileName }}` and prompts for
arbitrary `{{ .VarName }}` inputs defined in `inputs[]`. The extension therefore already has a
template-substitution step in the command pipeline — this plan extends it.

---

## Requirements

1. When a command string in `.workspace-tasks.json` contains `${args}`, replace it with the
   user-supplied argument string at execution time. Multiple occurrences of `${args}` are all
   replaced.
2. If `${args}` is absent, fall back to appending arguments at the end of the command
   (backwards-compatible — existing tasks are unaffected).
3. A set of **VS Code context variable tokens** are evaluated at task execution time and
   substituted into the command before `${args}` substitution:

   | Token | Value |
   |-------|-------|
   | `${workspaceFolder}` | Absolute path of the workspace folder associated with the task source file (via `vscode.workspace.getWorkspaceFolder(resourceUri)?.uri.fsPath`; `''` if not found) |
   | `${workspaceFolderBasename}` | Base name of that workspace folder |
   | `${file}` | Absolute path of the currently active text editor document (`''` if no text editor is focused — see note below) |
   | `${fileBasename}` | File name with extension of the active file |
   | `${fileDirname}` | Directory of the active file |
   | `${fileExtname}` | Extension including the leading dot |
   | `${fileBasenameNoExtension}` | File name without extension |
   | `${env.VAR}` | Value of `process.env.VAR` at execution time (empty string if absent) |
   | `${pathSeparator}` | OS path separator (`/` or `\`) |

   > **Note on `${file}` and related tokens:** These are read from
   > `vscode.window.activeTextEditor?.document.uri.fsPath` at task execution time. When a
   > terminal or the task tree panel has focus, `activeTextEditor` may be `undefined` and all
   > file-based tokens resolve to `''`. Commands relying on these tokens should only be used
   > when the user has an editor document focused.
   >
   > **`${cwd}` is intentionally excluded.** Its value is ambiguous in workspace-task context
   > (directory of the config file vs. runtime working directory) and it is not a standard VS
   > Code predefined variable. Use `${workspaceFolder}` instead.
   >
   > **Multi-root workspaces:** `${workspaceFolder}` resolves to the workspace folder that
   > _contains the task source file_ (`vscode.workspace.getWorkspaceFolder(resourceUri)`).
   > If the source file is not inside any workspace folder, the result is `''`.

4. Context tokens are evaluated for **workspace tasks only** (`.workspace-tasks.json` sourced
   tasks). Built-in type tasks (npm, shell, etc.) are out of scope.
5. An unrecognised `${...}` token is left as-is (no error, no substitution) so that shell
   variable syntax like `${HOME}` still works when passed through to the shell.
6. The `${args}` token appears in IntelliSense completions in the JSON schema.
7. 100% test coverage for all new code.

---

## Key Design Decisions

### Shared context token resolver module

Context token resolution is extracted into a **new shared library** at
`src/libs/contextTokenResolver.ts` (pure exported functions; no VS Code API calls inside the
functions themselves — context values are passed as parameters). This achieves two goals:

1. **Testability:** A private class method cannot be imported into test files. Module-level
   exports can be tested directly.
2. **Reuse:** The Env Var Interpolation plan (Idea 7) needs identical token resolution for env
   values. A single implementation prevents the two features from diverging.

`WorkspaceTasksService.resolveTaskCommand()` imports and calls `resolveContextTokens` from this
shared module.

### Substitution order

1. Resolve VS Code context tokens via `resolveContextTokens` (shared module).
2. Resolve `{{ .FileName }}` and user input prompts (existing logic — unchanged).
3. Inject `args` via `${args}` placeholder or append-fallback.

When a command contains both `${workspaceFolder}` and `{{ .FileName }}`, context tokens (step 1)
are resolved first. Step 3 is always last so user-supplied arguments are never re-processed.

### `${args}` substitution happens in `_buildTask` (not in `resolveTaskCommand`)

`resolveTaskCommand` returns the fully resolved command string (minus args). The `${args}`
substitution happens immediately after in `_buildTask`, where `args` is available. This keeps
`resolveTaskCommand` pure (testable without args).

### `${env.VAR}` uses `process.env` only

Shell-level `$VAR` references are left to the shell. `${env.VAR}` in the command string is
resolved to `process.env.VAR ?? ''` at task-build time — giving users predictable, inspectable
values without shell dependency.

### Unrecognised tokens are preserved

Only known token names are matched and replaced. Unrecognised `${...}` patterns pass through
unchanged, preserving shell variable syntax. Nested tokens like `${env.${workspaceFolder}}`
are matched by the `${env.` regex to the first `}`, producing a process.env lookup for the key
`${workspaceFolder` (absent → `''`). This is not a crash; no special handling is required.

### Shell injection surface

User-supplied arguments injected via `${args}` or the append fallback are passed verbatim to
the shell — the same risk surface as today. Documentation must advise against embedding
`${args}` inside shell-quoted contexts (e.g., `python "${args}"`). No mitigation is applied
at the extension level (shell quoting is the user's responsibility, same as today).

---

## Implementation

### Phase 1: Shared context token resolver

**New file: `src/libs/contextTokenResolver.ts`**

Pure exported functions — no internal VS Code API calls; context is passed as a parameter:

```typescript
export interface ContextTokenResolutionContext {
  workspaceFolder: string;          // abs path; '' if not found
  workspaceFolderBasename: string;  // path.basename(workspaceFolder); '' if workspaceFolder is ''
  activeFile: string;               // '' if no active text editor
  processEnv: Record<string, string | undefined>; // process.env (or injectable for tests)
}

/**
 * Builds a ContextTokenResolutionContext from live VS Code state at call time.
 * Reads vscode.workspace.getWorkspaceFolder(resourceUri) and
 * vscode.window.activeTextEditor?.document.uri.fsPath.
 */
export function buildContextFromVscode(resourceUri: vscode.Uri): ContextTokenResolutionContext;

/**
 * Replaces known ${...} context tokens in `value`.
 * Unknown tokens (including ${SOMETHING_ELSE} and shell syntax $VAR) are preserved.
 */
export function resolveContextTokens(
  value: string,
  ctx: ContextTokenResolutionContext,
): string;
```

Substitution map inside `resolveContextTokens`:
- `${workspaceFolder}` → `ctx.workspaceFolder`
- `${workspaceFolderBasename}` → `ctx.workspaceFolderBasename`
- `${file}` → `ctx.activeFile`
- `${fileBasename}` → `ctx.activeFile ? path.basename(ctx.activeFile) : ''`
- `${fileDirname}` → `ctx.activeFile ? path.dirname(ctx.activeFile) : ''`
- `${fileExtname}` → `ctx.activeFile ? path.extname(ctx.activeFile) : ''`
- `${fileBasenameNoExtension}` → `ctx.activeFile ? path.basename(ctx.activeFile, path.extname(ctx.activeFile)) : ''`
- `${pathSeparator}` → `path.sep`
- `${env.VAR}` → regex `/\$\{env\.([^}]+)\}/g` → `ctx.processEnv[match[1]] ?? ''`

All known tokens are replaced via `replaceAll` (using a function callback to avoid JS `$`
replacement special characters). Unknown `${...}` patterns are not matched.

**File: `src/services/workspaceTasksService.ts`**

In `resolveTaskCommand()`, at the very start of the method body (before `{{ .FileName }}`):
```typescript
import { buildContextFromVscode, resolveContextTokens } from '../libs/contextTokenResolver';
// ...
command = resolveContextTokens(command, buildContextFromVscode(resourceUri));
```

### Phase 2: `${args}` substitution in `_buildTask`

**File: `src/taskFactory.ts`**

1. Add a module-level utility function `injectArgs(command: string, args: string | undefined): string`:

   ```
   injectArgs(command, args):
     if args is undefined or empty → return command unchanged
     if command contains '${args}' → return command.replaceAll('${args}', args)
     else → return command + ' ' + args   // backwards-compatible append
   ```

   > **Implementation note:** Do NOT use `String.prototype.replace(pattern, replacement)` with a
   > string literal replacement containing `$` — JavaScript treats `$` specially in replace
   > replacement strings. Use `replaceAll` with a function callback:
   > `command.replaceAll('${args}', () => args)`.

2. In `_buildTask`, replace:
   ```typescript
   const fullCommand = args ? `${declared} ${args}` : declared;
   ```
   With:
   ```typescript
   const fullCommand = injectArgs(declared, args);
   ```

### Phase 3: Schema update

**File: `res/schemas/workspace-tasks.schema.json`**

Update the `command` property's `description` field to list the supported tokens:
`${args}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${file}`, `${fileBasename}`,
`${fileDirname}`, `${fileExtname}`, `${fileBasenameNoExtension}`, `${pathSeparator}`, and
`${env.VAR}`. Note that `${cwd}` is **not** listed.

### Phase 4: Documentation

**File: `docs/features/running-tasks.md`**

1. Add a section "Positional Argument Placeholder" explaining `${args}` with a Docker example.

**File: `docs/configuration/task-type.md`** (or equivalent `.workspace-tasks.json` reference)

1. Document all supported context tokens with their values in a table.

---

## Test Plan

**Target: 100% coverage of all new code in `workspaceTasksService.ts` and `taskFactory.ts`.**

### New test file: `src/test/suite/contextTokenResolver.test.ts`

Tests import directly from `src/libs/contextTokenResolver.ts` (no private method access needed).

| Test | Assertion |
|------|-----------|
| `${workspaceFolder}` → ctx.workspaceFolder | substituted |
| `${workspaceFolderBasename}` → ctx.workspaceFolderBasename | substituted |
| `${file}` → ctx.activeFile | substituted |
| `${file}` with `activeFile = ''` → resolves to `''` (not a crash) | empty-file path |
| `${fileBasename}` with non-empty activeFile | correct |
| `${fileBasename}` with `activeFile = ''` → `''` (not `'.'`) | edge case |
| `${fileDirname}`, `${fileExtname}`, `${fileBasenameNoExtension}` — each token | each correct |
| `${pathSeparator}` returns `path.sep` (mock for cross-platform) | correct |
| `${env.KNOWN_VAR}` → ctx.processEnv value | substituted |
| `${env.UNKNOWN_VAR}` (absent from processEnv) → `''` | no error |
| `${env.${workspaceFolder}}` nested-looking token → resolves to `''` (no crash) | graceful |
| Unrecognised `${SOMETHING_ELSE}` → preserved as-is | not touched |
| Shell syntax `$VAR` (no braces) → preserved as-is | not matched |
| Multiple different tokens in one string → all replaced | all |
| No tokens in string → returned unchanged | identity |
| `${workspaceFolder}` when `ctx.workspaceFolder = ''` → result contains `''` | '' fallback |
| `buildContextFromVscode` with `activeTextEditor = undefined` → `activeFile = ''` | no crash |
| `buildContextFromVscode` with active editor → `activeFile` = document fsPath | reads editor |

### New test file: `src/test/suite/injectArgs.test.ts`

| Test | Assertion |
|------|-----------|
| Command with `${args}` — args supplied → placeholder replaced | correct |
| Command with multiple `${args}` occurrences — all replaced | all occurrences |
| Command without `${args}` — args supplied → appended with space | backwards-compatible |
| Command without `${args}` — args `undefined` → command unchanged | no modification |
| Command without `${args}` — args `''` (empty string) → command unchanged (no trailing space) | edge case |
| args value containing `$&` → value preserved verbatim (callback avoids JS replace pitfall) | `$` special chars |
| args value containing `$$` → value preserved verbatim | `$` special chars |
| `${args}` at start of command string | position |
| `${args}` at end of command string | position |
| `${args}` in middle of command string | position |

### Updates to existing tests

**`src/test/suite/workspaceTasksService.test.ts`**:

1. `resolveTaskCommand` with `${workspaceFolder}` in command → resolved before `{{ .FileName }}`.
2. `resolveTaskCommand` with `${env.KNOWN_VAR}` → value substituted from processEnv.
3. `resolveTaskCommand` with unrecognised token → preserved unchanged.

**`src/test/suite/taskFactory*.test.ts`** (workspace-task path):

1. `createTaskForItem` for workspace task with `${args}` in command → placeholder replaced in
   resulting `ShellExecution.commandLine`.
2. `createTaskForItem` for workspace task without `${args}` → args appended (existing behaviour).
3. `createTaskForItem` for workspace task, args `= undefined` → command unchanged.

---

## Checklist

- [ ] `src/libs/contextTokenResolver.ts` created with `ContextTokenResolutionContext`, `buildContextFromVscode()`, `resolveContextTokens()`
- [ ] `WorkspaceTasksService.resolveTaskCommand()` updated to call `resolveContextTokens` before `{{ .FileName }}`
- [ ] `injectArgs()` utility added to `taskFactory.ts`
- [ ] `_buildTask` workspace-task path updated to use `injectArgs()`
- [ ] Schema `command` property description updated (no `${cwd}`)
- [ ] `src/test/suite/contextTokenResolver.test.ts` created (100% coverage)
- [ ] `src/test/suite/injectArgs.test.ts` created (100% coverage)
- [ ] Existing task factory and `workspaceTasksService` tests updated
- [ ] `docs/features/running-tasks.md` updated
- [ ] `.workspace-tasks.json` reference documentation updated

## Post-Review Notes

- `${cwd}` was **removed** from the token set. Its value is ambiguous in workspace-task context
  and it is not a standard VS Code predefined variable.
- Context token resolution is extracted to `src/libs/contextTokenResolver.ts` — not a private
  method — to enable isolated testing and reuse by the Env Var Interpolation plan (Idea 7).
- `${file}` and related tokens resolve to `''` when `activeTextEditor` is `undefined`. This
  is documented as a known limitation, not an error.
- Shell injection via `${args}` is an accepted surface (same risk as today's append behavior).
  No server-side quoting or sanitization is applied.
