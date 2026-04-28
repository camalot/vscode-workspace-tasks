---
layout: default
title: "🟢 Node.js Scripts"
parent: 📜 Scripts & Other
grand_parent: 📱 Supported Task Types
nav_order: 2
---

<!-- markdownlint-disable-next-line MD025 MD022 -->
# Node.js Scripts — Guided Argument Input
{: .no_toc }

<!-- markdownlint-disable-next-line MD022 -->
## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

When `workspaceTasks.task.guidedArgInput` is enabled, running a Node.js script with
**Run with Args** can prompt for each option individually instead of requiring a raw
argument string.

The extension supports static discovery for:

- `argparse` (Node port of Python `argparse`)
- `parseArgs` from `node:util`
- `parseArgs` polyfill from `@pkgjs/parseargs`

If discovery fails (unsupported patterns, dynamic option definitions, or no known
argument parser import), the extension falls back to the additional-arguments
free-form prompt.

---

## Enabling

In VS Code Settings (`Ctrl+,` / `Cmd+,`) search for **guidedArgInput**, or add to
`settings.json`:

```json
"workspaceTasks.task.guidedArgInput": true
```

---

## Supported `argparse` Patterns

The Node resolver follows the common `nodeca/argparse` style:

- `const { ArgumentParser } = require('argparse')` or `import { ArgumentParser } from 'argparse'`
- `parser.add_argument('-n', '--name', { ... })`
- `parser.add_argument(['-n', '--name'], { ... })`

Supported option properties:

- `type` (`int`, `float`, `str`/`string`, `number`, `bool`/`boolean`)
- `required`
- `default`
- `choices`
- `help`
- `action` (`store_true`, `store_false`, `append`, `extend`, `count`)
- `nargs` (`?`, `*`, `+`, integer)

Actions `help` and `version` are intentionally skipped.

Example:

```js
const { ArgumentParser } = require('argparse');

const parser = new ArgumentParser({ description: 'Node.js argparse demo' });

parser.add_argument('-n', '--name', {
  help: 'The user name',
  required: true,
});

parser.add_argument('-v', '--verbose', {
  action: 'store_true',
  help: 'Show more details',
});

const args = parser.parse_args();
console.log(args.name, args.verbose);
```

---

## Supported `parseArgs` Patterns

The Node resolver also parses static `parseArgs` config objects from:

- `const { parseArgs } = require('node:util')`
- `import { parseArgs } from 'node:util'`
- `const { parseArgs } = require('@pkgjs/parseargs')`
- `import { parseArgs } from '@pkgjs/parseargs'`

It reads the `options` map and supports:

- `type: 'string' | 'boolean'`
- `default`
- `multiple`

Example:

```js
const { parseArgs } = require('node:util');

const options = {
  name: { type: 'string', short: 'n', default: 'User' },
  verbose: { type: 'boolean', short: 'v' },
  tag: { type: 'string', multiple: true },
};

const { values } = parseArgs({ options, allowPositionals: true, strict: false });
console.log(values);
```

For `multiple: true`, guided input collects repeated values and assembles repeated
flag pairs (`--tag a --tag b`).

---

## Known Limitations

- Static analysis only; no execution or AST evaluation.
- Dynamically generated options (loops, helpers, computed keys) may not be detected.
- Positional-only arguments are not currently surfaced in guided prompts.
- `parseArgs` metadata outside the `options` object is ignored for guided prompts
  (for example `allowPositionals`, `strict`, and `tokens`).

When discovery misses parameters, the extension still allows manual free-form
arguments.

---

## Related Settings

| Setting | Default | Description |
| --- | --- | --- |
| `workspaceTasks.task.guidedArgInput` | `true` | Enable guided argument input for supported script types |
