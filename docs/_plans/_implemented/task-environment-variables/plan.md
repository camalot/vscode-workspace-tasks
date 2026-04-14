# Plan: Task Environment Variable Management

## TL;DR

Add first-class environment variable support to all discovered tasks — not just those defined in
`.workspace-tasks.json`. Two complementary mechanisms cover every case:

1. **Inline declaration** (`.workspace-tasks.json` tasks): per-task `env` blocks, multi-file
   `envFiles` / `secretFiles` arrays (supporting glob patterns), and per-task `secrets` maps that
   reference VS Code `SecretStorage` keys.
2. **Settings-based rules** (any task): a `workspaceTasks.taskEnv` array lets users attach
   env/secrets to any discovered task — npm scripts, Makefile targets, Gradle tasks, etc. — by
   matching on task name (exact, glob, or regex), task type, and/or source file pattern, without
   touching `.workspace-tasks.json`.

Variables loaded from `.secret` files or from `SecretStorage` never trigger a security warning;
variables in `env` properties or `.env` files whose names match secret patterns do. A
`workspaceTasks.env` global configuration layer and global `envFiles` / `secretFiles` file layers
complete the hierarchy. An inspector command renders a fully source-annotated, redacted variable
table for any task.

---

## Self-Critique & Viability Assessment

**Strengths:**

- Environment variable management is a daily pain point for teams operating across multiple
  environments (dev, staging, prod). Currently, users must hard-code values or maintain separate
  shell scripts — neither is maintainable.
- The `.workspace-tasks.json` format already supports `inputs`, so `env`, `envFiles`, and
  `secretFiles` blocks fit naturally into the existing schema pattern.
- VS Code's `vscode.Task` API supports `ShellExecutionOptions.env`, so injection requires no
  modification to task command strings — it is handled cleanly at the execution layer.
- Separating `.secret` from `.env` by file extension makes the contract clear: `.secret` files are
  explicitly for sensitive values, `.env` files are for regular non-sensitive configuration. This is
  a stronger signal than relying solely on key-name pattern matching.
- The VS Code `SecretStorage` API (`context.secrets`) is encrypted at rest, not synced, and
  platform-native (Electron safeStorage on desktop, DKE on web). It is the most secure storage
  option available to extensions.

**Risks / Weaknesses:**

- **Secret detection heuristic is imperfect**: Key-name pattern matching (e.g. `*_TOKEN`) will
  have false positives and false negatives. The warning system is advisory, not a security gate.
  Docs must make this explicit.
- **Multiple file glob expansion order**: When `envFiles` is a glob pattern that matches multiple
  files, the expansion order is filesystem-dependent (alphabetical). Users who rely on a specific
  override order must use explicit arrays instead of globs. This must be documented and a
  deterministic sort (alphabetical by resolved path) must be enforced.
- **`.secret` parsing is identical to `.env`**: The same `dotenv.parse()` handles both. The only
  difference is the "secret-origin" tag attached to entries at load time. This simplicity is a
  strength, but means a `.secret` file placed in a committed directory is still a risk. The git-
  tracked-file check (Phase 4) applies equally to `.secret` files as a safety net.
- **SecretStorage is async**: `context.secrets.get()` returns a `Thenable`. Since `createTaskForItem`
  in `taskFactory.ts` is already async-capable, this is manageable, but every call site that
  resolves task env must `await` the secrets fetch. Overlooked `await` calls could result in
  silently missing secrets. All code paths must be tested.
- **Variable substitution scope**: VS Code expands `${workspaceFolder}`, `${env:VAR}` etc. in task
  definitions. The extension's `{{ .InputId }}` template system is separate. The extension expands
  `{{ ... }}` first, then passes the result to VS Code. This ordering must be documented explicitly.
- **Windows key case-insensitivity**: Variable name merging must preserve original casing and not
  deduplicate across case variants on any platform — case-folding is the OS's responsibility at
  runtime.
- **Glob patterns inside `envFiles`/`secretFiles`**: Using `vscode.workspace.findFiles()` to expand
  globs keeps the implementation within the VS Code API sandbox and avoids Node `glob` dependency,
  but `findFiles` does not guarantee order. Resolved paths must be sorted alphabetically before
  being loaded in sequence.
- **`workspaceTasks.taskEnv` rule matching scope**: Rules apply to any discovered task regardless
  of its origin. A rule referencing `taskType: "npm"` and `taskName: "publish"` will match every
  `publish` npm script in every `package.json` across the workspace. In large monorepos this may
  be broader than the user intends. The `workspaceFolder` match criterion narrows scope, but users
  must be educated to use it in multi-root workspaces. Rule order is significant: later rules in
  the array win for duplicate keys. No conflict-resolution UI is planned — the Output Channel
  inspector is the only debuggability tool.
- **Task identity stability**: Task matching relies on the task name and source path as discovered
  at scan time. If a task is renamed in `package.json` (e.g. `publish` → `publish:npm`), the rule
  silently stops matching. No validation or broken-rule warning exists in Phase 1 of the feature.
  A future "unmatched rules" diagnostic is logged to the Output Channel but otherwise silent.
- **Alias resolution and env injection ordering**: When a task is invoked via a `workspace-tasks`
  alias stub (task-alias-58 feature), `WorkspaceAliasTaskProvider.resolveTask()` must call
  `TaskEnvService.resolveTaskEnv()` using the **underlying** task's identity, not the stub's
  `taskType: "workspace-tasks"`. If the alias provider is implemented without this call, rules
  written against the original task type and name silently fail to inject. The two features must
  explicitly coordinate the injection call site and the properties used for rule matching.

**Verdict:** Viable and addresses a real gap. The four-tier separation (env / envFiles / secretFiles
/ SecretStorage) plus settings-based task rules is the right architecture. The glob expansion
ordering, async SecretStorage fetching, and rule-match ambiguity in monorepos are the main
implementation risks and must each have explicit tests.

---

## Key Design Decisions

### File Type Distinction

| File type | Extension convention | Triggers secret warning? | Use case |
|-----------|---------------------|--------------------------|---------- |
| `.env` files | `.env`, `.env.local`, `.env.dev`, etc. | Yes, if key names match `secretPatterns` | Non-sensitive config and public defaults |
| `.secret` files | `.secret`, `.secrets`, `.env.secret`, etc. | **Never** | Explicitly secret values |
| VS Code SecretStorage | `context.secrets` API | **Never** | Highest-security, encrypted, per-machine |

### Precedence (lowest → highest)

| Layer | Source | Applies to |
|------:|--------|------------|
| 1 | Global `workspaceTasks.env` setting (user `settings.json`) | All tasks |
| 2 | Global `workspaceTasks.envFiles` (each file in order, later files win) | All tasks |
| 3 | Global `workspaceTasks.secretFiles` (each file in order, later files win) | All tasks |
| 4 | Language-block `envFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 5 | Language-block `env` block in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 6 | Language-block `secretFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 7 | Per-task `envFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 8 | Per-task `env` block in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 9 | Per-task `secretFiles` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 10 | Per-task `secrets` → `SecretStorage` in `.workspace-tasks.json` | `.workspace-tasks.json` tasks only |
| 11 | Matching `workspaceTasks.taskEnv` rules — `envFiles` (all matching rules, in array order) | All tasks |
| 12 | Matching `workspaceTasks.taskEnv` rules — `env` (all matching rules, in array order) | All tasks |
| 13 | Matching `workspaceTasks.taskEnv` rules — `secretFiles` (all matching rules, in array order) | All tasks |
| 14 | Matching `workspaceTasks.taskEnv` rules — `secrets` → `SecretStorage` (all matching rules) | All tasks |

**Within each file-list layer**: files are loaded in the order listed (or alphabetically when
expanded from a glob), with later entries overriding earlier ones.

**Multiple matching rules (layers 11–14)**: all rules that match a task are applied in the order
they appear in the `workspaceTasks.taskEnv` array. Within each rule, files load in list order.
The last matching value for any duplicate key wins.

### File Reference Schema (`IEnvFileReference`)

Both `envFiles` and `secretFiles` accept the same flexible type at every level:

```ts
type IEnvFileReference =
  | string                               // single path or glob
  | string[]                             // ordered list of paths/globs
  | { include: string[]; exclude?: string[] };  // glob include/exclude
```

All paths are relative to the workspace root unless absolute.

### SecretStorage Reference

In `.workspace-tasks.json`, the per-task `secrets` object maps environment variable names to
`SecretStorage` keys. At run time, `TaskEnvService` calls `context.secrets.get(storageKey)` for
each entry and injects the result as an env variable:

```jsonc
{
  "secrets": {
    "DEPLOY_TOKEN": "myapp.deploy-token",   // env var name → SecretStorage key
    "DB_PASSWORD":  "myapp.db-password"
  }
}
```

### Task Env Rules (`workspaceTasks.taskEnv`)

For tasks discovered via file scanning (npm, shell, maven, Gradle, etc.) users can inject env
variables and secrets through `settings.json` without creating or modifying a
`.workspace-tasks.json` file.

```ts
interface ITaskEnvRule {
  match: ITaskMatcher;              // Task selection criteria (AND logic across fields)
  env?: Record<string, string>;     // Inline variable overrides
  envFiles?: IEnvFileReference;     // .env-type files (warns on secret-pattern keys)
  secretFiles?: IEnvFileReference;  // .secret-type files (never warns)
  secrets?: Record<string, string>; // env var name → SecretStorage key (never warns)
  enabled?: boolean;                // Per-rule kill switch, default true
}

interface ITaskMatcher {
  taskName?: string;          // exact match, glob ("publish*"), or /regex/ string
  taskType?: string | string[]; // task source/type: "npm", "shell", ["npm", "maven"]
  source?: string | string[]; // source file glob: "**/package.json", "**/Makefile"
  workspaceFolder?: string;   // workspace folder name for multi-root scoping
}
```

**Matching rules**:

- All specified `ITaskMatcher` fields must match (AND logic).
- `taskName` plain string → case-sensitive exact match against `task.name`.
- `taskName` containing `*` or `?` → gitignore-style glob via `micromatch`.
- `taskName` beginning and ending with `/` (e.g. `/^publish.*/`) → treated as a regex.
- `taskType` matches against `task.source` (the string VS Code reports, e.g. `"npm"`).
- `source` matches against `task.definition.uri` or `task.scope` source file path.
- `workspaceFolder` matches against the workspace folder name (not path).
- An empty `match: {}` matches **all** tasks globally (useful for global secret injection).
- All matching rules are applied in array order; later rules override earlier rules per key.

### Secret Warning Logic

A warning is emitted when ALL of the following are true:

1. A key name matches `workspaceTasks.env.secretPatterns`.
2. The key's origin is an `env` property (in `settings.json`, `.workspace-tasks.json`, or a
   `workspaceTasks.taskEnv` rule) **or** an `.env`-type file.
3. The key's origin is **not** a `.secret`-type file and **not** `SecretStorage`.

No warning is emitted for keys originating from `.secret` files or `SecretStorage` regardless of
key name. Rules using only `secretFiles` or `secrets` are always warning-free.

### Native Task Type Compatibility (`workspace-tasks`)

The task alias feature ([`task-alias-58`](../task-alias-58/full-scope-plan.md)) registers a
`"workspace-tasks"` VS Code task type. A lightweight stub —
`{ "type": "workspace-tasks", "alias": "...", "label": "..." }` — lives in `.vscode/tasks.json`.
When VS Code resolves the stub, `WorkspaceAliasTaskProvider.resolveTask()` looks up the alias and
returns the real `ShellExecution` or `ProcessExecution` task.

**Env injection must target the resolved (underlying) task, not the stub.** Two properties of
the resolved task govern rule matching:

- The **effective `taskType`** is derived from the underlying task (e.g. `"npm"`, `"shell"`), NOT
  `"workspace-tasks"`.
- The **effective `taskName`** is the label of the underlying task (e.g. `"publish"`), NOT the
  alias string.

`WorkspaceAliasTaskProvider.resolveTask()` must call
`TaskEnvService.resolveTaskEnv(underlyingTaskItem)` after building the execution, passing a
`TaskItem` constructed from the underlying source. This means that:

- `taskEnv` rules authored against the original task type and name apply whether the task is run
  directly **or** via an alias, with zero change to the rules.
- Layers 4–10 (`.workspace-tasks.json` block and task props) apply normally when the alias
  resolves to a `.workspace-tasks.json` task; they are skipped for native `shell`/`process` tasks.
- Layers 1–3 (global) and 11–14 (rules) always apply regardless of alias resolution path.

**Using `taskType: "workspace-tasks"` in a rule** is a valid but niche use case: it matches
only the stub as seen by VS Code, before alias resolution. In practice users should write rules
against the original task type and name. Document both cases in feature documentation.

---

## Configuration Schema

### Global settings (`settings.json`)

```jsonc
{
  // Global env vars applied to all tasks
  "workspaceTasks.env": {
    "NODE_ENV": "development",
    "DEBUG": "workspace-tasks:*"
  },
  // Global .env files — supports string, array, or include/exclude glob object
  // (same IEnvFileReference type as secretFiles)
  "workspaceTasks.envFiles": {
    "include": [".env", ".env.local", "**/.env.*"],
    "exclude": ["**/.env.secret", "**/node_modules/**", "**/.env.*.secret"]
  },
  // Global .secret files applied to all tasks (never triggers warning)
  "workspaceTasks.secretFiles": {
    "include": [".secrets", "**/.env.secret"],
    "exclude": ["**/node_modules/**"]
  },
  // Key-name patterns that trigger the secret-in-env warning
  "workspaceTasks.env.secretPatterns": [
    "*_TOKEN", "*_KEY", "*_SECRET", "PASSWORD", "PASSWD", "CREDENTIALS", "API_KEY"
  ],
  // Per-task rules: inject env/secrets into any discovered task by matching criteria
  "workspaceTasks.taskEnv": [
    {
      // Match the npm 'publish' script in any package.json
      "match": {
        "taskType": "npm",
        "taskName": "publish",
        "source": "**/package.json"
      },
      // Plain env var (warns because APP_PUBLISH_TOKEN matches secretPatterns)
      "env": {
        "NPM_CONFIG_REGISTRY": "https://registry.npmjs.org"
      },
      // Secret file (no warning)
      "secretFiles": ".secrets.publish",
      // SecretStorage reference (no warning, encrypted at rest)
      "secrets": {
        "APP_PUBLISH_TOKEN": "myapp.publish-token"
      }
    },
    {
      // Match all npm scripts in a specific workspace folder
      // envFiles: include/exclude glob object form; secretFiles: array form
      "match": {
        "taskType": "npm",
        "workspaceFolder": "api"
      },
      "envFiles": {
        "include": [".env", ".env.local"],
        "exclude": ["**/.env.secret"]
      },
      "secretFiles": [".env.secret", ".secrets"]
    },
    {
      // Match any task named 'deploy' using a glob, across all task types.
      // This rule also applies when the task is invoked via a 'workspace-tasks' alias stub
      // (see native task type compatibility note); matching is against the underlying task name.
      "match": {
        "taskName": "deploy*"
      },
      "secrets": {
        "DEPLOY_KEY": "myapp.deploy-key"
      }
    }
  ]
}
```

### `.workspace-tasks.json` — Full example

`envFiles` and `secretFiles` accept the same three forms at every level (language-block and
per-task). The example below uses a different form at each position deliberately so all three
are illustrated:

```jsonc
{
  "shell": {
    "version": "2.0.0",
    // Language-block: include/exclude glob object form
    "envFiles": {
      "include": [".env", ".env.local", ".env.*.local"],
      "exclude": ["**/.env.secret", "**/vendor/**"]
    },
    "env": {
      "APP_ENV": "local"
    },
    // Language-block: single-string form (one file)
    "secretFiles": ".secrets",
    "tasks": [
      {
        "label": "Start Dev Server",
        "command": "npm start",
        // Per-task: array form (explicit ordered list)
        "envFiles": [".env.dev", ".env.override"],
        "env": {
          "PORT": "3000"                      // Warns if key matches secretPatterns
        },
        // Per-task: include/exclude glob object form
        "secretFiles": {
          "include": [".env.secret", ".secrets"],
          "exclude": ["**/vendor/**"]
        },
        "secrets": {                          // Per-task SecretStorage references (no warning)
          "DEPLOY_TOKEN": "myapp.deploy-token",
          "DB_PASSWORD":  "myapp.db-password"
        }
      },
      {
        "label": "Run Tests",
        "command": "npm test",
        // Per-task: single-string form (one file)
        "envFiles": ".env.test",
        // Per-task: array form (explicit ordered list)
        "secretFiles": [".secrets.test", ".env.secret"]
      }
    ]
  }
}
```

All three forms are equivalent for resolution — the same `TaskEnvFileResolver.resolveFileReferences()`
handles all of them. Glob strings in the string and array forms are also expanded (e.g.
`".env.*"` matches `.env.local`, `.env.dev`, etc.).

---

## `IResolvedEnvEntry` — Tagged Value

```ts
interface IResolvedEnvEntry {
  value: string;
  source: EnvEntrySource;   // see below
  sourceLabel: string;      // human-readable: "settings.json", ".env.local", "SecretStorage"
  isSecret: boolean;        // true if origin is secretFiles or SecretStorage
}

type EnvEntrySource =
  | 'globalSetting'         // workspaceTasks.env
  | 'globalEnvFile'         // workspaceTasks.envFiles
  | 'globalSecretFile'      // workspaceTasks.secretFiles (isSecret = true)
  | 'blockEnvFile'          // language block envFiles
  | 'blockEnv'              // language block env
  | 'blockSecretFile'       // language block secretFiles (isSecret = true)
  | 'taskEnvFile'           // per-task envFiles (.workspace-tasks.json)
  | 'taskEnv'               // per-task env (.workspace-tasks.json)
  | 'taskSecretFile'        // per-task secretFiles (.workspace-tasks.json, isSecret = true)
  | 'taskSecretStorage'     // per-task secrets → SecretStorage (.workspace-tasks.json, isSecret = true)
  | 'ruleEnvFile'           // workspaceTasks.taskEnv rule envFiles
  | 'ruleEnv'               // workspaceTasks.taskEnv rule env
  | 'ruleSecretFile'        // workspaceTasks.taskEnv rule secretFiles (isSecret = true)
  | 'ruleSecretStorage';    // workspaceTasks.taskEnv rule secrets → SecretStorage (isSecret = true)
```

---

## Phases

### Phase 1: Schema & File Parsing Foundation

1. **`res/schemas/workspace-tasks.schema.json`** — Add to both language-block and task-item
   schemas:
   - `envFiles`: union of `string | string[] | { include: string[], exclude: string[] }`.
   - `env`: object with `additionalProperties: { type: "string" }`.
   - `secretFiles`: same union type as `envFiles`.
   - `secrets`: object with `additionalProperties: { type: "string" }` (maps env var → storage
     key).

2. **`src/services/workspaceTasksService.ts`** — Extend `FileTaskDefinition` and the language-
   block interface with:
   ```ts
   env?: Record<string, string>;
   envFiles?: IEnvFileReference;
   secretFiles?: IEnvFileReference;
   secrets?: Record<string, string>;
   ```

3. **`src/services/taskEnvFileResolver.ts`** — New utility (pure, no VS Code dependency except
   `vscode.workspace.findFiles`):
   - `resolveFileReferences(ref: IEnvFileReference, workspaceFolder: vscode.Uri): Promise<string[]>`:
     Expands a single path, array, or include/exclude object into an ordered list of absolute file
     paths. Uses `vscode.workspace.findFiles` for glob expansion. Sorts results alphabetically by
     resolved path for determinism.
   - `parseEnvFile(filePath: string): Record<string, string>`: reads and parses the file using
     `dotenv.parse()`. Returns `{}` on missing file (logs debug warning). Same parser for both
     `.env` and `.secret` files — the caller is responsible for tagging the origin.

4. **`package.json`** — Add configuration contributions:
   - `workspaceTasks.env`: object, `additionalProperties: { type: "string" }`, default `{}`.
   - `workspaceTasks.envFiles`: `IEnvFileReference` — string, array, or include/exclude object,
     default `[]`.
   - `workspaceTasks.secretFiles`: same type, default `[]`.
   - `workspaceTasks.env.secretPatterns`: string array, default
     `["*_TOKEN", "*_KEY", "*_SECRET", "PASSWORD", "PASSWD", "CREDENTIALS", "API_KEY"]`.
   - `workspaceTasks.taskEnv`: array of `ITaskEnvRule` objects, default `[]`. Each item schema:
     ```json
     {
       "type": "object",
       "required": ["match"],
       "properties": {
         "match": {
           "type": "object",
           "properties": {
             "taskName": { "type": "string" },
             "taskType": { "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}] },
             "source":   { "oneOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}] },
             "workspaceFolder": { "type": "string" }
           }
         },
         "env":         { "type": "object", "additionalProperties": { "type": "string" } },
         "envFiles":    { ... same IEnvFileReference union schema ... },
         "secretFiles": { ... same IEnvFileReference union schema ... },
         "secrets":     { "type": "object", "additionalProperties": { "type": "string" } },
         "enabled":     { "type": "boolean", "default": true }
       }
     }
     ```

### Phase 2: `TaskEnvService` — Merge & Resolution

1. **`src/services/taskEnvService.ts`** — New singleton:
   - `initialize(context: vscode.ExtensionContext)`: stores `context` for `SecretStorage` access;
     reads global config; registers `FileSystemWatcher`s for all referenced env and secret files;
     subscribes to `vscode.workspace.onDidChangeConfiguration` to reload.
   - `resolveTaskEnv(taskItem: TaskItem, taskDef?, languageDef?, workspaceFolder?): Promise<Map<string, IResolvedEnvEntry>>`:
     Implements the fourteen-layer merge. Layers 1–3 (global) always run. Layers 4–10
     (`.workspace-tasks.json` block + task) run only when `taskDef` and `languageDef` are
     provided. Layers 11–14 (taskEnv rules) always run, using the `TaskItem` for matching.
     Each layer tags entries with `source`, `sourceLabel`, and `isSecret`. Duplicate keys:
     higher-precedence entry wins. SecretStorage keys are awaited in layers 10 and 14.
   - `getSecretStorageValue(storageKey: string): Promise<string | undefined>`: wraps
     `context.secrets.get(storageKey)`.
   - `onDidChangeEnvSources: vscode.Event<void>`: fires when any watched file changes or the
     configuration changes.
   - `dispose()`: disposes all `FileSystemWatcher`s.

2. **`src/extension.ts`** — Initialize `TaskEnvService` in `activate()`; subscribe to
   `onDidChangeEnvSources` to trigger a task-cache refresh.

### Phase 2b: `TaskEnvRuleMatcher` — Rule Evaluation

1. **`src/services/taskEnvRuleMatcher.ts`** — Pure, stateless utility (no VS Code dependency
   beyond type imports):
   - `matchesRule(item: TaskItem, rule: ITaskEnvRule): boolean`:
     - `rule.enabled === false` → returns `false` immediately.
     - `match.taskName` absent → skip name check; otherwise:
       - Wrapped in `/…/` → compile as `RegExp`; test against `item.originalLabel || item.label`.
       - Contains `*` or `?` → evaluate as glob via `micromatch.isMatch(taskName, pattern)`.
       - Otherwise → `===` comparison.
     - `match.taskType` absent → skip; otherwise compare against `item.taskType` (case-insensitive
       for robustness); array: any element must match.
     - `match.source` absent → skip; otherwise expand each pattern via
       `vscode.workspace.findFiles` (or use pre-resolved paths from `TaskItem.taskFileUri`);
       check whether `item.taskFileUri` matches any pattern.
     - `match.workspaceFolder` absent → skip; otherwise compare against the workspace folder
       name for `item.resourceUri`.
     - All specified criteria must pass (AND logic).
   - `getMatchingRules(item: TaskItem, rules: ITaskEnvRule[]): ITaskEnvRule[]`:
     Returns the ordered subset of `rules` whose `matchesRule` returns `true` for `item`.

2. **`src/services/taskEnvService.ts`** — In `resolveTaskEnv`, after completing layers 1–10,
   call `TaskEnvRuleMatcher.getMatchingRules(taskItem, allRules)` and process each matching
   rule in order as layers 11–14:
   - Each rule contributes four sub-layers (envFiles → env → secretFiles → secrets) in that
     order within the rule. Across rules, later rules override earlier rules per key.
   - Log each rule match at DEBUG level: `"[TaskEnv] Rule #N matched task '${label}'"`.
   - After all rules are applied, scan for unmatched rules (rules with `enabled !== false` whose
     `match` is non-empty and that have never matched any task in this session) and log a DEBUG
     warning to the Output Channel: `"[TaskEnv] Rule #N has not matched any task"`.

### Phase 3: Injection into Task Execution

1. **`src/taskFactory.ts`** — After building the `vscode.ShellExecution`:
   - Call `await TaskEnvService.getInstance().resolveTaskEnv(taskItem, taskDef, languageDef, workspaceFolder)`.
   - For non-workspace-tasks.json tasks (e.g. npm, shell, Makefile), pass only `taskItem`; layers
     4–10 are skipped automatically. Layers 1–3 and 11–14 still apply.
   - If the resulting map is non-empty, extract `value` from each entry and assign to
     `shellExecution.options = { ...options, env: mergedStringMap }`.

2. Because `resolveTaskEnv` is async (SecretStorage fetch), ensure `createTaskForItem` (and all
   callers in `TaskRunner.runTask`) `await` it correctly. Update the `TaskRunner` call chain as
   necessary.

3. **`src/providers/workspaceAliasTaskProvider.ts`** (future alias feature, task-alias-58) — After
   building the final `vscode.Task` from the underlying alias source, call
   `await TaskEnvService.getInstance().resolveTaskEnv(underlyingTaskItem)` and merge the result
   into the execution's `env` option. The `underlyingTaskItem` must be built from the resolved
   alias source (type, label, and `taskFileUri` of the **original** task), not from the
   `workspace-tasks` stub, so that `taskEnv` rules authored against the original task continue to
   match naturally regardless of whether the task is run directly or via an alias.

   Both `envFiles` and `secretFiles` (in all three forms — string, array, or include/exclude
   object) are fully supported for aliased tasks through the same
   `TaskEnvFileResolver.resolveFileReferences()` path used for all other task types.

### Phase 4: Secret Pattern Warning

1. After `resolveTaskEnv()`, iterate the resolved map. For each entry where:
   - `isSecret === false` (not from a `.secret` file or SecretStorage), AND
   - the key name matches any pattern in `workspaceTasks.env.secretPatterns`:
   → collect it into a `suspiciousKeys` list.

2. If `suspiciousKeys` is non-empty, check whether the origin config file (`.workspace-tasks.json`
   or `settings.json`) is tracked by git. For `.workspace-tasks.json`: run
   `git ls-files --error-unmatch <path>` via a Node `child_process.execFile` call (timeout: 2 s).

3. If git-tracked and `suspiciousKeys` is non-empty, show a one-time workspace warning:
   _"Task '…' has environment keys matching secret patterns (`KEY1`, `KEY2`) in a git-tracked file.
   Move them to a `.secret` file or use **Workspace Tasks: Store Secret** to save them securely."_
   Actions: **"Learn more"** (opens docs page) | **"Don't warn again"** (persisted in
   `workspaceState` per origin-file path).

4. The same warning logic applies if a `.secret` file itself is git-tracked — the warning message
   reads: _"`.secret` file is tracked by git. Secret files should be gitignored."_

5. For `workspaceTasks.taskEnv` rules: apply the same suspicious-key check against each rule's
   `env` block. The git-tracking check is against `settings.json` (workspace or user level) where
   the rule is defined. User-level `settings.json` is global and almost never git-tracked, so in
   practice warnings from task rules will only appear for workspace-level `settings.json`.

### Phase 5: Manage Secrets via SecretStorage Command

1. **`src/commands/storeSecretCommand.ts`** — `workspaceTasks.env.storeSecret`:
   - Shows `showInputBox` for the storage key name (e.g. `myapp.deploy-token`).
   - Shows a second `showInputBox` with `password: true` for the secret value.
   - Calls `context.secrets.store(key, value)`.
   - Fires `TaskEnvService.onDidChangeEnvSources` so that any currently resolved task env maps
     are invalidated.

2. **`src/commands/deleteSecretCommand.ts`** — `workspaceTasks.env.deleteSecret`:
   - Shows `QuickPick` populated from `context.secrets.keys()` (all stored keys).
   - On accept: confirms deletion, calls `context.secrets.delete(key)`.

3. Register both commands in `package.json` and `extension.ts`. Add to the command palette only
   (no context menu — these are global storage operations).

### Phase 6: Variable Inspector Command

1. **`src/commands/inspectTaskEnvCommand.ts`** — `workspaceTasks.env.inspect`:
   - If triggered from context menu: takes the selected `TaskItem`.
   - If triggered from command palette: `QuickPick` of all workspace-tasks-type tasks.
   - Calls `TaskEnvService.resolveTaskEnv(...)` for the selected task.
   - Creates (or clears) an Output Channel named "Workspace Tasks – Environment".
   - Outputs a formatted table. Secret values are redacted (`***`) unless the user passes
     `--reveal` (no such option exists yet, deferred to a follow-up):

     ```text
     Variable            Value                   Secret  Source
     ─────────────────────────────────────────────────────────────────────
     NODE_ENV            development             No      settings.json (workspaceTasks.env)
     APP_ENV             local                   No      .workspace-tasks.json (block env)
     PORT                3000                    No      .workspace-tasks.json (task env)
     DEPLOY_TOKEN        ***                     Yes     SecretStorage (myapp.deploy-token)
     DB_PASSWORD         ***                     Yes     .secrets (task secretFiles)
     DEBUG               workspace-tasks:*       No      settings.json (workspaceTasks.env)
     ```

   - Appends a warning section listing any keys in non-secret sources that match
     `secretPatterns`.

2. Add to `package.json` `contributes.commands` and to the task item context menu
   (`view/item/context` when `contextValue` matches `workspaceTask`).

### Phase 7: File Watching & Cache Invalidation

1. `TaskEnvService` builds a `FileSystemWatcher` for every resolved file path (both `.env` and
   `.secret` files). Watch events trigger `onDidChangeEnvSources`.
2. When glob-based `envFiles`/`secretFiles` are used, an additional directory-level watcher
   fires `onDidChangeEnvSources` when new files matching the pattern are created or deleted,
   causing a full re-resolution on next task run.
3. `TaskEnvService.dispose()` disposes all watchers on extension deactivation.

### Phase 8: Tests

1. **`src/test/suite/services/taskEnvFileResolver.test.ts`**
   - `resolveFileReferences`: single string expands to one path; array expands in order;
     include/exclude object expands and sorts alphabetically.
   - `parseEnvFile`: quoted values, `export` prefix, inline comments, missing file → `{}`.
   - Glob matching: `.env.*` matches `.env.local` and `.env.dev`; exclude pattern removes matches.

2. **`src/test/suite/services/taskEnvRuleMatcher.test.ts`**
   - `matchesRule`: exact `taskName` match; glob `taskName` (`publish*`); regex `taskName`
     (`/^publish.*/`); no match when name differs.
   - `taskType` string match; `taskType` array — any element matches.
   - `source` glob matches `item.taskFileUri`; mismatched source returns false.
   - `workspaceFolder` match on item's workspace folder name.
   - Empty `match: {}` matches all tasks.
   - `enabled: false` always returns false regardless of other criteria.
   - `getMatchingRules`: returns rules in array order; skips non-matching rules.
   - A rule with only `taskType: "npm"` and no other criteria matches all npm tasks.

3. **`src/test/suite/services/taskEnvService.test.ts`**
   - Fourteen-layer precedence: later layers override earlier layers for duplicate keys.
   - Layers 4–10 not applied when `taskDef`/`languageDef` not provided (non-workspace-tasks task).
   - Layers 11–14 applied for both workspace-tasks.json and native discovered tasks.
   - Multiple matching rules applied in order: last rule's value wins for duplicate keys.
   - `isSecret` flag: keys from `secretFiles` or `secrets` → `true`; `env`/`envFiles` → `false`.
   - Rule `secretFiles` entries do not trigger warning; rule `env` entries with pattern-matching
     keys do.
   - SecretStorage: mock `context.secrets.get()`; verify value retrieved and tagged correctly.
   - Missing SecretStorage key: treat as absent (no injection, no crash).
   - File watcher: changing a watched file fires `onDidChangeEnvSources`.
   - Unmatched rule logged to Output Channel at DEBUG level.

4. **`src/test/suite/taskFactory.test.ts`**
   - `shellExecution.options.env` set when `resolveTaskEnv` returns non-empty map.
   - Non-workspace-tasks task (e.g. npm): layers 4–10 skipped; layers 11–14 applied when matching
     rules exist.
   - Secret values (from `.secret` / SecretStorage) injected correctly for both task origins.

5. **`src/test/suite/commands/inspectTaskEnvCommand.test.ts`**
   - Output channel table shows correct source labels, including `ruleEnv`, `ruleSecretFile`,
     `ruleSecretStorage`.
   - Secret values redacted as `***`.
   - Warning section present when `suspiciousKeys` is non-empty (including from rule `env` keys).
   - An npm task with no `.workspace-tasks.json` entry but with a matching rule shows rule-sourced
     entries in the table.

6. **`src/test/suite/commands/storeSecretCommand.test.ts`**
   - `context.secrets.store` called with correct key and value.
   - `onDidChangeEnvSources` fires after store.

### Phase 9: Documentation

1. **`docs/features/task-environment-variables.md`** — New page:
   - Overview and the two-path philosophy: inline (`.workspace-tasks.json`) for tasks you own,
     settings rules (`workspaceTasks.taskEnv`) for tasks you discover.
   - File type separation: `.env` vs `.secret` vs SecretStorage.
   - Full precedence table with all fourteen layers.
   - Configuration examples:
     - Dev/prod `.env` files for workspace-tasks.json tasks.
     - Per-task port override.
     - Injecting a deploy token into `npm publish` without touching `.workspace-tasks.json`.
     - Scoping rules to a specific workspace folder in a monorepo.
     - Using regex to match a family of tasks (`/^deploy.*/`).
   - Secret safety guidance: why `.secret` files should be gitignored; when to use SecretStorage.
   - Glob pattern examples for `envFiles`/`secretFiles`.
   - Rule matching precedence and how to debug using the inspector command.

2. **`docs/configuration/environment-variables.md`** — Full settings reference for all
   `workspaceTasks.env.*`, `workspaceTasks.envFiles`, `workspaceTasks.secretFiles`, and
   `workspaceTasks.taskEnv` keys, including the full `ITaskEnvRule` / `ITaskMatcher` schema with
   field descriptions and worked examples.

3. **`docs/features/custom-workspace-tasks.md`** — Add section covering `env`, `envFiles`,
   `secretFiles`, and `secrets` within the existing custom tasks documentation, with a cross-link
   to the new full-feature page.

4. **`README.md`** — Add **"🔐 Environment Variable Management"** to Key Features.

5. **`docs/features/index.md`** — Add entry.
