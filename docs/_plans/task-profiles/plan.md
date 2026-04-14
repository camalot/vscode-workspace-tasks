# Plan: Task Profiles

## TL;DR

Add named **Task Profiles** — saved snapshots of a user's Favorites, hidden tasks/groups, and
active Compound Tasks. Profiles can be switched instantly via a status bar picker or command.
Shipping a `workspaceTasks.profiles.default` setting lets teams share a recommended starting
configuration in source control.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Addresses a real multi-persona problem: developers often alternate between "dev" mode
  (running lint + unit tests on save) and "release" mode (build pipeline, deploy scripts) — each
  with a different set of favorites and hidden clutter.
- Profiles build entirely on existing persisted data — `FavoritesService`, `FilteredTaskService`,
  and `CompoundTaskService` already have `initialize`/`set`/`get` patterns. Profiles are a
  serialization layer on top.
- Profile data is JSON-serializable and small, making it safe to commit to source control, share
  via Settings Sync, or export to a file.

**Risks / Weaknesses:**

- **Merge conflicts on switch**: When the user switches profiles, the in-memory state of all three
  dependent services must be replaced atomically. If any service refresh fails mid-switch, the
  workspace ends up in a mixed state. Need a transactional apply: snapshot current state, attempt
  switch, roll back on error.
- **Profile data drift**: A profile captures a point-in-time snapshot of task IDs. If the
  underlying tasks are renamed or removed (e.g. a `package.json` script is deleted), the stale
  IDs silently produce empty favorites or phantom hidden tasks. Must add a health-check on activate
  and surface a warning when a profile contains IDs not found in the current task cache.
- **Complexity for new users**: The concept of profiles adds a new mental model. The feature must
  be entirely opt-in (no profile → existing behavior unchanged) and should not surface any new UI
  until the user explicitly creates at least one profile.
- **Settings Sync interaction**: `workspaceState` is not synced. If profiles are stored in
  `workspaceState`, they won't travel across machines with Settings Sync. An opt-in
  `workspaceTasks.profiles.syncProfiles` using `globalState` (which is synced) should be offered.

**Verdict:** Viable but operationally complex due to transactional apply and data drift concerns.
Recommend limiting Phase 1 to Favorites and hidden tasks only (omitting Compound Tasks) to reduce
surface area, then adding Compound Tasks in Phase 2 once the apply mechanism is proven stable.

---

## Key Design Decisions

- **Storage**: Profiles stored in `workspaceState` (default) or optionally `globalState` when
  `workspaceTasks.profiles.sync` is `true`. Key: `taskProfiles`.
- **Active profile**: Stored in `workspaceState` under `taskProfiles.active`. Null = no active
  profile (existing behavior preserved).
- **Profile schema**: Each profile captures a full serialized snapshot of Favorites, hidden
  tasks/groups, and optionally Compound Tasks.
- **Status bar**: When at least one profile exists, a status bar item shows the active profile
  name (or "No Profile") with a `$(organization)` icon. Clicking opens a profile picker.
- **Committing to source control**: A `workspaceTasks.profiles.default` setting (object, same
  shape as a profile) allows teams to ship a recommended profile in `settings.json`.

---

## Profile Schema (`ITaskProfile`)

```ts
interface ITaskProfile {
  name: string;                           // Unique display name
  description?: string;                  // Optional short description
  favorites: string[];                   // Task IDs (same format as FavoritesService)
  hiddenTasks: string[];                 // Task IDs
  hiddenGroups: string[];                // Group keys
  compoundTasks?: Record<string, SerializedCompoundTask>; // Phase 2
  createdAt: number;                     // epoch ms
  updatedAt: number;                     // epoch ms
}
```

---

## Phases

### Phase 1: Core Service (Favorites + Hidden Tasks)

1. **`src/services/taskProfileService.ts`** — New singleton:
   - `initialize(context)`: loads profiles from storage; loads active profile name.
   - `getProfiles(): ITaskProfile[]`
   - `getActiveProfile(): ITaskProfile | undefined`
   - `createProfile(name, description?)`: snapshots current Favorites + hidden state.
   - `applyProfile(name)`:
     1. Snapshot current state as a temporary rollback point.
     2. Call `FavoritesService._replaceAll(profile.favorites)` (new internal method).
     3. Call `FilteredTaskService._replaceAll(profile.hiddenTasks, profile.hiddenGroups)`.
     4. If either throws, call `_rollback(snapshot)`.
     5. Fire `onDidChangeProfile` event; set `workspaceState.taskProfiles.active`.
   - `saveProfile(name)`: overwrites the named profile with the current live state.
   - `deleteProfile(name)`: removes from storage; clears active if it was the deleted profile.
   - `onDidChangeProfile: vscode.Event<ITaskProfile | undefined>`

2. **`FavoritesService`** — Add `replaceAll(ids: string[])`: atomically replaces the in-memory
   set and persists, fires `onDidChangeFavorites` event.

3. **`FilteredTaskService`** — Add `replaceAll(tasks: string[], groups: string[])`: same pattern.

4. **`package.json`** — Add:
   - `workspaceTasks.profiles.sync`: boolean, default `false`
   - `workspaceTasks.profiles.default`: object of `ITaskProfile` shape (without `name`), default
     `null`. When set, applies as the effective first profile if no named profiles exist.

5. **`src/extension.ts`** — Initialize `TaskProfileService` after dependent services.

### Phase 2: Compound Tasks in Profiles

1. Extend `ITaskProfile` schema with `compoundTasks` field.
2. Add `CompoundTaskService.replaceAll(compoundTasks)` — atomic replace and persist.
3. Update `TaskProfileService.createProfile()` and `applyProfile()` to include Compound Tasks.
4. Update profile serialization/deserialization.

### Phase 3: Commands

1. **`src/commands/createProfileCommand.ts`** — `workspaceTasks.profiles.create`:
   - Input box: profile name (validate uniqueness).
   - Optional input box: description.
   - Calls `TaskProfileService.getInstance().createProfile(name, desc)`.
   - Shows information message: "Profile '…' created from current workspace state."

2. **`src/commands/switchProfileCommand.ts`** — `workspaceTasks.profiles.switch`:
   - `QuickPick` showing all profiles (name + description + `(active)` badge on current).
   - On accept: calls `applyProfile(name)`; refreshes tree.
   - Add **"No Profile"** item at top to clear the active profile back to raw state.

3. **`src/commands/saveProfileCommand.ts`** — `workspaceTasks.profiles.save`:
   - If active profile: confirm overwrite, then `saveProfile(activeName)`.
   - If no active profile: prompt for a name (same flow as create).

4. **`src/commands/deleteProfileCommand.ts`** — `workspaceTasks.profiles.delete`:
   - `QuickPick` of profiles; on accept: confirm delete, call `deleteProfile(name)`.

5. Register all four commands in `package.json` `contributes.commands` and in `extension.ts`.

### Phase 4: Status Bar & Tree Integration

1. **`src/providers/taskProfileStatusBarProvider.ts`**:
   - Right-aligned status bar item.
   - Shows `$(organization) {profileName}` when active; `$(organization) No Profile` when none.
   - Hides entirely when zero profiles exist (so it never appears for users who don't use profiles).
   - Command: `workspaceTasks.profiles.switch`.
   - Updates on `TaskProfileService.onDidChangeProfile`.

2. **Task tree title bar**: Add `$(organization)` button that runs
   `workspaceTasks.profiles.switch`. Visible only when profiles exist
   (use `when` clause: `workspaceTasks.profileCount > 0`).
3. Register `workspaceTasks.profileCount` as a VS Code context key, updated in
   `TaskProfileService` on any profile list change.

### Phase 5: Health Check & Data Drift Warning

1. After `applyProfile()`, call `validateProfile(profile)`:
   - Uses `TaskCacheService.isKnownTaskId(id)` to check every ID in favorites and hidden lists.
   - Collects unknown IDs into `unknownIds[]`.
2. If `unknownIds.length > 0`, show a warning:
   _"Profile '…' references N tasks not found in this workspace. They have been skipped."_
   with a **"Review Profile"** button that opens a webview or quick pick showing the stale IDs.
3. Persist a `_staleIds` annotation on the profile so the warning isn't repeated until the next
   profile switch.

### Phase 6: Tests

1. `src/test/suite/services/taskProfileService.test.ts`
   - Create, apply, save, delete flows.
   - Rollback on `FavoritesService.replaceAll` failure.
   - `onDidChangeProfile` fires with the correct profile reference.
   - Health check correctly identifies unknown IDs.
2. `src/test/suite/commands/switchProfileCommand.test.ts`
   - QuickPick shows all profiles; selecting applies profile.
   - "No Profile" clears active profile.
3. `src/test/suite/providers/taskProfileStatusBarProvider.test.ts`
   - Status bar hidden when zero profiles.
   - Status bar text updates on `onDidChangeProfile`.

### Phase 7: Documentation

1. **`docs/features/task-profiles.md`** — New page: concept overview, how to create/switch/save/
   delete profiles, team workflow example with `profiles.default` in `settings.json`.
2. **`docs/configuration/profiles.md`** — All `workspaceTasks.profiles.*` settings with examples.
3. **`README.md`** — Add **"🗂️ Task Profiles"** to Key Features list.
4. **`docs/features/index.md`** — Add entry.
