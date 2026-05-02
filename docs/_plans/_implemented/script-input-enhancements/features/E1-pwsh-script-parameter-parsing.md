# Feature Request: PowerShell Script Enhancement to Parse Script Inputs

**Type:** Enhancement
**Labels:** enhancement, needs-triage
**Area:** Task Execution, PowerShell/pwsh provider

---

## Problem Statement

When running a PowerShell (`.ps1`) script as a task, the user must know the expected script parameters in advance and pass them manually through the "Run with Args" prompt. The extension has no knowledge of what parameters the script accepts, making it difficult to discover or correctly supply inputs. Users must open the script file separately to identify its parameters.

---

## Proposed Solution

Parse the PowerShell script file to identify declared `param()` block parameters before running with args. When the user invokes **Run with Args**, instead of (or in addition to) showing a generic free-text input prompt, the extension should:

1. Parse the `param(...)` block in the `.ps1` file to extract parameter names, types, default values, and optionally `[ValidateSet(...)]` constraints.
2. Present a structured input UI (e.g., multiple `showInputBox` calls, one per required parameter, or a `QuickPick` for parameters with `ValidateSet`).
3. Assemble the structured inputs into a properly formatted argument string for the script.

---

## Alternatives Considered

- Continue using the current free-text "Run with Args" input with no change (poor discoverability).
- Show a notification message listing parameters found in the script (improvement without requiring full input parsing).
- Parse parameters only for display/documentation purposes without structured input.

---

## Feature Area

- [x] Task Execution
- [x] Task Types/Providers

---

## Priority

Medium - Would be nice to have

---

## Use Case

In a CI/CD or DevOps environment, PowerShell scripts often have many parameters with specific types and allowed values. Being able to discover and fill in parameters from the editor without opening the script would significantly improve the developer experience:

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

---

## Examples

**Parsed from script → structured prompt:**
- `$Environment` (string, mandatory) → text input box
- `$Configuration` (ValidateSet: Debug/Release) → quick pick
- `$DryRun` (switch) → checkbox/quick pick Yes/No

---

## Additional Context

This enhancement would be scoped to the `ShellTaskProvider` (specifically for PowerShell/pwsh shell type). The parsing would be done statically using regex or a simple AST approach on the `.ps1` file content before execution. No PowerShell runtime is required for the parsing step.
