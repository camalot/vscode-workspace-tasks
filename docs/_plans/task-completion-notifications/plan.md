# Plan: Task Completion Notifications

## TL;DR

Add a `TaskNotificationService` that delivers configurable notifications when tasks end. Each
notification channel — VS Code information/warning/error popups, status bar flashes, and optional
OS-level desktop notifications via `vscode.env.openExternal` — is independently toggleable.
Notification behavior is configurable globally and can be overridden per task type or per individual
task via annotations in `.workspace-tasks.json`.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Background and long-running tasks are the most common case where a user switches away and then
  has no idea when they finish. Notifications directly solve this context-switching cost.
- VS Code already fires `onDidEndTask` and `onDidEndTaskProcess` — the extension simply isn't
  acting on them for notification purposes. The implementation path is straightforward.
- Three tiers of notification (status bar flash, VS Code popup, OS desktop) let users tune
  intrusiveness. Most users will want a low-friction status bar flash for fast tasks and a desktop
  notification only for slow ones.

**Risks / Weaknesses:**

- **Notification fatigue**: If every 2-second `npm install` ends with a popup, users will disable
  the feature immediately. The default configuration must be conservative: status bar flash only,
  and only for tasks that take longer than a minimum threshold (e.g. 3 seconds).
- **OS desktop notifications**: `vscode.env.openExternal` can only open URLs and is not the right
  API for desktop notifications. The VS Code extension API does not expose a native notification
  channel. The only viable built-in VS Code path is `vscode.window.showInformationMessage()` with
  a focus-stealing popup, which is undesirable. A separate approach using Node's `child_process` to
  call platform-specific tools (`notify-send` on Linux, `osascript` on macOS, PowerShell on
  Windows) is possible but fragile and out of scope for the initial release. Desktop notifications
  should be listed as a future consideration, not Phase 1.
- **Conflation with Task History**: The history panel already surfaces task completion status.
  Notifications must add value beyond what history already provides — the unique value is
  _proactive_ delivery while the user is elsewhere. The messaging in the plan and docs must make
  this distinction clear.
- **Silent tasks**: Some tasks intentionally run in the background with no terminal output
  (e.g. file watchers). Ending such a task (via stop) with a "Task completed" popup is confusing.
  Must filter: only notify for tasks that reached a terminal `exitCode` state, not `Terminated`.

**Verdict:** Viable and high-impact for heavy users of long-running tasks, but configuration
defaults are critical. Ship with very conservative defaults to avoid backlash. Desktop notifications
are deferred — the VS Code popup and status bar channels alone already justify the feature.

---

## Key Design Decisions

- **Channels (v1)**: `statusBar` (flash the task name + status for N seconds) and `vscode`
  (VS Code `showInformationMessage` / `showErrorMessage`). Desktop notifications deferred.
- **Minimum duration filter**: Only notify for tasks whose execution time ≥
  `workspaceTasks.notifications.minDurationMs` (default: `3000`). Prevents noise from fast tasks.
- **Status filter**: Only notify for `Success` and `Failed` statuses. `Terminated` tasks are
  excluded by default (configurable).
- **Deduplication window**: If the same task fires a completion event twice within 500 ms (a VS
  Code quirk where both `onDidEndTaskProcess` and `onDidEndTask` fire), only emit one notification.
- **Per-task opt-out**: A `"notify": false` annotation on a task in `.workspace-tasks.json`
  suppresses all notifications for that task regardless of global settings.
- **Focus-only VS Code popups**: Optionally suppress VS Code popup notifications when the VS Code
  window has focus (`workspaceTasks.notifications.vscode.onlyWhenUnfocused`, default `true`).

---

## Notification Configuration Schema

```jsonc
{
  "workspaceTasks.notifications.enabled": true,
  "workspaceTasks.notifications.minDurationMs": 3000,
  "workspaceTasks.notifications.notifyOnTerminated": false,
  "workspaceTasks.notifications.channels": {
    "statusBar": {
      "enabled": true,
      "durationMs": 5000        // How long the flash stays visible
    },
    "vscode": {
      "enabled": true,
      "onlyWhenUnfocused": true // Suppress popup when VSCode window has focus
    }
  }
}
```

Per-task override in `.workspace-tasks.json`:

```jsonc
{
  "shell": {
    "tasks": [
      {
        "label": "Noisy Watcher",
        "command": "...",
        "notify": false         // Suppress all notifications for this task
      },
      {
        "label": "Deploy to Staging",
        "notify": {
          "channels": ["statusBar", "vscode"]  // Override: always notify for this task
        }
      }
    ]
  }
}
```

---

## `INotificationRule` Interface

```ts
interface ITaskNotificationRule {
  taskKey: string;           // Resolved from task source + label (same key as TaskHistoryService)
  notify: boolean | {
    channels: ('statusBar' | 'vscode')[];
  };
}
```

---

## Phases

### Phase 1: Core Service & Status Bar Channel

1. **`src/services/taskNotificationService.ts`** — New singleton:
   - `initialize(context)`: reads global config; loads per-task overrides from
     `WorkspaceTasksService`; subscribes to `TaskHistoryService.onDidChange`.
   - `_recent: Map<string, number>` — deduplication: maps `taskKey` to last notification epoch ms.
   - `handleHistoryChange()`: iterate records from `TaskHistoryService.getAll()` for tasks that
     just ended; apply filters (min duration, status filter, per-task opt-out, dedupe window);
     dispatch to active channels.
   - `notifyStatusBar(record)`: updates a dedicated `vscode.StatusBarItem` with task name + status
     icon; auto-clears after `durationMs`.
   - `notifyVSCode(record)`:
     - On `Success`: `vscode.window.showInformationMessage(...)`.
     - On `Failed`: `vscode.window.showErrorMessage(...)` with **"Show in History"** action that
       opens the Task History table panel.
   - `isWindowFocused()`: uses `vscode.window.state.focused`.
   - `dispose()`: clears the status bar item.

2. **`src/services/taskHistoryService.ts`** — Expose
   `onDidRecordHistory: vscode.Event<ITaskExecutionRecord>` (fire on each new terminal record,
   i.e. when status becomes `Success`, `Failed`, or `Terminated`). Used by notification service
   to avoid polling the full history on every `onDidChange`.

3. **`package.json`** — Add all `workspaceTasks.notifications.*` configuration keys with
   descriptions, types, defaults, and validation constraints.

4. **`src/extension.ts`** — Wire `TaskNotificationService.getInstance().initialize(context)`.

### Phase 2: Per-Task Overrides from `.workspace-tasks.json`

1. Extend `FileTaskDefinition` (in `workspaceTasksService.ts`) with optional
   `notify?: boolean | { channels: ('statusBar' | 'vscode')[] }`.
2. Extend `res/schemas/workspace-tasks.schema.json` with the `notify` property.
3. `TaskNotificationService` calls `WorkspaceTasksService.getNotifyOverride(taskKey)` (new method)
   to resolve per-task overrides at notification dispatch time.

### Phase 3: "Show in History" Deep Link

1. When the user clicks **"Show in History"** in the error popup, call
   `vscode.commands.executeCommand('workspaceTasks.showHistory')` (new command, or reuse existing
   open-history-panel command if one exists).
2. Pass the `executionId` as an argument; the History table panel scrolls to and highlights that
   row.

### Phase 4: Notification History Log

1. Add a lightweight in-memory `NotificationLog` (max 50 entries) inside
   `TaskNotificationService`.
2. Expose a `workspaceTasks.notifications.showLog` command that opens a read-only webview or
   output channel listing recent notifications: timestamp, task name, status, duration.
3. This log is intentionally ephemeral (not persisted) — it exists only for the current session.

### Phase 5: Tests

1. `src/test/suite/services/taskNotificationService.test.ts`
   - Min-duration filter: records below threshold do not trigger notifications.
   - Deduplication: two events within 500 ms produce one notification.
   - `Terminated` status suppressed by default; enabled via config.
   - `onlyWhenUnfocused`: when window is focused, VS Code popup is suppressed.
   - Per-task `notify: false` suppresses both channels.
   - `showInformationMessage` / `showErrorMessage` called with correct task name and status.
   - Status bar item text set correctly and cleared after `durationMs`.
2. `src/test/suite/services/taskHistoryService.test.ts`
   - `onDidRecordHistory` fires exactly once when a task reaches terminal status.

### Phase 6: Documentation

1. **`docs/features/task-notifications.md`** — New page: channels overview, configuration
   examples (common scenarios: "notify me when deploys finish", "suppress noise from watch tasks"),
   per-task override syntax.
2. **`docs/configuration/notifications.md`** — Full settings reference.
3. **`README.md`** — Add **"🔔 Task Completion Notifications"** to Key Features.
4. **`docs/features/index.md`** — Add entry.
