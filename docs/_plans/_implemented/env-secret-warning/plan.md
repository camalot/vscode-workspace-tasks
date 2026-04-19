# Plan: Git-Tracked Env/Secret File Warnings & Empty Secrets Group Setting

## TL;DR

Two independent improvements to env-variable safety and treeview consistency:

1. **Git-tracked file diagnostics** — Proactively check if any files listed in `workspaceTasks.envVars.envFiles` or `workspaceTasks.envVars.secretFiles` are tracked by git, and surface a `DiagnosticSeverity.Warning` in the Problems panel. A new boolean configuration setting lets users globally silence this check.

2. **Always-show Secrets root** — Add a boolean setting that causes the `Secrets` treeview root item to be rendered even when no secrets are currently stored in VS Code SecretStorage.

---

## Requirements

### Feature 1 — Git-tracked env/secret file warnings

- When `workspaceTasks.envVars.envFiles` or `workspaceTasks.envVars.secretFiles` contain paths to files that are currently tracked by git, report a `DiagnosticSeverity.Warning` for each such file in the VS Code Problems panel.
- The warning message must:
  - Identify which setting lists the file (`envFiles` vs `secretFiles`).
  - State the security risk (credentials/secrets committed to version control).
  - Recommend best practices (add to `.gitignore`, use SecretStorage, move to a `.secret` file outside git).
- The diagnostics must be cleared and re-evaluated whenever:
  - The extension activates.
  - `workspaceTasks.envVars.envFiles` or `workspaceTasks.envVars.secretFiles` configuration changes.
  - The workspace is changed (multi-root scenario).
- A new boolean setting `workspaceTasks.envVars.warnIfGitTracked` (default `true`) allows users to disable this check entirely.
- When the setting is `false`, no diagnostics are emitted and any previously emitted ones are cleared.
- Individual per-file suppression is **not** required for this check (the existing key-level suppression remains unchanged).

### Feature 2 — Always-show Secrets root

- Add a new boolean setting `workspaceTasks.secrets.showEmptyGroup` (default `false`).
- When `true`, the `Secrets` root item is rendered in the treeview even when `context.secrets.keys()` returns an empty list.
- When the group is empty, it should show no children and render in a visually distinct way (tooltip indicating no secrets are stored).
- The setting change must trigger a treeview refresh.

---

## Key Design Decisions

### Feature 1

- **Where the check lives**: `TaskSecretWarningService` already owns the diagnostic collection and the `isGitTracked` helper. A new `checkConfiguredEnvFilesForGitTracking()` method is added there; it does not alter the existing `checkAndWarn()` task-run path.
- **File resolution**: `TaskEnvFileResolver` resolves globs and ordered arrays into concrete file paths. It is used (already a singleton-friendly utility) inside the new method. Because the resolver depends on workspace root, only files within open workspace folders are checked.
- **Trigger**: `TaskEnvService.initialize()` calls the new method after its initial `loadConfig()`. The existing `onDidChangeConfiguration` handler in `TaskEnvService` also calls `TaskSecretWarningService.checkConfiguredEnvFilesForGitTracking()` when `workspaceTasks.envVars` settings change.
- **Diagnostic code**: New diagnostic code `config-env-file-git-tracked` (for `envFiles`) and `config-secret-file-git-tracked` (for `secretFiles`) — distinct from the existing `suspicious-env-key` and `secret-file-tracked` codes that target task-run time.
- **No warning message box**: Unlike task-run warnings, this check emits only to the Problems panel (no `showWarningMessage` popup). This avoids spam at startup.

### Feature 2

- **Setting location**: New setting under `workspaceTasks.secrets` namespace (consistent with future secrets grouping).
- **Trigger**: `TaskTreeDataProvider` already reads `workspaceTasks` config inside `organizeTasks()`. Adding a `config.get<boolean>('secrets.showEmptyGroup', false)` read there is sufficient. A config-change listener must also fire `_onDidChangeTreeData` for this key.

---

## New Configuration Settings

### `workspaceTasks.envVars.warnIfGitTracked`

| Property | Value |
|---|---|
| Type | `boolean` |
| Default | `true` |
| Scope | `resource` |
| Description | When `true`, emits a warning in the Problems panel for any file listed in `workspaceTasks.envVars.envFiles` or `workspaceTasks.envVars.secretFiles` that is tracked by git. Set to `false` to silence these warnings. |

### `workspaceTasks.secrets.showEmptyGroup`

| Property | Value |
|---|---|
| Type | `boolean` |
| Default | `false` |
| Scope | `resource` |
| Description | When `true`, the **Secrets** group is always shown in the treeview, even when no secrets are currently stored in VS Code SecretStorage. |

---

## Implementation Phases

### Phase 1 — Settings (`package.json` / `package.nls.json`)

**Files to change:**
- `package.json` — add `workspaceTasks.envVars.warnIfGitTracked` and `workspaceTasks.secrets.showEmptyGroup` under `contributes.configuration.properties`.
- `package.nls.json` — add NLS strings for both settings (description + markdownDescription).

**Details:**
- Place `workspaceTasks.envVars.warnIfGitTracked` adjacent to the existing `workspaceTasks.envVars.secretFiles` entry.
- Place `workspaceTasks.secrets.showEmptyGroup` in a new `workspaceTasks.secrets` group section.
- Both settings are `boolean` with the defaults specified above.

---

### Phase 2 — `TaskSecretWarningService` — new proactive check

**File to change:** `src/services/taskSecretWarningService.ts`

**New public method:**

```typescript
public async checkConfiguredEnvFilesForGitTracking(): Promise<void>
```

Logic:
1. Read `workspaceTasks.envVars.warnIfGitTracked`; if `false`, call `clearConfigFileDiagnostics()` and return.
2. Read `workspaceTasks.envVars.envFiles` and `workspaceTasks.envVars.secretFiles` from VS Code configuration.
3. For each workspace folder, use `TaskEnvFileResolver` to expand both values to concrete absolute paths.
4. For each resolved path that exists on disk:
   - Call `isGitTracked(filePath)`.
   - If tracked, call `addConfigEnvFileDiagnostic(filePath, settingKey)` (new private helper similar to `addSecretFileDiagnostic`).
5. Remove stale diagnostics for files that are no longer configured or no longer git-tracked.

**New private helper:**

```typescript
private addConfigEnvFileDiagnostic(filePath: string, settingKey: 'envFiles' | 'secretFiles'): void
```

- Creates a `DiagnosticSeverity.Warning` with:
  - `source`: `'Workspace Tasks'` (same constant as existing warnings)
  - `code`: `'config-env-file-git-tracked'` or `'config-secret-file-git-tracked'`
  - Message: `"<basename> is configured in workspaceTasks.envVars.<settingKey> and is tracked by git. Files containing environment variables or secrets should be added to .gitignore to avoid accidentally committing sensitive data. Consider using .secret files or VS Code SecretStorage instead."`
- Avoids duplicate entries (check existing diagnostics on the URI before appending).

**New private helper:**

```typescript
private clearConfigFileDiagnostics(): void
```

- Iterates the diagnostic collection and removes any diagnostic with code `config-env-file-git-tracked` or `config-secret-file-git-tracked` without removing diagnostics from the task-run path.

> **Note:** Because `vscode.DiagnosticCollection` does not support per-code filtering, the `clearConfigFileDiagnostics` method should reconstruct the per-URI arrays with only the non-config-file-git-tracked entries preserved. Alternatively, track the set of URIs that have `config-*` diagnostics separately and only reconstruct those URIs.

---

### Phase 3 — `TaskEnvService` — trigger the new check

**File to change:** `src/services/taskEnvService.ts`

1. In `initialize()`, after `this.loadConfig()` and `this.setupFileWatchers()`, call:
   ```typescript
   TaskSecretWarningService.getInstance().checkConfiguredEnvFilesForGitTracking();
   ```
2. In the `onDidChangeConfiguration` handler, after the existing `loadConfig()` / `setupFileWatchers()` / `_onDidChangeEnvSources.fire()` calls, also call:
   ```typescript
   TaskSecretWarningService.getInstance().checkConfiguredEnvFilesForGitTracking();
   ```

This ensures diagnostics are refreshed both at startup and when the user edits settings.

---

### Phase 4 — `TaskTreeDataProvider` — secrets empty group

**File to change:** `src/taskTreeDataProvider.ts`

1. In `organizeTasks()`, read the new setting:
   ```typescript
   const showEmptySecretsGroup = config.get<boolean>('secrets.showEmptyGroup', false);
   ```
2. Change the guard on the Secrets group block from:
   ```typescript
   if (secretKeys.length > 0) {
   ```
   to:
   ```typescript
   if (secretKeys.length > 0 || showEmptySecretsGroup) {
   ```
3. When `secretKeys.length === 0` and the group is shown via the setting, update the tooltip:
   ```typescript
   secretsGroup.tooltip = secretKeys.length > 0
     ? 'Secrets stored in VS Code SecretStorage'
     : 'No secrets stored. Use "Workspace Tasks: Store Secret" to add one.';
   ```
4. In the constructor or `initialize()`, add a `vscode.workspace.onDidChangeConfiguration` listener that fires `_onDidChangeTreeData` when `workspaceTasks.secrets.showEmptyGroup` changes. (Check if one already exists and extend it if so, to avoid adding a second listener.)

---

### Phase 5 — Tests

#### `src/test/suite/taskSecretWarningService.test.ts`

Add tests for the new `checkConfiguredEnvFilesForGitTracking()` method:

| Test | Description |
|---|---|
| `warnIfGitTracked disabled: no diagnostics emitted` | Set `warnIfGitTracked` to `false`; assert no diagnostics appear even when a file is git-tracked. |
| `envFiles: git-tracked file produces config-env-file-git-tracked diagnostic` | Configure a single `envFiles` entry pointing to a git-tracked path; verify a diagnostic with code `config-env-file-git-tracked` is added. |
| `secretFiles: git-tracked file produces config-secret-file-git-tracked diagnostic` | Same for `secretFiles` and `config-secret-file-git-tracked`. |
| `non-tracked file produces no diagnostic` | File in `envFiles` that `isGitTracked` returns false for; assert no new diagnostics. |
| `clearConfigFileDiagnostics: preserves task-run diagnostics` | Add a `suspicious-env-key` diagnostic separately; call `clearConfigFileDiagnostics()`; assert the task-run diagnostic survives. |
| `re-run after setting disabled clears existing config diagnostics` | First call with tracking enabled (produces diagnostic); then call with `warnIfGitTracked=false`; assert diagnostic is removed. |

#### `src/test/suite/taskTreeDataProvider.test.ts`

Add tests in the existing `Secrets group` section:

| Test | Description |
|---|---|
| `showEmptyGroup=false and no secrets: Secrets group absent` | Regression test confirming default behavior unchanged. |
| `showEmptyGroup=true and no secrets: Secrets group present with no children` | Assert root item with `taskType === 'secrets'` is included with zero children. |
| `showEmptyGroup=true and secrets exist: Secrets group present with children` | Assert normal children are still rendered. |
| `showEmptyGroup=true empty group: tooltip indicates no secrets stored` | Assert `tooltip` text contains the "No secrets stored" hint. |

---

### Phase 6 — Documentation

**Files to change:**
- `docs/configuration/environment/environment-variables.md` — Add a section for `workspaceTasks.envVars.warnIfGitTracked`, explaining the behavior, the diagnostics that are emitted, and how to disable the check.
- `docs/features/task-environment-variables.md` — Cross-reference the new security warning.
- Create or update `docs/configuration/general/secrets.md` (or appropriate config doc) to document `workspaceTasks.secrets.showEmptyGroup`.
- `README.md` — Update the environment variables section to mention the new git-tracking warning.

---

## Rubber Duck Review Checklist

Before implementation, validate:

1. **Does `TaskEnvFileResolver.resolveEnvFiles` correctly handle all `IEnvFileReference` shapes** (string, string[], `{include, exclude}` object) in the diagnostic path? Confirm the resolver returns empty array when no workspace folders exist (safe for extension tests without an open folder).
2. **Multi-root workspaces**: The check runs per workspace folder. The same file could theoretically appear in multiple workspace folders' glob expansions. De-duplicate by absolute path before calling `isGitTracked`.
3. **Race condition at startup**: `TaskEnvService.initialize()` is `async`. `checkConfiguredEnvFilesForGitTracking()` should be awaited so that git-tracking results are available before the first tree render where possible (or fire-and-forget with a short delay).
4. **`clearConfigFileDiagnostics` correctness**: The diagnosticCollection API requires replacing the entire array per URI. When clearing config-file diagnostics, the method must not clear task-run diagnostics (different codes). Accumulate URIs that had config diagnostics and rebuild their arrays.
5. **Setting `warnIfGitTracked` default `true`**: This will show warnings for users who already have git-tracked env files upon upgrade. This is the correct behavior (safety by default), but should be called out clearly in the documentation and changelog entry.
6. **`showEmptyGroup` treeview refresh**: Confirm the existing `onDidChangeConfiguration` listener in `TaskTreeDataProvider` (if any) already fires `_onDidChangeTreeData`. If the listener is only in `TaskEnvService`, also add/extend one in `TaskTreeDataProvider`.

---

## Files Modified Summary

| File | Change |
|---|---|
| `package.json` | Add 2 new configuration properties |
| `package.nls.json` | Add NLS strings for 2 new settings |
| `src/services/taskSecretWarningService.ts` | Add `checkConfiguredEnvFilesForGitTracking()`, `addConfigEnvFileDiagnostic()`, `clearConfigFileDiagnostics()` |
| `src/services/taskEnvService.ts` | Call `checkConfiguredEnvFilesForGitTracking()` on init and config change |
| `src/taskTreeDataProvider.ts` | Read `secrets.showEmptyGroup`; update Secrets group guard and tooltip; subscribe to config change |
| `src/test/suite/taskSecretWarningService.test.ts` | 6 new tests for git-tracking check |
| `src/test/suite/taskTreeDataProvider.test.ts` | 4 new tests for empty Secrets group setting |
| `docs/configuration/environment/environment-variables.md` | Document `warnIfGitTracked` |
| `docs/features/task-environment-variables.md` | Cross-reference new warning |
| `docs/configuration/general/secrets.md` *(new or existing)* | Document `showEmptyGroup` |
| `README.md` | Mention git-tracking warning in env-vars section |
