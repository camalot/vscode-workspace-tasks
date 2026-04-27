---
layout: default
title: 🐚 PowerShell Scripts
parent: 📜 Scripts & Other
grand_parent: 📱 Supported Task Types
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# PowerShell Scripts — Guided Argument Input
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

When `workspaceTasks.task.guidedArgInput` is enabled, running a PowerShell (`.ps1`) script with
**Run with Args** prompts you for each parameter individually instead of asking for a raw argument
string.

The extension uses **two resolvers** to discover parameters from your script:

| Resolver | Method | Workspace trust required |
| --- | --- | --- |
| **`PwshGetHelpResolver`** (primary) | Executes `pwsh -NoProfile -NonInteractive -Command "Get-Help '<path>' -Detailed"` and parses the output | Yes |
| **`PwshStaticParamBlockResolver`** (fallback) | Reads the script file and regex-parses the `param(...)` block | No |

The primary resolver runs first. If it succeeds and returns at least one parameter, the fallback
is not used. If the workspace is **not trusted**, only the static fallback runs.

{: .note }
Guided argument input is **disabled by default**. Enable it in Settings:
`workspaceTasks.task.guidedArgInput: true`.

---

## Enabling

In VS Code Settings (`Ctrl+,` / `Cmd+,`) search for **guidedArgInput**, or add to your
`settings.json`:

```json
"workspaceTasks.task.guidedArgInput": true
```

---

## Parameter Type Mapping

The extension maps PowerShell parameter types to the appropriate VS Code UI:

| PowerShell type | UI shown |
| --- | --- |
| `[switch]` | Yes / No QuickPick |
| `[ValidateSet(...)]` attribute | QuickPick of the defined values |
| `[string]`, `[int]`, `[double]`, and others | Single input box |
| `Mandatory = $true` | Input is required — aborting cancels execution |
| Default value | Input box pre-filled with the default |

---

## Supported Parameter Patterns

### Basic parameter types

```powershell
param(
    # Mandatory string — input box, aborting cancels execution
    [Parameter(Mandatory = $true)]
    [string] $Name,

    # Optional integer with default
    [int] $Retries = 3,

    # Optional double
    [double] $Threshold = 0.75,

    # Optional string with default
    [string] $Environment = "development"
)

Write-Host "Hello $Name, retries=$Retries, threshold=$Threshold, env=$Environment"
```

When run with guided input the user sees four consecutive input boxes, with defaults pre-filled
for the optional parameters.

---

### Switch parameters

`[switch]` parameters are presented as a **Yes / No QuickPick**. Selecting **Yes** adds the
switch flag to the command; selecting **No** omits it.

```powershell
param(
    [switch] $Verbose,
    [switch] $DryRun,
    [switch] $NoCache
)

if ($Verbose) { Write-Host "Verbose mode enabled" }
if ($DryRun)  { Write-Host "Dry run — no changes made" }
```

Selecting **Yes** for `-Verbose` and **Yes** for `-DryRun` produces:

```powershell
./script.ps1 -Verbose -DryRun
```

---

### ValidateSet (choices)

When a parameter has a `[ValidateSet(...)]` attribute the extension shows a **QuickPick** list of
the allowed values.

```powershell
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("development", "staging", "production")]
    [string] $Environment,

    [ValidateSet("debug", "info", "warning", "error")]
    [string] $LogLevel = "info"
)

Write-Host "Deploying to $Environment at log level $LogLevel"
```

Guided input shows a QuickPick for `$Environment` (required, no default) followed by a QuickPick
for `$LogLevel` (pre-selected on `info`).

---

### Array parameters

Array-typed parameters (`[string[]]`, `[int[]]`, etc.) are collected in a loop — the user is
prompted repeatedly until they submit an empty value or press **Escape**.

```powershell
param(
    [string[]] $Tags,

    [Parameter(Mandatory = $true)]
    [string[]] $Files
)
```

Providing `backend`, `api` for `$Tags` and `a.txt`, `b.txt` for `$Files` produces:

```powershell
./script.ps1 -Tags backend api -Files a.txt b.txt
```

---

### Combined example

The following script combines all supported parameter types:

```powershell
param(
    [Parameter(Mandatory = $true)]
    [string] $ProjectName,

    [ValidateSet("dev", "staging", "prod")]
    [string] $Env = "dev",

    [int] $MaxRetries = 5,

    [switch] $DryRun,

    [string[]] $Tags
)

Write-Host "Project : $ProjectName"
Write-Host "Env     : $Env"
Write-Host "Retries : $MaxRetries"
Write-Host "Dry run : $DryRun"
Write-Host "Tags    : $($Tags -join ', ')"
```

Running with guided input prompts for each parameter in declaration order.

---

## Cancellation Behaviour

| Situation | Result |
| --- | --- |
| Escape on a **required** parameter (`Mandatory = $true`) | Execution is cancelled entirely |
| Escape on an **optional** parameter | That parameter is skipped; remaining parameters continue |
| Escape after providing ≥ 1 value for an array parameter | Stops collecting, uses values provided so far |

---

## Security Note

The `PwshGetHelpResolver` spawns a `pwsh` process to retrieve parameter information. This is
subject to the extension's workspace trust checks — the resolver only runs when the workspace is
**trusted**. In untrusted workspaces the extension falls back to the static regex resolver, which
reads the source file without executing any code.

{: .warning }
`pwsh` must be available on the system `PATH` for the primary resolver to work. The executable
name is configurable via `workspaceTasks.shellPaths.pwsh` (default: `pwsh`).

---

## Known Limitations

The static fallback resolver uses regex to parse the `param(...)` block and may not handle:

- Parameters defined outside a `param()` block (pipeline-aware functions)
- Dynamically constructed parameter attributes
- Advanced Function parameters (`DynamicParam` blocks)
- `CmdletBinding` attributes (not used for argument discovery)

When the primary resolver fails and the static fallback returns no parameters, the extension falls
back to the standard free-text argument input box.

---

## Related Settings

| Setting | Default | Description |
| --- | --- | --- |
| `workspaceTasks.task.guidedArgInput` | `true` | Enable guided argument input for supported script types |
| `workspaceTasks.shellPaths.pwsh` | `pwsh` | Path or name of the PowerShell executable |
