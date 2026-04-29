# Plan: Script Input Parameter Parsing Enhancements (E1, E2)

**Status:** Final (post rubber-duck review)
**Area:** Task Execution / Shell Script Provider

---

## 1. Rubber-Duck Review Summary

The sub-agent identified significant concerns with the draft's approach to static regex parsing of script files. Key changes were incorporated:

| Issue | Severity | Resolution |
|---|---|---|
| **C1** Regex parsing of PowerShell `param()` and Python `argparse` is fragile at scale | High | Adopted — scope initial version to simple patterns only; document known unsupported patterns; ship behind config flag |
| **C2** Security risk: guided input assembled into shell command strings unsafely | Critical | Adopted — use structured argument arrays (not string concatenation) end-to-end; never construct shell command strings by concatenating user input |
| **C3** Python `argparse`: subparsers, inherited parsers, dynamic construction not supported | High | Acknowledged — documented as known limitations; out of scope for v1 |
| **C4** PowerShell: parameter sets, advanced attributes, complex default expressions | High | Acknowledged — documented as known limitations; v1 supports simple `param()` block patterns only |
| **C5** No parser fixture suite for real-world scripts | Medium | Adopted — test plan updated to include real-world-inspired fixtures |
| **C6** No security tests for escaping and injection | High | Adopted — added §8 Security section; argument passing uses VS Code's `ShellExecution` array form |
| **C7** Keep free-text as default; ship guided input as opt-in behind config flag | Medium | Adopted — feature defaults to `false` (opt-in); guided input only enabled when `workspaceTasks.task.guidedArgInput: true` |
| **C8** Defer until after critical bug fixes | Medium | Adopted — this is a **new feature**, not a bug fix; must be implemented AFTER all critical fixes land |

Issues **not adopted:**
| Issue | Reason |
|---|---|
| Use `python script.py --help` output for arg discovery | Running user scripts at discovery time is not acceptable; static parse only |
| Parser confidence scores gating UI display | Adds UI complexity; the `supported` flag in `ParameterParseResult` is sufficient for v1 |

**Post-review addition (E1):** `pwsh -Command Get-Help <script>` is now adopted as the **primary** PowerShell parameter discovery strategy. Unlike executing the user's script, `Get-Help` only introspects the script's `param()` block and comment-based help without running any script logic. Static regex parsing is retained as the fallback when `pwsh` is unavailable, the workspace is untrusted, or `Get-Help` fails. Workspace trust (`vscode.workspace.isTrusted`) must be checked before spawning any process — if the workspace is not trusted, the implementation falls directly to static parsing.

---

## 2. Overview

Two enhancements that improve the "Run with Args" experience for `.ps1` (PowerShell) and `.py` (Python) script tasks by parsing the script file to discover declared parameters.

| # | Enhancement | File Types | Priority |
|---|---|---|---|
| E1 | Parse PowerShell `param()` blocks | `.ps1` | Medium |
| E2 | Parse Python `argparse` declarations | `.py` | Medium |

**Feature flag:** Both enhancements are gated by `workspaceTasks.task.guidedArgInput: false` (disabled by default).

**Implementation gate:** Must be implemented after all I-series bug fixes are complete.

---

## 3. Architecture

### 3.1 Script Parameter Parser Interface

**File:** `src/libs/scriptParameterParser.ts`

```typescript
export interface ScriptParameter {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool' | 'switch' | 'unknown';
  required: boolean;
  defaultValue?: string;
  choices?: string[];       // ValidateSet / argparse choices
  description?: string;
  cliName?: string;         // For Python: '--arg-name' (may differ from variable name)
}

export interface ParameterParseResult {
  supported: boolean;       // false = parser cannot handle this file; fall back to free-text
  parameters: ScriptParameter[];
}

export interface ScriptParameterParser {
  canHandle(filePath: string): boolean;
  /**
   * Runtime discovery: may spawn an external process (e.g. `pwsh Get-Help`).
   * Implementations that do not support runtime discovery should return
   * `{ supported: false, parameters: [] }` so the caller falls back to `parse()`.
   * Must only be called when `vscode.workspace.isTrusted` is true.
   */
  discover?(filePath: string): Promise<ParameterParseResult>;
  /** Static/offline parse of the raw file content. Always available. */
  parse(content: string): ParameterParseResult;
}
```

### 3.2 PowerShell Parser (E1)

**File:** `src/libs/scriptParameterParsers/powershellParameterParser.ts`

#### 3.2.1 Primary strategy — `Get-Help` via `pwsh`

When the workspace is trusted (`vscode.workspace.isTrusted === true`) and `pwsh` is available on the system PATH, the parser uses runtime introspection as the primary discovery mechanism:

```
pwsh -NoProfile -NonInteractive -Command "Get-Help '<absoluteScriptPath>' -Detailed"
```

- `Get-Help` reads the script's `param()` block and comment-based help (`.SYNOPSIS`, `.PARAMETER`) **without executing any script logic**.
- The output is parsed to extract parameter names, types, mandatory status, and descriptions.
- The script path is passed as a **literal absolute path** — never concatenated from user-supplied strings.
- If the workspace is **not trusted**, this step is skipped entirely and falls through to static parsing.
- If `pwsh` is not found on PATH, or the subprocess exits non-zero, falls through to static parsing.
- Timeout: 5 seconds; if exceeded, process is killed and falls through to static parsing.

**`Get-Help` output example:**
```
SYNTAX
    pwsh-params.ps1 [-Environment] <string> [[-Configuration] <string>] [-DryRun] [<CommonParameters>]
```

The syntax line is parsed with a regex to extract:
- `[-ParamName]` → optional parameter
- `[-ParamName] <type>` → positional/named with type
- `[[-ParamName] <type>]` → optional with type
- `-ParamName` (no surrounding `[]`) → mandatory
- `[-SwitchName]` with no `<type>` → switch

Additionally, the `PARAMETERS` section of `-Detailed` output is parsed for per-parameter metadata (required, description, accepted values).

#### 3.2.2 Fallback strategy — Static regex parsing

Used when: workspace is not trusted, `pwsh` is unavailable, `Get-Help` subprocess fails, or output cannot be parsed.

**Supported patterns (v1):**
- `param(...)` block at file scope
- `[Parameter(Mandatory=$true)]` / `[Parameter(Mandatory=$false)]` / `[Parameter(Mandatory)]`
- `[ValidateSet('a','b','c')]`
- Type declarations: `[string]`, `[int]`, `[bool]`, `[switch]`, `[double]`
- `$Name` variable declarations
- `= 'default'` default values (string literals only)

**Unsupported by static parser (documented):**
- Parameter sets (`ParameterSetName`)
- Pipeline input (`ValueFromPipeline`)
- Complex default expressions (`= (Get-Date)`)
- Nested `param()` blocks in functions
- Dynamic parameter blocks (`DynamicParam`)

### 3.3 Python Parser (E2)

**File:** `src/libs/scriptParameterParsers/pythonParameterParser.ts`

**Supported patterns (v1):**
- `import argparse` / `from argparse import ArgumentParser` detection
- `parser.add_argument('--name', ...)` call patterns
- `type=int`, `type=float`, `type=str` → type mapping
- `required=True/False`
- `default=...` (string and numeric literals only)
- `choices=[...]` (string list literals only)
- `action='store_true'` / `'store_false'` → bool type
- `help='...'` → description
- Short form `-n` / long form `--name` (uses long form as canonical name)

**Unsupported (documented):**
- `argparse.ArgumentParser(parents=[...])` (inherited parsers)
- `add_subparsers()` / subcommands
- `add_mutually_exclusive_group()`
- Dynamic `add_argument` calls (inside loops/conditionals)
- `click`, `typer`, `docopt` libraries

---

## 4. Security: Argument Construction

**Critical requirement:** Arguments must NEVER be assembled via string concatenation and passed to a shell. Instead:

1. Collect guided input values as typed strings.
2. Pass them as an **array** to `vscode.ShellExecution`:
   ```typescript
   new vscode.ShellExecution(interpreter, [...existingArgs, '-MyParam', value])
   ```
3. VS Code's `ShellExecution` handles platform-appropriate quoting.
4. For PowerShell switches (`-DryRun`), pass as a bare flag: `['-DryRun']` (no value).
5. Validate `choices` input server-side (ensure selected value is in the allowed list) before passing.

This approach is consistent with the existing `splitArgs` utility in `taskCreationUtils.ts`.

---

## 5. Input UI Flow

**File:** `src/libs/guidedArgInput.ts`

```typescript
export async function collectGuidedArgs(
  params: ScriptParameter[],
  taskName: string
): Promise<string[] | undefined> {
  const argParts: string[] = [];

  for (const param of params) {
    let value: string | undefined;

    if (param.choices && param.choices.length > 0) {
      const picked = await vscode.window.showQuickPick(param.choices, {
        placeHolder: `${param.name}${param.required ? ' (required)' : ''}`,
        title: `${taskName} — ${param.description || param.name}`,
      });
      if (picked === undefined && param.required) {
        return undefined; // User cancelled required param
      }
      value = picked;
    } else if (param.type === 'switch') {
      // For switches, just ask yes/no
      const include = await vscode.window.showQuickPick(
        [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }],
        { placeHolder: `Include -${param.name}?` }
      );
      value = include?.value === 'true' ? 'flag' : undefined;
    } else {
      value = await vscode.window.showInputBox({
        prompt: `${param.name}${param.description ? ` — ${param.description}` : ''}`,
        placeHolder: param.defaultValue ?? `Enter ${param.type} value`,
        value: param.defaultValue,
      });
      if (value === undefined && param.required) {
        return undefined;
      }
    }

    if (value !== undefined && value !== '') {
      if (param.type === 'switch') {
        argParts.push(`-${param.name}`);         // PowerShell switch
      } else if (param.cliName) {
        argParts.push(param.cliName, value);      // Python: --arg-name value
      } else {
        argParts.push(`-${param.name}`, value);   // PowerShell: -Name value
      }
    }
  }

  return argParts;
}
```

---

## 6. Configuration

**File:** `package.json` contributions

```json
"workspaceTasks.task.guidedArgInput": {
  "type": "boolean",
  "default": false,
  "markdownDescription": "When enabled, running script tasks with arguments will attempt to parse the script for parameter declarations and show guided input prompts. Currently supported for PowerShell (`.ps1`) and Python (`.py`) scripts using `argparse`. Falls back to free-text input when parameters cannot be detected."
}
```

**Placement:** Under the `workspaceTasks.task` configuration group (display section).

---

## 7. Integration with RunActiveEditorTaskWithArgsCommand

**File:** `src/commands/runActiveEditorTaskWithArgs.ts`

When `guidedArgInput` is enabled, attempt guided input before falling back:

```typescript
async run(): Promise<void> {
  // ... existing task selection logic ...

  const confirmed = await TaskRunGuardService.getInstance().confirmIfNeeded(item);
  if (!confirmed) { return; }

  const configService = TaskConfigService.getInstance();
  let args: string | undefined;

  if (configService.get<boolean>('task.guidedArgInput')) {
    const argArray = await this.tryGuidedInput(item);
    if (argArray !== undefined) {
      // Pass as array form through metadata for TaskFactory
      await TaskRunner.getInstance().runTask(item, argArray.join(' '), true);
      return;
    }
    // Fall through to free-text if guided failed or was skipped
  }

  args = await vscode.window.showInputBox({
    prompt: `Enter arguments for task '${item.label}'`,
    placeHolder: 'Arguments',
  });
  if (args !== undefined) {
    await TaskRunner.getInstance().runTask(item, args, true);
  }
}

private async tryGuidedInput(item: TaskItem): Promise<string[] | undefined> {
  const fileUri = item.taskFileUri;
  if (!fileUri) { return undefined; }

  const parser = getParserForFile(fileUri.fsPath); // factory returns appropriate parser
  if (!parser) { return undefined; }

  let result: ParameterParseResult | undefined;

  // Attempt runtime discovery first (e.g. Get-Help for PowerShell).
  // Only permitted when the workspace is trusted.
  if (parser.discover && vscode.workspace.isTrusted) {
    try {
      result = await parser.discover(fileUri.fsPath);
    } catch {
      // Subprocess failed — fall through to static parse.
    }
  }

  // Fall back to static parsing if runtime discovery was skipped or failed.
  if (!result?.supported || result.parameters.length === 0) {
    const content = await vscode.workspace.fs.readFile(fileUri);
    result = parser.parse(new TextDecoder().decode(content));
  }

  if (!result.supported || result.parameters.length === 0) { return undefined; }

  return collectGuidedArgs(result.parameters, item.label as string);
}
```

---

## 8. Implementation Order

### Phase 1 — Foundation
1. Create `src/libs/scriptParameterParser.ts` (interface)
2. Create `src/libs/guidedArgInput.ts` (UI flow, accepting string arrays)
3. Add `workspaceTasks.task.guidedArgInput` to `package.json`

### Phase 2 — PowerShell (E1)
1. Create `src/libs/scriptParameterParsers/powershellParameterParser.ts`
   - Implement `discover(filePath)`: spawns `pwsh -NoProfile -NonInteractive -Command "Get-Help '<path>' -Detailed"` and parses the output
   - Check workspace trust before spawning; skip to static parse if untrusted
   - Detect `pwsh` availability via PATH lookup before spawning
   - Enforce 5-second timeout; kill process on timeout
   - Implement `parse(content)` static regex fallback
2. Write unit tests (see §9)
3. Wire into `RunActiveEditorTaskWithArgsCommand`

### Phase 3 — Python (E2)
1. Create `src/libs/scriptParameterParsers/pythonParameterParser.ts`
2. Write unit tests
3. Wire into `RunActiveEditorTaskWithArgsCommand`

---

## 9. Testing Plan

### E1 — PowerShell (`Get-Help` / runtime discovery)
| Test | Description |
|---|---|
| T01 | `discover()` — parses mandatory string parameter from `Get-Help` output |
| T02 | `discover()` — parses optional parameter with default value from `Get-Help` output |
| T03 | `discover()` — parses switch parameter (no `<type>` token) from syntax line |
| T04 | `discover()` — `Get-Help` subprocess exits non-zero → returns `{ supported: false }` |
| T05 | `discover()` — subprocess times out → process killed; returns `{ supported: false }` |
| T06 | `discover()` — workspace not trusted → method is not called (caller skips) |
| T07 | `discover()` — `pwsh` not on PATH → returns `{ supported: false }` |

### E1 — PowerShell (static fallback)
| Test | Description |
|---|---|
| T08 | Parses mandatory string parameter |
| T09 | Parses optional string with string default value |
| T10 | Parses `[ValidateSet('Debug','Release')]` choices |
| T11 | Parses `[switch]` parameter (type = switch, required = false) |
| T12 | Script without `param()` → `supported: false` |
| T13 | Multi-line `param()` block across many lines |
| T14 | Comment inside `param()` block does not confuse parser |
| T15 | Task name with special characters in parameter default |
| T16 | `canHandle('.ps1')` returns true; `canHandle('.py')` returns false |

### E2 — Python
| Test | Description |
|---|---|
| T17 | `import argparse` → `supported: true` |
| T18 | `from argparse import ArgumentParser` → `supported: true` |
| T19 | `add_argument` with `choices=[...]` → choices populated |
| T20 | `add_argument` with `type=int` → `type: 'int'` |
| T21 | `add_argument` with `required=True` → `required: true` |
| T22 | `action='store_true'` → `type: 'bool'` |
| T23 | `help='description'` → `description` populated |
| T24 | Script without `argparse` → `supported: false` |
| T25 | Dynamic `add_argument` in a loop → does not crash; may miss arguments (acceptable) |
| T26 | `canHandle('.py')` returns true; `canHandle('.ps1')` returns false |

### Integration
| Test | Description |
|---|---|
| T27 | When `guidedArgInput: false`, free-text input is used regardless of script type |
| T28 | When `guidedArgInput: true` and `discover()` succeeds, guided input is shown |
| T29 | When `guidedArgInput: true` and `discover()` returns `supported: false`, falls back to static parse |
| T30 | When `guidedArgInput: true` and both discovery strategies fail, free-text is used |
| T31 | Cancelling a required parameter guided prompt → task is not run |
| T32 | Workspace not trusted + `.ps1` task → `discover()` is never called; static parse is used |

---

## 10. Documentation Plan

**New documentation:**
- `docs/features/guided-arg-input.md` — Feature overview, supported patterns, examples
- Update `docs/task-types/shell-script.md` — Mention guided args for pwsh and python

**README:** Add brief mention in the task execution features section.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Parser misidentifies parameters | Feature is opt-in (default: false); falls back to free-text on failure |
| Shell injection via assembled args | Use array form `ShellExecution(cmd, argsArray)`; never string-concatenate user input |
| `pwsh` not installed on host machine | Detect via PATH lookup before spawning; silently fall back to static parsing |
| Script path injected into `Get-Help` command | Script path is passed as a fixed absolute path derived from the workspace URI, not from user input |
| `Get-Help` slow or hanging | Enforce a 5-second timeout; kill child process on timeout; fall through to static parsing |
| Workspace not trusted — spawning blocked | Check `vscode.workspace.isTrusted` before any `child_process.spawn`; static parse used for untrusted workspaces |
| Python argparse patterns not recognized | Falls back to free-text; document known limitations |
| UX friction for scripts with many parameters | Show maximum 10 params in guided mode; remainder available as free-text |
