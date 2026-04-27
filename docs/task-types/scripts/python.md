---
layout: default
title: 🐍 Python Scripts
parent: 📜 Scripts & Other
grand_parent: 📱 Supported Task Types
nav_order: 1
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Python Scripts — Guided Argument Input
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

When `workspaceTasks.task.guidedArgInput` is enabled, running a Python script **Run with Args**
prompts you for each argument individually rather than asking for a raw argument string.

The extension statically parses your script's `argparse` `add_argument()` calls to discover what
parameters the script accepts, then presents each parameter in the most appropriate VS Code UI:

| Parameter type | UI shown |
| --- | --- |
| `action='store_true'` / `'store_false'` | Yes / No QuickPick |
| `choices=[...]` | QuickPick of the defined choices |
| `action='count'` | Input box asking for an integer (flag is repeated N times) |
| `nargs='*'` / `'+'` / N | Input box loop until empty string or Escape |
| `action='append'` | Input box loop, each value assembled as `--flag v1 --flag v2` |
| Everything else | Single input box |

If the extension cannot discover parameters (no `import argparse`, unsupported pattern, or
untrusted workspace), it falls through to the standard free-text input box.

{: .note }
Guided argument input is **enabled by default**. Disable it in Settings:
`workspaceTasks.task.guidedArgInput: false`.

---

## Enabling

In VS Code Settings (`Ctrl+,` / `Cmd+,`) search for **guidedArgInput**, or add to your
`settings.json`:

```json
"workspaceTasks.task.guidedArgInput": true
```

---

## Supported `argparse` Patterns

### Basic types

```python
#!/usr/bin/env python
import argparse

parser = argparse.ArgumentParser()

# Required string — shown as a text input box
parser.add_argument("--name", type=str, required=True, help="Your full name")

# Optional int with default — text box pre-filled with the default
parser.add_argument("--retries", type=int, default=3, help="Number of retries")

# Optional float
parser.add_argument("--threshold", type=float, default=0.75, help="Confidence threshold")

# Short and long form — long form is used as the canonical CLI flag
parser.add_argument("-e", "--environment", type=str, default="development")

args = parser.parse_args()
```

When run with guided input the user sees:

1. An input box for `--name` (required — aborting cancels execution)
2. An input box for `--retries` pre-filled with `3`
3. An input box for `--threshold` pre-filled with `0.75`
4. An input box for `--environment` pre-filled with `development`

---

### Boolean flags (`store_true` / `store_false`)

Boolean flags are presented as a **Yes / No QuickPick**. Choosing **Yes** includes the flag on the
command line; choosing **No** omits it.

```python
#!/usr/bin/env python
import argparse

parser = argparse.ArgumentParser()

parser.add_argument("--verbose",  action="store_true",  help="Enable verbose output")
parser.add_argument("--no-cache", action="store_false", help="Disable caching")
parser.add_argument("--dry-run",  action="store_true",  help="Simulate without changes")

args = parser.parse_args()
```

Guided input shows three consecutive Yes / No QuickPicks.
Selecting **Yes** for `--verbose` adds `--verbose` to the assembled command.

---

### Choices

When a parameter has a fixed list of allowed values the extension shows a **QuickPick** of those
values.

```python
#!/usr/bin/env python
import argparse

parser = argparse.ArgumentParser()

parser.add_argument(
    "--environment",
    choices=["development", "staging", "production"],
    required=True,
    help="Target environment"
)

parser.add_argument(
    "--log-level",
    choices=["debug", "info", "warning", "error"],
    default="info",
    help="Logging verbosity"
)

args = parser.parse_args()
```

---

### Multi-value arguments (`nargs`)

The extension prompts in a loop, collecting values one at a time, until the user submits an empty
string or presses **Escape**.

| `nargs` value | Behaviour |
| --- | --- |
| `'*'` | Zero or more. Escape or empty on first prompt → skips the parameter. |
| `'+'` | One or more. Escape or empty on first prompt → aborts if required, skips if not. Escape after at least one value → stops collecting. |
| `N` (integer) | Exactly N values. Escape at any point → aborts if required, discards and skips if not. |
| `'?'` | Zero or one value — single input box. |

```python
#!/usr/bin/env python
import argparse

parser = argparse.ArgumentParser()

# nargs='*' — zero or more; the user is prompted until they submit empty or Escape
parser.add_argument("--hobbies", nargs="*", type=str, help="List of hobbies")

# nargs='+' — one or more
parser.add_argument("--files", nargs="+", required=True, help="Input files to process")

# nargs=2 — exactly two values (e.g. a range)
parser.add_argument("--range", nargs=2, type=int, metavar=("MIN", "MAX"))

args = parser.parse_args()
```

Assembled command for `--hobbies reading coding`, `--files a.txt b.txt`, `--range 1 100`:

```sh
python script.py --hobbies reading coding --files a.txt b.txt --range 1 100
```

---

### Accumulating actions (`append`, `extend`, `count`)

#### `action='append'`

The user is prompted in a loop; each value is added as a separate `--flag value` pair.

```python
#!/usr/bin/env python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--tag", action="append", help="Tag (may be repeated)")

args = parser.parse_args()
```

Providing `backend`, `api`, `v2` produces:

```sh
python script.py --tag backend --tag api --tag v2
```

#### `action='extend'`

Same loop as `append`, but all values are placed after a single flag occurrence.

```python
parser.add_argument("--include", action="extend", nargs="+", help="Paths to include")
```

Providing `src`, `tests` produces:

```sh
python script.py --include src tests
```

#### `action='count'`

The user enters an integer; the flag is repeated that many times.

```python
parser.add_argument("-v", "--verbose", action="count", default=0, help="Verbosity (-vvv)")
```

Entering `3` produces:

```sh
python script.py --verbose --verbose --verbose
```

---

## Cancellation Behaviour

| Situation | Result |
| --- | --- |
| Escape on a **required** parameter | Execution is cancelled entirely |
| Escape on an **optional** parameter | That parameter is skipped; remaining parameters continue |
| Escape after providing ≥ 1 value for a multi-value parameter | Stops collecting, uses values provided so far |

---

## Ignored Actions

Parameters declared with `action='help'` or `action='version'` are silently skipped — they are
meta-actions that control the argument parser itself, not real runtime inputs.

---

## Known Limitations

The parameter discovery uses static source analysis (regex) and does not evaluate Python. The
following patterns are **not** detected:

- `argparse.ArgumentParser(parents=[...])` (inherited parsers)
- `add_subparsers()` / subcommands
- `add_mutually_exclusive_group()`
- `add_argument()` calls inside loops or conditionals
- `click`, `typer`, `docopt`, and other third-party argument libraries

When discovery fails, the extension falls back to the standard free-text argument input box.

---

## Related Settings

| Setting | Default | Description |
| --- | --- | --- |
| `workspaceTasks.task.guidedArgInput` | `true` | Enable guided argument input for supported script types |
