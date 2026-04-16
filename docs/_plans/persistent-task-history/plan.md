# Plan: Persistent Task History Log (Hybrid: workspaceState + NDJSON Archive)

## TL;DR

Persist individual `ITaskExecutionRecord` objects so that Task History survives VS Code restarts.
The implementation uses a **hybrid strategy**: the most recent N records are kept in VS Code's
`workspaceState` (fast, zero-I/O reads for the UI), while all records are also appended to a
newline-delimited JSON (NDJSON) file at `.vscode/task-history.ndjson` for long-term storage and
external tooling. On startup, if the NDJSON file exists, its contents are automatically imported
into the in-memory history so previous runs are immediately visible in the History tab.

---

## Background

### Current state

`TaskHistoryService` stores `ITaskExecutionRecord` objects only in memory:

```typescript
private historyGroups: Map<string, ITaskHistoryGroup> = new Map();
```

When VS Code restarts, `historyGroups` is always empty. Aggregated statistics survive because
`TaskMetricsService` persists to `workspaceState`/`globalState` using a serialized write queue
(`enqueueUpdate`). This plan extends `TaskHistoryService` with the same persistence pattern.

### `ITaskExecutionRecord` serialization caveat

The `definition` field is typed as `vscode.TaskDefinition`, which is a live VS Code object. While
`vscode.TaskDefinition` is a plain-object interface (no non-serializable methods), some task
providers attach non-serializable properties. A serialization helper is required to produce a safe
`ISerializedTaskExecutionRecord` before writing to storage.

---

## Requirements

1. After each task execution reaches a terminal state (`Success`, `Failed`, or `Terminated`), the
   record is persisted to both `workspaceState` and `.vscode/task-history.ndjson`.
2. On extension activation, if `.vscode/task-history.ndjson` exists, **all records** in it are
   imported into the in-memory history, sorted newest-first by `startTime`.
3. When the NDJSON file exists but `workspaceState` has fewer records (e.g. after the cap was
   lowered), the full NDJSON file is the authoritative source for History tab display.
4. `workspaceState` holds at most `workspaceTasks.history.maxPersistedRecords` records
   (default: 200, range 10–2000). Oldest records are pruned when the cap is exceeded.
5. `workspaceTasks.history.retentionDays` (default: 0 = unlimited) prunes records older than N
   days from both `workspaceState` and NDJSON on activation and on each new write.
6. The NDJSON file is append-only. Pruning from the NDJSON is done by rewriting the file (only
   when records are actually pruned, not on every write).
7. On concurrent access from multiple VS Code windows sharing the same workspace folder, the
   `workspaceState` write queue (already serialized by VS Code) is unaffected. NDJSON writes use
   an async queue (same `enqueueUpdate` pattern from `TaskMetricsService`) to serialize file I/O
   and prevent file corruption.
8. The NDJSON file should be added to the extension's recommended `.gitignore` patterns in
   documentation, but no automatic `.gitignore` mutation occurs.
9. When the NDJSON file cannot be read (corrupt, permission error), the extension logs a warning
   and falls back gracefully — records still appear from `workspaceState` and new records continue
   to be written.
10. 100% test coverage for all new code.

---

## Key Design Decisions

### `workspaceState` as primary read source; NDJSON as archive

The History tab webview calls `TaskHistoryService.getAllExecutions()` / `getHistoryGroups()`.
These return from the in-memory `historyGroups` map, which is **now seeded at startup from the
NDJSON file**. The webview never reads files directly — the service abstracts both storage
layers.

### Extend `TaskHistoryService` directly (not `TaskMetricsService`)

`TaskMetricsService` persists *aggregated* metrics. Raw execution records are `TaskHistoryService`'s
concern. The same `enqueueUpdate`-style write queue pattern is replicated in `TaskHistoryService`
to serialize writes without coupling the two services.

### `ISerializedTaskExecutionRecord` — safe JSON representation

`ITaskExecutionRecord.definition` is typed as `vscode.TaskDefinition`, which is a plain-object
interface (`{ type: string; [key: string]: any }`). It is JSON-serializable as-is. However,
task providers may attach arbitrary extra keys to `definition`, including secrets or non-string
values. The serialized form uses only the known-safe fields:

```typescript
export interface ISerializedTaskExecutionRecord {
  id: string;
  taskName: string;
  taskSource: string;
  scope: string;
  definitionType: string;    // definition.type
  definitionPath?: string;   // definition.path (common across many task types)
  startTime: number;
  endTime?: number;
  exitCode?: number;
  status: 'Running' | 'Success' | 'Terminated' | 'Failed';
  duration?: number;
}
```

`deserialize(raw)` reconstructs `ITaskExecutionRecord` with
`definition: { type: raw.definitionType, path: raw.definitionPath }` — the minimal fields
needed for the History tab's source column and metrics key derivation.

### Storage authority

- **NDJSON file** is the **single source of truth** for the full history log. It is loaded at
  startup and drives the in-memory `historyGroups`.
- **`workspaceState`** is a **performance cache** of the most recent `maxPersistedRecords`
  entries. It exists so the History tab can render without file I/O on every open. If the
  NDJSON file is deleted manually, `workspaceState` data is used as a fallback. If both are
  absent, history starts empty (normal first-run state).

### NDJSON path

The NDJSON file is written to the **first workspace folder**:
`path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'task-history.ndjson')`.

In multi-root workspaces, all records (regardless of `scope`) are stored in a single shared
NDJSON file under the first workspace folder. Each record's `scope` field identifies which
workspace folder it belongs to, so the data remains correct.

### `retentionDays: 0` semantic

`0` means **unlimited retention** (no pruning), consistent with `workspaceTasks.metrics.retentionDays`.

### `clear()` becomes async

`TaskHistoryService.clear()` currently returns `void`. After this change it must return
`Promise<void>` to allow awaiting the NDJSON truncation and `workspaceState` reset. All callers
of `clear()` must be updated (search for `historyService.clear()` and `.clear()` calls on the
history service instance in the extension). At minimum: the clear history command handler.

### Extension deactivation flush

`extension.ts` must register a `deactivate()` export that awaits both write queues before
returning, ensuring the last record is not lost when VS Code closes:
```typescript
export async function deactivate(): Promise<void> {
  await TaskHistoryService.getInstance().flush();
}
```
A new `public flush(): Promise<void>` method on `TaskHistoryService` must expose the queues
(same pattern as `TaskMetricsService.flush()`).

### Pruning strategy

- **`retentionDays`** applies to both stores. On `loadPersistedHistory()`, records whose
  `startTime < Date.now() - retentionDays * 86400000` are excluded. If any records were pruned,
  the NDJSON file is rewritten without them.
- **`maxPersistedRecords`** applies to `workspaceState` only (not the NDJSON file). The NDJSON
  file grows unbounded (subject only to `retentionDays`). On each new write, if
  `workspaceState` record count exceeds the cap, the oldest entries (by `startTime`) are dropped.
- **I/O amplification:** Each NDJSON append reads the entire file, appends one line, and
  rewrites it (`vscode.workspace.fs` has no append mode). For typical usage (< 5,000 records at
  ~200 bytes/record → < 1 MB), this is acceptable. The write queue ensures only one I/O
  operation runs at a time, preventing concurrent corruption.

---

## Implementation

### Phase 1: Serialization helpers

**New file: `src/services/taskHistorySerializer.ts`**

- `serialize(record: ITaskExecutionRecord): ISerializedTaskExecutionRecord` — extracts safe fields.
- `deserialize(raw: ISerializedTaskExecutionRecord): ITaskExecutionRecord` — reconstructs record
  with a minimal `definition` object `{ type: raw.definitionType, path: raw.definitionPath }`.
- `parseNdjsonLine(line: string): ISerializedTaskExecutionRecord | null` — `JSON.parse` with
  try/catch; returns `null` on malformed lines.

### Phase 2: Settings

**File: `package.json` — `contributes.configuration`**

Add two settings:

```jsonc
"workspaceTasks.history.maxPersistedRecords": {
  "type": "integer",
  "default": 200,
  "minimum": 10,
  "maximum": 2000,
  "description": "Maximum number of task execution records persisted per workspace..."
}
"workspaceTasks.history.retentionDays": {
  "type": "integer",
  "default": 0,
  "minimum": 0,
  "description": "Number of days to retain persisted task history. 0 = unlimited."
}
```

### Phase 3: Persistence in `TaskHistoryService`

**File: `src/services/taskHistoryService.ts`**

#### New private members

```typescript
private maxPersistedRecords: number = 200;
private retentionDays: number = 0;
private readonly historyWriteQueue: { workspace: Promise<void>; ndjson: Promise<void> } = {
  workspace: Promise.resolve(),
  ndjson: Promise.resolve(),
};
private ndjsonPath: string | undefined;
```

#### `initialize(context)` changes

1. Load `maxPersistedRecords` and `retentionDays` from configuration.
2. Subscribe to `onDidChangeConfiguration` to reload config.
3. Determine `ndjsonPath` from first workspace folder. If no workspace folders are open,
   `ndjsonPath` remains `undefined` and persistence is silently disabled.
4. Call `await this.loadPersistedHistory()`.
5. On `onDidRecordHistory` event: call `persistRecord(record)` (fire-and-forget — the write
   is enqueued asynchronously; the event handler itself remains synchronous `void`).

#### `loadPersistedHistory()` (new private method)

```
1. Try to read ndjsonPath (vscode.workspace.fs.readFile → TextDecoder)
   - On error: log warning, continue with empty history
2. Split by '\n', parse each line with parseNdjsonLine(), filter nulls
3. Deserialize each to ITaskExecutionRecord
4. Apply retention pruning (filter out records older than retentionDays)
5. Seed historyGroups from deserialized records (sorted newest-first)
6. If any records were pruned, rewrite NDJSON file with pruned set
7. Seed workspaceState from the most recent maxPersistedRecords records
   (trim to cap if NDJSON had more than cap records)
```

#### `persistRecord(record: ITaskExecutionRecord)` (new private method)

```
1. Serialize record → ISerializedTaskExecutionRecord
2. enqueueNdjsonWrite: append serialized line to ndjsonPath
   - Read existing file content (empty bytes if file not found)
   - Ensure .vscode/ directory exists (use vscode.workspace.fs.stat; create if missing)
   - Append new NDJSON line
   - Write full content back
3. enqueueWorkspaceStateWrite:
   a. Read current array from workspaceState (default: [])
   b. Prepend new serialized record (newest-first)
   c. Prune to maxPersistedRecords (drop oldest by startTime)
   d. Write back to workspaceState
```

#### `enqueueNdjsonWrite(serialized)` and `enqueueWorkspaceStateWrite(serialized)`

Both use the same promise-chain queue pattern as `TaskMetricsService.enqueueUpdate()`:

```typescript
this.historyWriteQueue.ndjson = this.historyWriteQueue.ndjson.then(async () => {
  try { await vscode.workspace.fs.writeFile(...); }
  catch (e) { logger.warn(...); }
});
```

For NDJSON, use `vscode.workspace.fs.stat` to check if file exists; if so, read and append;
otherwise create. Append is implemented as read-all + append-line + write-all (VS Code's
`workspace.fs` API has no append mode). An alternative is to buffer pending lines and write them
in a single flush call.

> **Note:** `vscode.workspace.fs` does not provide a streaming/append API. Each NDJSON write
> reads the current file content, appends a line, and rewrites the entire file. For typical
> usage (tens to hundreds of records) this is acceptable. If the file grows very large (thousands
> of records), a future optimisation could switch to Node.js `fs.appendFile` via the `fs` module,
> which is available in the VS Code extension host.

### Phase 4: `TaskHistoryService.clear()` update

`clear()` must become `async` and return `Promise<void>`:

1. Clear `historyGroups` and `activeExecutions` (existing in-memory clear).
2. Enqueue a workspaceState write: set history key to `[]`.
3. Enqueue an NDJSON write: write empty bytes to truncate the file (or delete it).
4. All callers of `clear()` in the extension must be updated to `await clear()`. Search
   for all usages and add `await`; update command handlers to be async if not already.

### Phase 5: `flush()` and `deactivate()`

**`TaskHistoryService`** gains `public flush(): Promise<void>` exposing both queue chains:
```typescript
public flush(): Promise<void> {
  return Promise.all([
    this.historyWriteQueue.workspace,
    this.historyWriteQueue.ndjson,
  ]).then(() => undefined);
}
```

**`src/extension.ts`** gains:
```typescript
export async function deactivate(): Promise<void> {
  await TaskHistoryService.getInstance().flush();
}
```

### Phase 6: Documentation

**File: `docs/features/task-history.md`**

1. Add a "Persistence" section explaining:
   - History now survives restarts.
   - `maxPersistedRecords` and `retentionDays` settings.
   - The NDJSON file location and recommended `.gitignore` entry.

---

## Test Plan

**Target: 100% coverage of all new code.**

### New test file: `src/test/suite/taskHistorySerializer.test.ts`

| Test | Assertion |
|------|-----------|
| `serialize` produces `ISerializedTaskExecutionRecord` with correct fields | correct |
| `serialize` omits `definition` live-object fields beyond `type` and `path` | safe |
| `deserialize` reconstructs `ITaskExecutionRecord` with correct `definition.type` | correct |
| `parseNdjsonLine` returns parsed object for valid JSON | correct |
| `parseNdjsonLine` returns `null` for malformed JSON (no throw) | graceful |
| `parseNdjsonLine` returns `null` for empty string | graceful |

### New test file: `src/test/suite/taskHistoryPersistence.test.ts`

| Test | Assertion |
|------|-----------|
| On `initialize`, no workspace folders open → ndjsonPath undefined, no crash | graceful |
| On `initialize`, NDJSON file does not exist → empty history, no throw | graceful |
| On `initialize`, NDJSON file is empty (zero bytes) → empty history | graceful |
| On `initialize`, NDJSON has valid records → groups populated newest-first | imported |
| On `initialize`, records older than `retentionDays` → excluded, file rewritten | pruned |
| On `initialize`, `retentionDays = 0` → no pruning applied | unlimited |
| On `initialize`, NDJSON has more than `maxPersistedRecords` → workspaceState capped | capped |
| On `initialize`, corrupt NDJSON line skipped; surrounding records loaded | partial |
| Two rapid `onDidRecordHistory` events → second write waits for first (queue serializes) | serialized |
| After a task completes, record appears in workspaceState under history key | persisted |
| After a task completes, record appended to NDJSON file | persisted |
| workspaceState cap exceeded → oldest record dropped | capped |
| `clear()` awaited → empties workspaceState history key | cleared |
| `clear()` awaited → truncates NDJSON file | cleared |
| `clear()` when NDJSON file has been deleted externally → no throw | graceful |
| NDJSON write error → logged as warning, in-memory state unaffected, next write retried | graceful |
| workspaceState write error → logged as warning, in-memory state unaffected | graceful |
| `flush()` resolves after all pending writes complete | flush works |
| `.vscode/` directory does not exist when writing → created automatically | dir creation |
| Config change to `maxPersistedRecords` → next write uses new cap | reactive |

### Updates to existing tests

**`src/test/suite/taskHistoryService.test.ts`**:

1. Existing tests for `handleTaskStart`, `handleTaskProcessEnd`, `handleTaskEnd` must mock
   `vscode.workspace.fs` (read/write file), `context.workspaceState`, and
   `vscode.workspace.workspaceFolders` (previously not needed).
2. Verify `onDidRecordHistory` still fires exactly once per terminal-state transition.
3. Verify that `flush()` resolves after all queued writes complete.

**Callers of `clear()`** — any test that calls `service.clear()` must now `await service.clear()`.

---

## Checklist

- [ ] `src/services/taskHistorySerializer.ts` created
- [ ] `workspaceTasks.history.maxPersistedRecords` setting added to `package.json`
- [ ] `workspaceTasks.history.retentionDays` setting added to `package.json`
- [ ] `TaskHistoryService.initialize()` extended to load config, determine ndjsonPath, seed from NDJSON
- [ ] `TaskHistoryService.persistRecord()` implemented with dual write-queue
- [ ] `TaskHistoryService.clear()` updated to `async`, clears both storage layers
- [ ] `TaskHistoryService.flush()` added
- [ ] `TaskHistoryService` subscribes to `onDidChangeConfiguration` for history settings
- [ ] `extension.ts` `deactivate()` awaits `TaskHistoryService.flush()`
- [ ] All callers of `clear()` updated to `await clear()`
- [ ] `src/test/suite/taskHistorySerializer.test.ts` created (100% coverage)
- [ ] `src/test/suite/taskHistoryPersistence.test.ts` created (100% coverage)
- [ ] `taskHistoryService.test.ts` existing tests updated for new mocking requirements
- [ ] `docs/features/task-history.md` updated with persistence section

## Post-Review Notes

- **`clear()` is now async** (`Promise<void>`). All callers must be updated.
- **NDJSON is the authoritative source**; `workspaceState` is a performance cache. If NDJSON
  is absent, `workspaceState` is used as fallback; if both absent, history is empty (expected
  first-run state).
- **`retentionDays: 0` = unlimited** (consistent with `TaskMetricsService`).
- **`deactivate()` flush** is required to prevent the last record from being lost on VS Code exit.
- **NDJSON path** is always under the first workspace folder. Multi-root workspaces share a
  single file; per-record `scope` field disambiguates which folder each record belongs to.
