# Feature Request: Python Script Enhancement to Identify Inputs

**Type:** Enhancement
**Labels:** enhancement, needs-triage
**Area:** Task Execution, Python provider

---

## Problem Statement

When running a Python (`.py`) script as a task using **Run with Args**, the user must know the expected script arguments in advance. The extension has no awareness of what arguments (`argparse`, `sys.argv`, `click`, `typer`, etc.) the script accepts. Users must inspect the script file separately to understand its interface before supplying arguments.

---

## Proposed Solution

Parse the Python script file to identify declared command-line inputs before running with args. When the user invokes **Run with Args**, instead of showing a generic free-text input prompt, the extension should:

1. Detect the argument-parsing library in use:
   - **`argparse`**: Parse `parser.add_argument(...)` calls to extract argument names, types, defaults, choices, and help text.
   - **`sys.argv`**: Detect direct `sys.argv` usage and show a generic "this script uses sys.argv directly" notice.
   - **`click`/`typer`** (stretch goal): Parse `@click.option` / `@click.argument` decorators for parameter discovery.
2. Present a structured input UI for discovered arguments (text input per argument, `QuickPick` for `choices=`).
3. Assemble the structured inputs into a command-line argument string for the script.

---

## Alternatives Considered

- Continue using the current free-text "Run with Args" input with no parsing (poor discoverability).
- Show only argument names as a hint/placeholder in the free-text input.
- Execute `python script.py --help` and parse the output for argument documentation (requires running the script, which may not be desirable).

---

## Feature Area

- [x] Task Execution
- [x] Task Types/Providers

---

## Priority

Medium - Would be nice to have

---

## Use Case

Python scripts used as build/deployment/automation tools often use `argparse`:

```python
import argparse

parser = argparse.ArgumentParser(description='Deploy script')
parser.add_argument('--env', choices=['dev', 'staging', 'prod'], required=True)
parser.add_argument('--dry-run', action='store_true')
parser.add_argument('--count', type=int, default=1)
args = parser.parse_args()
```

Being able to discover these parameters from the editor and fill them in through a structured UI would improve the developer experience significantly.

---

## Examples

**Parsed from script → structured prompt:**
- `--env` (choices: dev/staging/prod, required) → quick pick
- `--dry-run` (boolean flag) → checkbox/quick pick Yes/No
- `--count` (int, default: 1) → text input with numeric validation

---

## Additional Context

This enhancement would be scoped to the `ShellTaskProvider` (specifically for the Python shell type). The parsing would be done statically using regex or AST analysis on the `.py` file content. This is more complex than E1 (PowerShell) because Python argument parsing patterns are more varied (`argparse`, `click`, `typer`, `docopt`, raw `sys.argv`). The initial implementation should focus on `argparse` as the most common standard library approach.
