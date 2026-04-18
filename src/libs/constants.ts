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
  GLOB_EXTENSIONLESS_EXCLUDE: '**/node_modules/**,**/.git/**,**/.venv/**,**/dist/**,**/out/**,**/build/**,**/coverage/**,**/.vscode/**,**/.vscode-test/**,**/vendor/bundle/**',
  GLOB_SHELL_EXCLUDE: '**/.venv/**',

  // should match:
  // - build.xml
  GLOB_ANT: '**/*.xml',
  // should match:
  // - Makefile.toml
  // - makefile.toml
  // - MakeFile.toml
  // - Makefile.local.toml
  GLOB_CARGO_MAKE: '**/{[Mm]ake[Ff]ile.toml,*.toml}',
  // should match:
  // - deno.json
  // - deno.jsonc
  GLOB_DENO: '**/deno.{json,jsonc}',
  // should match:
  // - justfile
  // - Justfile
  // - justFile
  // - .justfile
  // - .Justfile
  // - .justFile
  // - foo.just
  GLOB_JUST: '{**/[Jj]ust[Ff]ile,**/.[Jj]ust[Ff]ile,**/*.just}',
  // should match:
  // - pom.xml
  GLOB_MAVEN: '**/pom.xml',
  // should match:
  // - mise.toml
  // - mise.local.toml
  // - mise.dist.toml
  // - mise.dist.local.toml
  GLOB_MISE: '**/mise{.*,.*.local,}.toml',
  // should match:
  // - foo.csproj
  // - foo.vbproj
  // - foo.vcxproj
  // - foo.xml
  // - foo.proj
  // - foo.sln
  // - foo.targets
  // - foo.msbuild
  // - foo.build
  // - foo.anythingproj
  // - foo.bar.proj
  GLOB_MSBUILD: '**/*.{csproj,vbproj,vcxproj,xml,proj,sln,targets,*proj,msbuild,build}',
  // should match:
  // - gulpfile.js
  // - gulpfile.mjs
  // - gulpfile.cjs
  // - Gulpfile.js
  // - Gulpfile.mjs
  // - Gulpfile.cjs
  // - gulpFile.js
  // - gulpFile.mjs
  // - gulpFile.cjs
  // - GulpFile.js
  // - GulpFile.mjs
  // - GulpFile.cjs
  GLOB_GULP: '**/[Gg]ulp[Ff]ile.{m,c,}js',
  // should match:
  // - Gruntfile.js
  // - Gruntfile.mjs
  // - Gruntfile.cjs
  // - gruntfile.js
  // - gruntfile.mjs
  // - gruntfile.cjs
  // - GruntFile.js
  // - GruntFile.mjs
  // - GruntFile.cjs
  // - gruntFile.js
  // - gruntFile.mjs
  // - gruntFile.cjs
  GLOB_GRUNT: '**/[Gg]runt[Ff]ile.{m,c,}js',
  // should match:
  // - build.gradle
  // - module.gradle
  GLOB_GRADLE: '**/*.gradle',
  // should match:
  // - Makefile
  // - makefile
  // - MakeFile
  GLOB_MAKE: '**/[Mm]ake[Ff]ile',
  // should match:
  // - package.json
  GLOB_NODEJS: '**/package.json',
  // should match:
  // - package.yaml
  // - package.yml
  // - package.json
  GLOB_PNPM: '**/package.{json,yaml,yml}',
  // should match:
  // - foo.pl
  GLOB_PERL: '**/*.pl',
  // should match:
  // - composer.json
  GLOB_COMPOSER: '**/composer.json',
  // should match:
  // - .github/workflows/ci.yml
  // - .github/workflows/ci.yaml
  // - .github/workflows/release.yml
  // - .github/workflows/release.yaml
  GLOB_GITHUB_ACTIONS: '**/.github/workflows/*.{yml,yaml}',
  // should match:
  // - .gitlab-ci.yml
  // - .gitlab-ci.yaml
  GLOB_GITLAB_CI: '**/.gitlab-ci.{yml,yaml}',
  // should match:
  // - .circleci/config.yml
  // - .circleci/config.yaml
  GLOB_CIRCLECI: '**/.circleci/config.{yml,yaml}',
  // should match:
  // - foo.ipynb
  GLOB_JUPYTER: '**/*.ipynb',
  // should match:
  // - foo.py
  GLOB_PYTHON: '**/*.py',
  // should match:
  // - Pipfile
  // - pipfile
  // - PipFile
  GLOB_PIPENV: '**/[Pp]ip[Ff]ile',
  // should match:
  // - pyproject.toml
  GLOB_POE: '**/pyproject.toml',
  // should match:
  // - pyproject.toml
  GLOB_POETRY: '**/pyproject.toml',
  // should match:
  // - Rakefile
  // - rakefile
  // - RakeFile
  GLOB_RAKE: '{**/*.rake,**/Rakefile}',
  // should match:
  // - foo.rb
  GLOB_RUBY: '**/*.rb',
  // should match:
  // - tsconfig.json
  // - tsconfig.app.json
  GLOB_TSCONFIG: '**/tsconfig.{json,*.json}',
  // should match:
  // - .vscode/tasks.json
  GLOB_VSCODE: '**/.vscode/tasks.json',
  // should match:
  // - .vscode/mcp.json
  GLOB_MCP: '**/.vscode/mcp.json',
  // should match:
  // - .workspace-tasks.json
  // - .workspace-tasks.dev.json
  GLOB_WORKSPACE: '**/.workspace-tasks.{json,*.json}',
  // should match:
  // - .venv/Scripts/activate.bat
  // - .venv/Scripts/activate.fish
  // - .venv/Scripts/Activate.ps1
  // - .venv/Scripts/deactivate.bat
  // - .venv/Scripts/deactivate.fish
  // - .venv/Scripts/Deactivate.ps1
  // - .venv/Scripts/activate
  // - .venv/Scripts/deactivate
  GLOB_VENV: '**/.venv/Scripts/{[Dd]eactivate,[Aa]ctivate}{.bat,.fish,.ps1,}',
  // GLOB_VENV: '**/.venv/Scripts/{activate.bat,activate.fish,Activate.ps1,deactivate.bat}',
  // should match:
  // - CMakeLists.txt
  GLOB_CMAKE: '**/CMakeLists.txt',
  // should match:
  // - foo.cake
  GLOB_CAKE: '**/*.cake',
  // should match:
  // - Taskfile.yml
  // - Taskfile.yaml
  // - TaskFile.yml
  // - TaskFile.yaml
  // - taskFile.yml
  // - taskFile.yaml

  // - Taskfile.dist.yml
  // - Taskfile.dist.yaml
  // - TaskFile.dist.yml
  // - TaskFile.dist.yaml
  // - taskFile.dist.yml
  // - taskFile.dist.yaml

  // - Taskfile.local.yml
  // - Taskfile.local.yaml
  // - TaskFile.local.yml
  // - TaskFile.local.yaml
  // - taskFile.local.yml
  // - taskFile.local.yaml
  GLOB_TASKFILE: '**/[Tt]ask[Ff]ile{.dist,.*,}.{yml,yaml}',
  MAX_SHEBANG_READ_BYTES: 255,
};

export default constants;
