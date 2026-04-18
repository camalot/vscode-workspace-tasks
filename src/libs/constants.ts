const constants: Record<string, any> = {
  extensionName: 'workspaceTasks',
  configurationSection: 'workspaceTasks',

  FAVORITES_KEY: 'favorites',

  // ID prefix for compound tasks to ensure uniqueness and allow for specific handling in tree logic
  // format: `queue:CompoundTaskName` for groups, `queue:CompoundTaskName:TaskId` for items
  // `queue` is used to provide backwards compatibility with existing IDs and logic that may have been built around the concept of "queues" before we settled on "compound tasks" as the feature name.
  COMPOUND_TASK_ID_PREFIX: 'queue',

  // ID prefix for VSCode native compound tasks (tasks with dependsOn) shown in the Compound Tasks group.
  // format: `compoundTasksVscode:TaskId`
  VSCODE_COMPOUND_TASK_ID_PREFIX: 'compoundTasksVscode',

  DEFAULT_TASK_GROUP_SEPARATOR: '',

  GLOB_GLOBAL_EXCLUDE: '**/node_modules/**,**/.git/**,**/__pycache__/**,**/vendor/bundle/**',
  GLOB_ANT: '**/*.xml',
  GLOB_CARGO_MAKE: '**/{Makefile.toml,*.toml}',
  GLOB_DENO: '**/deno.{json,jsonc}',
  GLOB_JUST: '{**/justfile,**/.justfile,**/*.just}',
  GLOB_MAVEN: '**/pom.xml',
  GLOB_MISE: '**/{mise.toml,mise.*.toml,mise.*.local.toml}',
  GLOB_MSBUILD: '**/*.{csproj,vbproj,vcxproj,xml,proj,sln}',
  GLOB_SHELL_EXCLUDE: '**/.venv/**',
  GLOB_GULP: '{**/gulpfile.js,**/gulpfile.mjs}',
  GLOB_GRUNT: '**/[Gg]runtfile.js',
  GLOB_GRADLE: '**/*.gradle',
  GLOB_MAKE: '**/[Mm]ake[Ff]ile',
  GLOB_NODEJS: '**/package.json',
  GLOB_PNPM: '**/package.{json,yaml}',
  GLOB_PERL: '**/*.pl',
  GLOB_COMPOSER: '**/composer.json',
  GLOB_GITHUB_ACTIONS: '**/.github/workflows/*.{yml,yaml}',
  GLOB_JUPYTER: '**/*.ipynb',
  GLOB_PYTHON: '**/*.py',
  GLOB_PIPENV: '**/[Pp]ip[Ff]ile',
  GLOB_POE: '**/pyproject.toml',
  GLOB_POETRY: '**/pyproject.toml',
  GLOB_RAKE: '{**/*.rake,**/Rakefile}',
  GLOB_RUBY: '**/*.rb',
  GLOB_TSCONFIG: '**/tsconfig.{json,*.json}',
  GLOB_VSCODE: '**/.vscode/tasks.json',
  GLOB_MCP: '**/.vscode/mcp.json',
  GLOB_WORKSPACE: '**/.workspace-tasks.{json,*.json}',
  GLOB_VENV: '**/.venv/Scripts/{activate.bat,activate.fish,Activate.ps1,deactivate.bat}',
  GLOB_CMAKE: '**/CMakeLists.txt',
  GLOB_CAKE: '**/*.cake',
  GLOB_TASKFILE: '{**/Taskfile.yml,**/taskfile.yml,**/Taskfile.yaml,**/taskfile.yaml,**/Taskfile.dist.yml,**/taskfile.dist.yml,**/Taskfile.dist.yaml,**/taskfile.dist.yaml}',
  GLOB_EXTENSIONLESS_EXCLUDE: '**/node_modules/**,**/.git/**,**/.venv/**,**/dist/**,**/out/**,**/build/**,**/coverage/**,**/.vscode/**,**/.vscode-test/**',
  MAX_SHEBANG_READ_BYTES: 255,
};

export default constants;
