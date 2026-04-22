---
title: '[Bug]: venv task provider strips .py extension from Python scripts whose name contains "activate" or "deactivate"'
labels: ['bug', 'needs-triage']
---

## Bug Description

In the `venv` case of `taskFactory.ts`, there is a heuristic that strips the `.py` extension from the script path when the path contains the string "activate" or "deactivate":

```typescript
if (
  scriptPath.endsWith('.py') &&
  (scriptPath.toLowerCase().includes('activate') || scriptPath.toLowerCase().includes('deactivate'))
) {
  scriptPath = scriptPath.substring(0, scriptPath.length - 3);
}
```

This check is too broad. It will corrupt any legitimate Python script whose filename contains "activate" or "deactivate" as a substring, such as:

- `activate_env.py` → `activate_env` (wrong — no such file exists)
- `deactivate_plugin.py` → `deactivate_plugin` (wrong)
- `reactivate.py` → `reactivate` (wrong)

The resulting path points to a non-existent file, causing the task execution to fail.

## Steps to Reproduce

1. Add a Python script named `activate_env.py` to a virtualenv project directory.
2. Open the workspace in VS Code with the Workspace Tasks extension.
3. Find the `activate_env.py` task in the "Shell Scripts" section.
4. Run the task.
5. Observe the terminal: it tries to execute `activate_env` instead of `activate_env.py`.

## Expected Behavior

The `.py` extension should only be stripped from the specific scripts that venv generates (`activate`, `deactivate`) — which are actually shell scripts on Unix, not Python files. Those scripts do **not** end in `.py`, so this condition can never correctly trigger for them. The branch is unreachable for its intended purpose and only serves to corrupt unintended paths.

## Actual Behavior

The `.py` extension is stripped from any Python file whose name contains "activate" or "deactivate" as a substring. The resulting file path refers to a non-existent file.

**Affected code in `taskFactory.ts`:**

```typescript
let scriptPath = taskUri.fsPath;
if (
  scriptPath.endsWith('.py') &&
  (scriptPath.toLowerCase().includes('activate') || scriptPath.toLowerCase().includes('deactivate'))
) {
  scriptPath = scriptPath.substring(0, scriptPath.length - 3);  // strips .py — WRONG
}
```

## Task Type

- [x] Shell Scripts

## Error Messages / Logs

```
/bin/sh: activate_env: not found
```

or similar, depending on shell.

## Environment

Discovered via static code analysis during `taskFactory.ts` refactoring planning.

## Workspace Structure

```
project-root/
├── activate_env.py     ← legitimate Python script
└── venv/
    └── bin/
        ├── activate    ← shell script (no .py extension)
        ├── activate.bat
        └── Activate.ps1
```

## Additional Context

**Analysis of original intent**: The venv `activate` and `deactivate` scripts are shell scripts on Unix (no extension), `.bat` scripts on Windows, and `.ps1` scripts on PowerShell. None of them end in `.py`. The condition `scriptPath.endsWith('.py') && scriptPath.includes('activate')` can never be true for actual venv activation scripts, making the branch both unreachable for its intended purpose and harmful for unintended paths.

**Recommended fix**: Remove the `.py` stripping logic entirely. If the intent was to handle a specific edge case, document it with a test rather than a substring heuristic. If the edge case is real, check by exact basename:

```typescript
// Only strip .py if the exact filename is 'activate.py' or 'deactivate.py'
const basename = path.basename(scriptPath);
if (basename === 'activate.py' || basename === 'deactivate.py') {
  scriptPath = scriptPath.substring(0, scriptPath.length - 3);
}
```

This is still of questionable value (venv doesn't produce `.py` activate scripts), but at least it won't corrupt unrelated files.

## Pre-submission Checklist

- [x] I have searched existing issues to ensure this bug hasn't been reported
- [x] I have checked the extension output logs for error messages
