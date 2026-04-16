# Plan: Task History Export (CSV and JSON)

## TL;DR

Add two export actions to the Task History panel — **Export as CSV** and **Export as JSON** —
accessible from the History tab toolbar and via the Command Palette. CSV export presents a
Save dialog and writes a spreadsheet-ready file at the chosen location. JSON export writes a
structured file to `.vscode/task-history-export.json` and opens it in the editor. Both actions
export the full persisted history (requires the Persistent Task History feature to be most
useful; see the Persistent Task History plan for details on `task-history.ndjson`).

---

## Background

The Task History tab (`taskHistoryTableViewProvider.ts`) renders records from
`TaskHistoryService.getAllExecutions()`. Records are currently session-only (no persistence), but
the Persistent Task History plan adds NDJSON-backed storage. Export is most useful after that
plan is implemented. The export feature is designed to work with whatever records the service
returns — whether they come from in-memory session data or the loaded NDJSON archive.

The webview (`taskHistory.html`) communicates with the extension host via `postMessage`. The
export commands are surfaced both as tree-view title bar buttons and as Command Palette entries,
to support keyboard-first and mouse-first users.

---

## Requirements

1. **Export as CSV**: Serialises all records returned by `TaskHistoryService.getAllExecutions()`
   to RFC 4180 CSV, prompts the user with `vscode.window.showSaveDialog()` for a file location,
   and writes the file with `vscode.workspace.fs.writeFile()`.
2. **Export as JSON**: Writes all records as a structured JSON array to a user-chosen location
   via `vscode.window.showSaveDialog()` (consistent with CSV export — no silent fixed path).
3. Both exports include all currently available records (from the in-memory service; if the
   Persistent Task History plan is implemented, this includes all persisted records).
4. If there are no records to export, show an informational message and return without writing.
5. Both commands are registered in `package.json` and appear in the Command Palette under
   "Workspace Tasks: Export History as CSV" and "Workspace Tasks: Export History as JSON".
6. Both commands are accessible from the History tab toolbar (both view modes: tree and table).
   The `view/title` menu entries must cover both view IDs:
   - `workspaceTasksHistoryView` (tree mode)
   - `workspaceTasksHistoryTableView` (table/webview mode)
7. CSV column order: `Status`, `Task`, `Type`, `Source`, `Timestamp`, `Exit Code`, `Duration (ms)`.
8. CSV values containing commas, double quotes, or newlines are properly escaped per RFC 4180.
9. CSV values that begin with `=`, `+`, `-`, or `@` are prefixed with a single quote (`'`) to
   prevent formula injection when opened in spreadsheet applications (Excel, LibreOffice).
10. CSV files are written with a UTF-8 BOM (`\uFEFF`) to ensure correct character display in
    Excel on Windows.
11. JSON export uses the `ISerializedTaskExecutionRecord` shape from the Persistent Task History
    plan. If that plan is not yet implemented, use an inline-defined equivalent. The `definition`
    field of `ITaskExecutionRecord` must be stripped to `definitionType`/`definitionPath` only
    to avoid leaking arbitrary provider-added fields (which may contain secrets).
12. Both `run()` methods wrap all async operations in a `try/catch` with
    `vscode.window.showErrorMessage` on failure.
13. 100% test coverage for all new code.

> **Dependency:** This feature is most useful after the **Persistent Task History** plan is
> implemented. Without persistence, exports contain only the current session's records.

---

## Key Design Decisions

### Commands, not webview messages

Export is triggered via VS Code commands (not webview `postMessage`). This means:
- Export works whether the webview is visible or not.
- Commands appear in the Command Palette without requiring the webview to be open.
- The toolbar buttons are `view/title` menu entries that fire VS Code commands.

### Both exports use `showSaveDialog`

Using `vscode.window.showSaveDialog()` for both CSV and JSON ensures consistent UX: the user
always chooses the destination. There is no silent fixed-path write.

### Two `view/title` menu registrations per command

The History panel has two mutually exclusive view modes, each with its own registered view:
- Tree mode: `workspaceTasksHistoryView`
- Table/webview mode: `workspaceTasksHistoryTableView`

Each export command needs **two** `view/title` menu entries (one per view ID) to appear in
the toolbar regardless of which mode is active.

### CSV escaping and safety

- RFC 4180 escaping: values containing `"`, `,`, or `\n` are wrapped in `"..."` and internal
  `"` characters are doubled.
- **Formula injection guard**: values starting with `=`, `+`, `-`, or `@` are prefixed with
  `'` before RFC 4180 quoting is applied, preventing spreadsheet formula evaluation.
- **UTF-8 BOM**: the CSV byte content is prefixed with `\uFEFF` (encoded as `EF BB BF` in
  UTF-8) so Excel on Windows correctly decodes non-ASCII characters.

### JSON export shape

```typescript
interface HistoryExportFile {
  exportedAt: string;    // ISO timestamp
  version: string;       // extension version from package.json (vscode.extensions.getExtension(...).packageJSON.version)
  recordCount: number;
  records: ISerializedTaskExecutionRecord[];
}
```

The `definition` field of `ITaskExecutionRecord` is **not** included in the export — only
`definitionType` and `definitionPath`. This prevents secrets or provider-specific state from
leaking into the exported file.

### Data source: `TaskHistoryService.getAllExecutions()`

Export always reads from the service, not from webview in-memory state. This ensures the export
reflects the full dataset (including persisted records from the NDJSON archive when that plan
is implemented).

---

## Implementation

### Phase 1: CSV serialization utilities

**New file: `src/libs/csvSerializer.ts`**

- `escapeCsvValue(value: string): string` — RFC 4180 escaping + formula injection guard.
  1. If value starts with `=`, `+`, `-`, or `@`, prepend `'`.
  2. If value contains `"`, `,`, or `\n`, wrap in `"..."` and double any internal `"`.
- `recordsToCsv(records: ITaskExecutionRecord[]): string` — produces UTF-8 BOM + header row +
  data rows. Uses `escapeCsvValue` on each cell value.

Column mapping:

| CSV Column | Source field |
|-----------|-------------|
| `Status` | `record.status` |
| `Task` | `record.taskName` |
| `Type` | `record.taskSource` |
| `Source` | `record.definition.path ?? record.definition.cwd ?? ''` |
| `Timestamp` | `new Date(record.startTime).toISOString()` |
| `Exit Code` | `record.exitCode ?? ''` |
| `Duration (ms)` | `record.duration ?? ''` |

### Phase 2: Export commands

**New file: `src/commands/exportTaskHistoryCommand.ts`**

Two exported classes sharing a common base:

```typescript
abstract class BaseExportHistoryCommand extends BaseCommand {
  protected getRecords(): ITaskExecutionRecord[] {
    return TaskHistoryService.getInstance().getAllExecutions();
  }
}

export class ExportHistoryAsCsvCommand extends BaseExportHistoryCommand {
  constructor(context: vscode.ExtensionContext) {
    super('exportHistoryCsv', context);
  }
  async run(): Promise<void> { ... }
}

export class ExportHistoryAsJsonCommand extends BaseExportHistoryCommand {
  constructor(context: vscode.ExtensionContext) {
    super('exportHistoryJson', context);
  }
  async run(): Promise<void> { ... }
}
```

**`ExportHistoryAsCsvCommand.run()`:**
```
1. records ← getRecords()
2. If records is empty → showInformationMessage('No task history records to export.') → return
3. csv ← recordsToCsv(records)  // includes UTF-8 BOM
4. defaultUri ← vscode.Uri.file(path.join(firstWorkspaceFolder ?? os.homedir(), 'task-history.csv'))
5. uri ← await vscode.window.showSaveDialog({ defaultUri, filters: { 'CSV': ['csv'], 'All': ['*'] }, saveLabel: 'Export' })
6. If uri is undefined → return  (user cancelled)
7. await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'))
8. Show "Exported N records" info message with 'Open File' action
   → if clicked: vscode.commands.executeCommand('vscode.open', uri)
```

Wrap all of steps 3–8 in `try/catch (e)` → `vscode.window.showErrorMessage(e.message)`.

**`ExportHistoryAsJsonCommand.run()`:**
```
1. records ← getRecords()
2. If records is empty → showInformationMessage('No task history records to export.') → return
3. defaultUri ← vscode.Uri.file(path.join(firstWorkspaceFolder ?? os.homedir(), 'task-history-export.json'))
4. uri ← await vscode.window.showSaveDialog({ defaultUri, filters: { 'JSON': ['json'], 'All': ['*'] }, saveLabel: 'Export' })
5. If uri is undefined → return  (user cancelled)
6. exportData ← { exportedAt: new Date().toISOString(), version: getExtensionVersion(), recordCount: records.length, records: records.map(serializeRecord) }
   where serializeRecord strips definition to { definitionType, definitionPath } only
7. await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'))
8. await vscode.window.showTextDocument(uri)
```

Wrap all of steps 3–8 in `try/catch (e)` → `vscode.window.showErrorMessage(e.message)`.

`getExtensionVersion()`: `vscode.extensions.getExtension('camalot.workspace-tasks')?.packageJSON?.version ?? 'unknown'`

### Phase 3: Command registration

**File: `src/commands/index.ts`**

Export `ExportHistoryAsCsvCommand` and `ExportHistoryAsJsonCommand`.

**File: `src/extension.ts`**

Register both commands in `activate()`.

### Phase 4: `package.json` contributions

Add two command entries to `contributes.commands`:
```jsonc
{ "command": "workspaceTasks.exportHistoryCsv",  "title": "%command.exportHistoryCsv%",  "category": "%extensionCategory%", "icon": "$(desktop-download)" },
{ "command": "workspaceTasks.exportHistoryJson", "title": "%command.exportHistoryJson%", "category": "%extensionCategory%", "icon": "$(json)" }
```

Add NLS keys to `package.nls.json`:
```jsonc
"command.exportHistoryCsv":  "Export History as CSV",
"command.exportHistoryJson": "Export History as JSON"
```

Add to `contributes.menus` — note **two** `view/title` entries per command (one per view mode):
```jsonc
"view/title": [
  { "command": "workspaceTasks.exportHistoryCsv",  "when": "view == workspaceTasksHistoryView",      "group": "navigation" },
  { "command": "workspaceTasks.exportHistoryCsv",  "when": "view == workspaceTasksHistoryTableView", "group": "navigation" },
  { "command": "workspaceTasks.exportHistoryJson", "when": "view == workspaceTasksHistoryView",      "group": "navigation" },
  { "command": "workspaceTasks.exportHistoryJson", "when": "view == workspaceTasksHistoryTableView", "group": "navigation" }
],
"commandPalette": [
  { "command": "workspaceTasks.exportHistoryCsv"  },
  { "command": "workspaceTasks.exportHistoryJson" }
]
```

### Phase 5: Documentation

**File: `docs/features/task-history.md`**

Add an "Exporting History" section describing both commands and their output formats.

---

## Test Plan

**Target: 100% coverage of all new code.**

### New test file: `src/test/suite/csvSerializer.test.ts`

| Test | Assertion |
|------|-----------|
| `escapeCsvValue` — plain string → returned unchanged | identity |
| `escapeCsvValue` — string with comma → wrapped in `"..."` | RFC 4180 |
| `escapeCsvValue` — string with double quote → doubled and wrapped | RFC 4180 |
| `escapeCsvValue` — string with newline → wrapped in `"..."` | RFC 4180 |
| `escapeCsvValue` — empty string → empty string | no quotes |
| `escapeCsvValue` — starts with `=` → prefixed with `'` | formula guard |
| `escapeCsvValue` — starts with `+` → prefixed with `'` | formula guard |
| `escapeCsvValue` — starts with `-` → prefixed with `'` | formula guard |
| `escapeCsvValue` — starts with `@` → prefixed with `'` | formula guard |
| `escapeCsvValue` — starts with `=` and contains comma → `'` prefix + quotes | combined |
| `recordsToCsv` — empty array → BOM + header row only | no crash |
| `recordsToCsv` — output starts with UTF-8 BOM (`\uFEFF`) | BOM present |
| `recordsToCsv` — single record → BOM + header + one data row | correct |
| `recordsToCsv` — `exitCode` undefined → empty cell | no crash |
| `recordsToCsv` — `duration` undefined → empty cell | no crash |
| `recordsToCsv` — `definition.path` undefined, `definition.cwd` present → cwd used | fallback |
| `recordsToCsv` — `definition.path` and `definition.cwd` both undefined → empty cell | fallback |
| `recordsToCsv` — column order matches specification | correct order |
| `recordsToCsv` — timestamp is ISO string | correct format |

### New test file: `src/test/suite/commands/exportTaskHistoryCommand.test.ts`

| Test | Assertion |
|------|-----------|
| CSV: no records → info message shown, `showSaveDialog` not called | guard |
| CSV: records present, user cancels dialog → no file written | cancel |
| CSV: records present, user confirms → file written to chosen URI | written |
| CSV: written file content starts with UTF-8 BOM | BOM |
| CSV: written file content has correct header row | correct |
| CSV: written file includes task name and status in data row | correct |
| CSV: "Exported N records" info message shown after write | notification |
| CSV: "Open File" button clicked → `vscode.open` command fired | opens |
| CSV: `writeFile` throws → `showErrorMessage` called with error message | error handling |
| CSV: `showSaveDialog` throws → `showErrorMessage` called | error handling |
| JSON: no records → info message shown, `showSaveDialog` not called | guard |
| JSON: records present, user confirms → file written to chosen URI | written |
| JSON: export object has `exportedAt`, `version`, `recordCount`, `records` fields | shape |
| JSON: `records` entries have `definitionType` but NOT a full `definition` object | secrets stripped |
| JSON: file opened in text editor after write | opens |
| JSON: user cancels save dialog → no file written | cancel |
| JSON: `writeFile` throws → `showErrorMessage` called | error handling |

---

## Checklist

- [ ] `src/libs/csvSerializer.ts` created (RFC 4180 + formula guard + BOM)
- [ ] `src/commands/exportTaskHistoryCommand.ts` created with both command classes
- [ ] Both commands registered in `src/commands/index.ts`
- [ ] Both commands registered in `src/extension.ts`
- [ ] `package.json` `contributes.commands` entries added (using NLS keys)
- [ ] `package.nls.json` NLS keys added for both command titles
- [ ] `package.json` `contributes.menus` view/title entries: 2 per command × 2 view IDs = 4 entries
- [ ] `package.json` `contributes.menus.commandPalette` entries added
- [ ] `src/test/suite/csvSerializer.test.ts` created (100% coverage)
- [ ] `src/test/suite/commands/exportTaskHistoryCommand.test.ts` created (100% coverage)
- [ ] `docs/features/task-history.md` updated with export section

## Post-Review Notes

- **View IDs corrected:** `view/title` `when` clauses use `workspaceTasksHistoryView` and
  `workspaceTasksHistoryTableView` — not `workspaceTasks.history` (which does not exist).
  Two entries per command are required.
- **JSON export uses `showSaveDialog`** (same as CSV) — no silent fixed-path write.
- **Formula injection guard** added to `escapeCsvValue` for values starting with `=`, `+`,
  `-`, or `@`.
- **UTF-8 BOM** added to CSV output for Excel compatibility.
- **`exportedBy` replaced with `version`** (obtained from `vscode.extensions.getExtension`).
- **`definition` field stripped** from JSON export records to prevent leaking provider-specific
  state or secrets.
- **Dependency on Persistent Task History** (Idea 3) is declared — export is most useful
  after that plan is implemented.
