# Plan: Task Alias Feature for .workspace-tasks.json

## TL;DR

Add an `alias` property to `.workspace-tasks.json` task definitions. Register a custom VS Code task type `"workspace-tasks"` so tasks can be referenced in `launch.json` by a stable alias label instead of the volatile display label. The extension auto-injects stub entries into `.vscode/tasks.json` for each aliased task so `preLaunchTask: "alias"` works out-of-the-box.

## Decisions

- Scope: aliases only for `.workspace-tasks.json` tasks (not native VS Code tasks)
- tasks.json stubs: auto-injected by the extension (add-only, never remove)
- Input resolution in resolveTask(): use default values (no interactive prompting)
- File-based tasks with `{{ .FileName }}` in aliases: substitute with workspace folder basename or empty string; document limitation

## Phase 1: Schema & Service (backend)

### Files

**`res/schemas/workspace-tasks.schema.json`** — Add `alias` to task item properties:

```json
"alias": {
  "type": "string",
  "description": "A stable identifier for this task. Used to reference the task from .vscode/tasks.json and launch.json independent of its display label."
}
```

**`src/services/workspaceTasksService.ts`** — Two changes:

1. Add `alias?: string` to `FileTaskDefinition` interface
2. Add `findTaskByAlias(alias: string): { task: FileTaskDefinition; languageId: string } | undefined` — searches all language configs for a task with matching alias
3. Add `getRawTaskCommand(alias: string, resourceUri: vscode.Uri): string | undefined` — non-interactive command resolution: substitutes `{{ .FileName }}` using basename of resourceUri, substitutes `{{ .InputId }}` with default values from inputs array, removes any remaining unresolved `{{ ... }}` templates

## Phase 2: VS Code Task Type Registration

**`package.json`** — Add to `contributes`:

```json
"taskDefinitions": [
  {
    "type": "workspace-tasks",
    "required": ["alias"],
    "properties": {
      "alias": {
        "type": "string",
        "description": "The alias of a task defined in .workspace-tasks.json"
      }
    }
  }
]
```

**`src/providers/workspaceAliasTaskProvider.ts`** — New file implementing `vscode.TaskProvider`:

- `provideTasks()`: returns `[]` (no discovery; stubs live in tasks.json)
- `resolveTask(task)`:
  1. Extract `alias = task.definition.alias`
  2. Call `WorkspaceTasksService.getInstance().findTaskByAlias(alias)`
  3. If not found → return `undefined`
  4. Get workspace folder URI (first folder or fallback)
  5. Call `getRawTaskCommand(alias, workspaceUri)` for the shell command
  6. Return `new vscode.Task(task.definition, vscode.TaskScope.Workspace, task.name, 'workspace-tasks', new vscode.ShellExecution(command))`

**`src/providers/index.ts`** — After the existing `TaskCacheService.getInstance().registerProvider()` calls, register the VS Code task provider:

```ts
context.subscriptions.push(
  vscode.tasks.registerTaskProvider('workspace-tasks', new WorkspaceAliasTaskProvider())
);
```

## Phase 3: Auto-injection Service

**`src/services/taskAliasService.ts`** — New singleton service:

- `syncAliasStubs()`:
  1. Gets all aliases from `WorkspaceTasksService` (iterate providers → iterate tasks → collect those with `alias`)
  2. For each workspace folder, calls `injectStubsIntoTasksJson(folder, aliases)`
- `injectStubsIntoTasksJson(folder, aliases)`:
  1. Reads `.vscode/tasks.json` in that folder (creates skeleton `{ "version": "2.0.0", "tasks": [] }` if absent)
  2. For each alias: if NO existing entry with `type === "workspace-tasks"` && `alias === theAlias` → push `{ "type": "workspace-tasks", "alias": theAlias, "label": theAlias }` to tasks array
  3. Write back using `vscode.workspace.fs.writeFile` with JSON.stringify (2-space indent)
- Logging for all add/skip operations

**`src/services/workspaceTasksService.ts`** — After `loadWorkspaceConfig()` completes, call `TaskAliasService.getInstance().syncAliasStubs()`. Also call on each reload triggered by file watchers.

## Phase 4: Tests

**`src/test/suite/workspaceTasksService.test.ts`** — Add test group for alias methods:

- `findTaskByAlias` returns correct task and languageId
- `findTaskByAlias` returns `undefined` for unknown alias
- `getRawTaskCommand` substitutes defaults correctly
- `getRawTaskCommand` substitutes `{{ .FileName }}` with basename
- `getRawTaskCommand` removes unresolved templates

**New `src/test/suite/workspaceAliasTaskProvider.test.ts`**:

- `provideTasks()` returns empty array
- `resolveTask()` calls service and returns correct vscode.Task
- `resolveTask()` returns undefined when alias not found

**New `src/test/suite/taskAliasService.test.ts`**:

- `syncAliasStubs()` creates tasks.json when missing
- `syncAliasStubs()` adds stub for new alias
- `syncAliasStubs()` skips existing stub (same type + alias)
- `syncAliasStubs()` handles multiple workspace folders
- `syncAliasStubs()` handles no aliases (no-op)

## Phase 5: Documentation

**`docs/features/custom-workspace-tasks.md`** — Add "Task Aliases" section:

- Explain the problem (label = identifier)
- Show `alias` property usage
- Show auto-injected `tasks.json` stub
- Show `launch.json` usage
- Note limitation: inputs resolved with default values in `preLaunchTask` context

**`README.md`** — Add brief mention of alias support under workspace tasks section

## Relevant Files

- `res/schemas/workspace-tasks.schema.json` — schema for alias property
- `src/services/workspaceTasksService.ts` — FileTaskDefinition, findTaskByAlias, getRawTaskCommand
- `src/providers/workspaceAliasTaskProvider.ts` — NEW: vscode.TaskProvider implementation
- `src/services/taskAliasService.ts` — NEW: auto-injection into tasks.json
- `src/providers/index.ts` — register WorkspaceAliasTaskProvider
- `package.json` — contributes.taskDefinitions
- `src/test/suite/workspaceTasksService.test.ts` — add alias tests
- `src/test/suite/workspaceAliasTaskProvider.test.ts` — NEW
- `src/test/suite/taskAliasService.test.ts` — NEW
- `docs/features/custom-workspace-tasks.md`, `README.md` — docs

## Examples

These examples show the full end-to-end experience across different project types. In every case the user never needs to touch `preLaunchTask` again after setting it once — only the `.workspace-tasks.json` tasks change.

---

### Example 1 — Python (pytest before debugging)

**`.workspace-tasks.json`**

```json
{
  "python": {
    "version": "2.0.0",
    "inputs": [
      {
        "id": "TestPath",
        "type": "promptString",
        "description": "Test path or module",
        "default": "tests/"
      }
    ],
    "tasks": [
      {
        "label": "🐍 Run pytest",
        "alias": "python:test",
        "type": "shell",
        "command": "python -m pytest {{ .TestPath }} -v",
        "group": "test"
      },
      {
        "label": "🐍 Install dependencies",
        "alias": "python:install",
        "type": "shell",
        "command": "pip install -r requirements.txt",
        "group": "build"
      }
    ]
  }
}
```

**`.vscode/tasks.json`** — auto-injected by the extension

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "workspace-tasks",
      "alias": "python:test",
      "label": "python:test"
    },
    {
      "type": "workspace-tasks",
      "alias": "python:install",
      "label": "python:install"
    }
  ]
}
```

> `alias` resolves inputs using their `default` values — `tests/` will be used without prompting.

**`.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: Debug Tests",
      "type": "debugpy",
      "request": "launch",
      "module": "pytest",
      "args": ["tests/", "-v"],
      "preLaunchTask": "python:test",
      "postDebugTask": "python:install"
    }
  ]
}
```

**`tasks.json` `dependsOn`** — alias tasks can also be chained from other tasks:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Full Python CI",
      "dependsOn": ["python:install", "python:test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

---

### Example 2 — Ruby (bundle before debugging)

**`.workspace-tasks.json`**

```json
{
  "ruby": {
    "version": "2.0.0",
    "inputs": [],
    "tasks": [
      {
        "label": "bundle:install",
        "alias": "ruby:install",
        "type": "shell",
        "command": "bundle install",
        "group": "build"
      },
      {
        "label": "Run RSpec Tests",
        "alias": "ruby:test",
        "type": "shell",
        "command": "bundle exec rspec",
        "group": "test"
      }
    ]
  }
}
```

**`.vscode/tasks.json`** — auto-injected

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "workspace-tasks",
      "alias": "ruby:install",
      "label": "ruby:install"
    },
    {
      "type": "workspace-tasks",
      "alias": "ruby:test",
      "label": "ruby:test"
    }
  ]
}
```

**`.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Ruby: Debug App",
      "type": "rdbg",
      "request": "launch",
      "script": "${workspaceFolder}/bin/rails server",
      "preLaunchTask": "ruby:install"
    },
    {
      "name": "Ruby: Debug RSpec",
      "type": "rdbg",
      "request": "launch",
      "script": "${workspaceFolder}/bin/rspec",
      "preLaunchTask": "ruby:test"
    }
  ]
}
```

---

### Example 3 — Mixed project (Python + shell build step)

A monorepo with a Python service and a shared shell-based code generator. The alias remains stable even if the display label is renamed or localised.

**`.workspace-tasks.json`**

```json
{
  "codegen": {
    "version": "2.0.0",
    "tasks": [
      {
        "label": "⚙️ Generate protobuf stubs",
        "alias": "codegen:proto",
        "type": "shell",
        "command": "scripts/gen-proto.sh",
        "group": "build"
      }
    ]
  },
  "python": {
    "version": "2.0.0",
    "inputs": [],
    "tasks": [
      {
        "label": "🐍 Start API server",
        "alias": "python:serve",
        "type": "shell",
        "command": "uvicorn app.main:app --reload",
        "group": "build"
      }
    ]
  }
}
```

**`.vscode/tasks.json`** — auto-injected

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "workspace-tasks",
      "alias": "codegen:proto",
      "label": "codegen:proto"
    },
    {
      "type": "workspace-tasks",
      "alias": "python:serve",
      "label": "python:serve"
    }
  ]
}
```

**`.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "debugpy",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app"],
      "preLaunchTask": "codegen:proto"
    }
  ],
  "compounds": [
    {
      "name": "Full Stack",
      "configurations": ["Debug API"],
      "preLaunchTask": "codegen:proto"
    }
  ]
}
```

---

### Where VS Code Accepts Task Labels (alias as `label`)

| Location | Property | Example |
|---|---|---|
| `launch.json` | `preLaunchTask` | `"preLaunchTask": "ruby:test"` |
| `launch.json` | `postDebugTask` | `"postDebugTask": "python:install"` |
| `launch.json` compounds | `preLaunchTask` | `"preLaunchTask": "codegen:proto"` |
| `tasks.json` task | `dependsOn` | `"dependsOn": ["ruby:install", "ruby:test"]` |
| Command Palette | *Tasks: Run Task* | select `ruby:install` directly |

Because the auto-injected stub uses the alias as its `label`, any VS Code surface that accepts a task label works automatically with no additional configuration.

---

### Limitation: `{{ .FileName }}` in Aliased Tasks

Tasks that use `{{ .FileName }}` (file-glob-associated tasks like the built-in `cargo:build`) will have `{{ .FileName }}` resolved to the workspace folder basename in the alias context, since there is no specific file available at `resolveTask()` time. Prefer using aliases on tasks that do not rely on `{{ .FileName }}`, or use explicit paths in the command instead.

```json
{
  "cargo": {
    "tasks": [
      {
        "label": "cargo:build (workspace)",
        "alias": "cargo:build",
        "type": "shell",
        "command": "cargo build",
        "group": "build"
      }
    ]
  }
}
```

## Verification

1. Run `npm test` — all tests pass including new alias tests
2. Manual: add `"alias": "build"` to a task in `.workspace-tasks.json`, confirm `.vscode/tasks.json` auto-gets `{ "type": "workspace-tasks", "alias": "build", "label": "build" }`
3. Manual: add `"preLaunchTask": "build"` to `launch.json`, start debug session, confirm task runs
4. Manual: rename task label in `.workspace-tasks.json` (keep alias), confirm `preLaunchTask` still works
5. Run `npm run vscode:test:coverage` — new code has 100% coverage
