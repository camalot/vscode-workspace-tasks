---
title: '[Bug]: shell task falls through to workspace root path when no file URI is set'
labels: ['bug', 'needs-triage']
---

## Bug Description

In `taskFactory.ts`, the `shell` (and `msbuild`) switch cases contain a dead guard `if (!resourceUri) return undefined`. This guard can never be reached because `resourceUri` is unconditionally assigned earlier as:

```typescript
const resourceUri = effectiveResourceUri ?? fallbackWorkspaceUri;
```

`fallbackWorkspaceUri` is always defined (either from `workspaceFolders[0]` or `vscode.Uri.file(cwd)`), so `resourceUri` is never `null` or `undefined`.

As a consequence, when both `item.taskFileUri` and `item.resourceUri` are undefined (e.g., a shell task with no associated file), the guard does not short-circuit. The code proceeds with `resourceUri = fallbackWorkspaceUri`, which is the workspace root folder URI. The shell task then attempts to execute the workspace root directory as if it were a shell script:

```
"/path/to/workspace"  ← not a script
```

This causes a runtime failure (permission error or "not a file" error) rather than a clean `undefined` return, which would tell the caller that the task cannot be executed.

## Steps to Reproduce

1. Create a `TaskItem` of type `'shell'` with both `taskFileUri` and `resourceUri` set to `undefined`.
2. Call `createTaskForItem(item)`.
3. Observe that a task is returned with the workspace root folder path as the script.
4. Attempt to run the task — the terminal will fail with an error (e.g., `bash: /path/to/workspace: is a directory`).

## Expected Behavior

`createTaskForItem(item)` should return `undefined` when a shell task has no associated file URI. The caller can then display an appropriate error message.

## Actual Behavior

A `vscode.Task` is created with the workspace root directory as the script path. Running the task produces a cryptic terminal error.

**Affected code in `taskFactory.ts`:**

```typescript
case 'shell': {
  if (!resourceUri) {      // ← DEAD GUARD: resourceUri is always defined
    return undefined;
  }
  // ...
  const shellArgs = [resourceUri.fsPath]; // ← workspace root if no file URI was set
```

The `msbuild` case has the same dead guard pattern.

## Task Type

- [x] Shell Scripts

## Error Messages / Logs

```
bash: /path/to/workspace-root: Is a directory
```

## Environment

Discovered via static code analysis during `taskFactory.ts` refactoring planning.

## Workspace Structure

```
project-root/
└── (no shell script files)
```

## Additional Context

**Root cause**: The guard was presumably written to protect against `resourceUri` being undefined, but this became dead code when the `effectiveResourceUri ?? fallbackWorkspaceUri` fallback was introduced (likely a different commit). The intent was correct; the implementation became stale.

**Fix**: Replace the dead guard with a check against `effectiveResourceUri`:

```typescript
case 'shell': {
  if (!effectiveResourceUri) {
    return undefined;
  }
  // resourceUri is now guaranteed to be the real file URI, not a fallback
```

Note: `effectiveResourceUri` would need to remain in scope from the block above the switch (which it currently is).

The same fix applies to the `msbuild` case.

## Pre-submission Checklist

- [x] I have searched existing issues to ensure this bug hasn't been reported
- [x] I have checked the extension output logs for error messages
