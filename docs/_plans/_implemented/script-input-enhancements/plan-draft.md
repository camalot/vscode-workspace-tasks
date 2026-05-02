# Plan: Script Input Parameter Parsing Enhancements (E1, E2)

**Status:** Draft (pre rubber-duck review)
**Area:** Task Execution / Shell Script Provider

---

## 1. Overview

This plan covers two enhancements that improve the "Run with Args" experience for script-type tasks by parsing the script file to discover declared parameters, then presenting a structured input UI instead of a plain free-text prompt.

| # | Enhancement | Provider | Complexity |
|---|---|---|---|
| E1 | Parse PowerShell `param()` blocks | Shell (pwsh) | Medium |
| E2 | Parse Python `argparse` declarations | Shell (python) | High |

---

## 2. User Experience Goal

**Current state:** Clicking "Run with Args" shows a single free-text input box:
```
Enter arguments for task 'deploy.ps1'
```

**Target state:** The extension detects script parameters and shows guided input:
```
$Environment (string, required):  [____________________]
$Configuration (Debug/Release):   [Quick Pick]
$DryRun (switch):                 [Yes / No]
```

When the user completes all inputs, the extension assembles the correct argument string and runs the task.

---

## 3. Architecture

### 3.1 Script Parameter Parser Interface

Create a new module `src/libs/scriptParameterParser.ts` with a shared interface:

```typescript
export interface ScriptParameter {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool' | 'switch' | 'unknown';
  required: boolean;
  defaultValue?: string;
  choices?: string[];  // ValidateSet / argparse choices
  description?: string;
}

export interface ParameterParseResult {
  supported: boolean;        // false = parser can't handle this file
  parameters: ScriptParameter[];
}

export interface ScriptParameterParser {
  parse(content: string): ParameterParseResult;
}
```

### 3.2 PowerShell Parser (E1)

**File:** `src/libs/scriptParameterParsers/powershellParameterParser.ts`

Regex-based parser that scans for `param(...)` blocks:

```
param\s*\(
  # Parameter attributes like [Parameter(Mandatory=$true)]
  # Type declarations like [string], [int], [ValidateSet(...)]
  # Parameter name $Name
  # Optional default value = 'value'
\)
```

**Parsing strategy:**
1. Find the `param(...)` block boundaries (track parenthesis depth)
2. Split on commas (respecting nested `()` for `ValidateSet`)
3. For each parameter declaration:
   - Extract `[Parameter(Mandatory=$true)]` → `required: true`
   - Extract `[ValidateSet('a','b','c')]` → `choices: ['a','b','c']`
   - Extract `[string]`, `[int]`, `[switch]` → `type`
   - Extract `$Name` → `name`
   - Extract `= 'default'` → `defaultValue`

**Example input:**
```powershell
param(
    [Parameter(Mandatory=$true)]
    [string]$Environment,

    [Parameter(Mandatory=$false)]
    [ValidateSet('Debug','Release')]
    [string]$Configuration = 'Release',

    [switch]$DryRun
)
```

**Parsed output:**
```json
[
  { "name": "Environment", "type": "string", "required": true },
  { "name": "Configuration", "type": "string", "required": false,
    "defaultValue": "Release", "choices": ["Debug", "Release"] },
  { "name": "DryRun", "type": "switch", "required": false }
]
```

### 3.3 Python argparse Parser (E2)

**File:** `src/libs/scriptParameterParsers/pythonParameterParser.ts`

Regex-based parser that scans for `add_argument(...)` calls:

**Parsing strategy:**
1. Detect presence of `import argparse` or `from argparse import` → `supported: true`
2. Find `parser.add_argument(...)` calls (or `ArgumentParser().add_argument(...)`)
3. For each call:
   - Extract argument names (`'--env'`, `'-e'`, `'positional'`)
   - Extract `type=int`, `type=float` → type
   - Extract `required=True/False`
   - Extract `default=...`
   - Extract `choices=[...]`
   - Extract `help=...` → description
   - Detect `action='store_true'` / `'store_false'` → `type: 'bool'`

**Example input:**
```python
parser = argparse.ArgumentParser()
parser.add_argument('--env', choices=['dev', 'staging', 'prod'], required=True)
parser.add_argument('--dry-run', action='store_true')
parser.add_argument('--count', type=int, default=1)
```

**Limitations (documented):**
- Dynamic argument construction (e.g., `for arg in config: parser.add_argument(arg)`) is not supported
- `click`, `typer`, `docopt` are not supported in initial version
- Arguments added in functions other than the top-level script scope may be missed

---

## 4. Input UI Integration

### 4.1 New Command: `workspaceTasks.editor.runTaskWithGuidedArgs`

Create a new command that:
1. Reads the task item's associated script file
2. Runs the appropriate parameter parser based on file extension
3. If `supported: true` and parameters found → shows guided multi-step input
4. If `supported: false` or no parameters found → falls back to the existing free-text input box

### 4.2 Guided Input Flow

```typescript
async function collectGuidedArgs(params: ScriptParameter[]): Promise<string | undefined> {
  const argParts: string[] = [];

  for (const param of params) {
    let value: string | undefined;

    if (param.choices) {
      // Show QuickPick for parameters with defined choices
      const picked = await vscode.window.showQuickPick(param.choices, {
        placeHolder: `${param.name}${param.required ? ' (required)' : ''}`,
        title: param.description,
      });
      if (picked === undefined && param.required) { return undefined; } // cancelled
      value = picked;
    } else if (param.type === 'switch' || param.type === 'bool') {
      // Show Yes/No for boolean/switch parameters
      const picked = await vscode.window.showQuickPick(['true', 'false'], {
        placeHolder: `${param.name} (switch)`,
      });
      value = picked;
    } else {
      // Show text input for other parameter types
      value = await vscode.window.showInputBox({
        prompt: `${param.name}${param.description ? `: ${param.description}` : ''}`,
        placeHolder: param.defaultValue || `Enter ${param.type} value`,
        value: param.defaultValue,
      });
      if (value === undefined && param.required) { return undefined; }
    }

    if (value !== undefined && value !== '') {
      argParts.push(buildArgString(param, value)); // e.g., "-Environment 'prod'" or "--env prod"
    }
  }

  return argParts.join(' ');
}
```

### 4.3 Arg String Format

- **PowerShell:** `-ParamName Value` for strings, `-SwitchName` (no value) for switches
- **Python:** `--arg-name value` for options, bare value for positional args

---

## 5. Configuration

Add a new configuration option:
```json
"workspaceTasks.task.guidedArgInput": {
  "type": "boolean",
  "default": true,
  "description": "When running scripts with args, attempt to parse the script for parameter declarations and show guided input prompts."
}
```

When `false`, the existing free-text input is always used.

---

## 6. Implementation Plan

### Phase 1: PowerShell Parser (E1)
1. Create `src/libs/scriptParameterParsers/powershellParameterParser.ts`
2. Unit test with various `param()` block patterns
3. Wire into `RunActiveEditorTaskWithArgsCommand` for `.ps1` files

### Phase 2: Python Parser (E2)
1. Create `src/libs/scriptParameterParsers/pythonParameterParser.ts`
2. Unit test with various `argparse` patterns
3. Wire into `RunActiveEditorTaskWithArgsCommand` for `.py` files

### Phase 3: Integration
1. Create shared `ScriptParameterParser` interface in `src/libs/scriptParameterParser.ts`
2. Create `src/libs/guidedArgInput.ts` for the guided UI flow
3. Add configuration key to `package.json`
4. Update `RunActiveEditorTaskWithArgsCommand` to use guided flow when available
5. Update `src/commands/runTaskWithArgs.ts` for consistency

---

## 7. Testing Plan

### E1 — PowerShell
| Test | Description |
|---|---|
| T01 | Parses mandatory string parameter |
| T02 | Parses optional string with default value |
| T03 | Parses ValidateSet choices |
| T04 | Parses [switch] parameter |
| T05 | Returns `supported: false` for scripts without `param()` |
| T06 | Handles multi-line param block |
| T07 | Handles param block with comments |

### E2 — Python
| Test | Description |
|---|---|
| T08 | Detects `import argparse` → `supported: true` |
| T09 | Parses `add_argument` with `choices` |
| T10 | Parses `add_argument` with `type=int` |
| T11 | Parses `add_argument` with `required=True` |
| T12 | Parses `action='store_true'` as bool/switch type |
| T13 | Returns `supported: false` for scripts without argparse |
| T14 | Does not crash on dynamic argument construction |

---

## 8. Documentation Plan

This is a user-visible change. Documentation is required:

**New documentation pages:**
- `docs/features/guided-arg-input.md` — describes the feature, shows examples
- Update `docs/task-types/shell-script.md` — mention guided args for pwsh and python

**README:** Add a mention of guided argument input for script tasks

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Complex `param()` / `add_argument` patterns not parsed | Fall back to free-text input; log a debug message |
| Performance: parsing large script files on every "run with args" | Parse is O(n) regex; cache result per file URI + mtime |
| User finds guided input annoying | Add `workspaceTasks.task.guidedArgInput: false` config to opt out |
| Wrong argument format passed to script | Test thoroughly; document format; allow user to edit assembled arg string before running |
