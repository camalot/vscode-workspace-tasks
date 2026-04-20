<!-- AUTO-GENERATED: npm run docs:generate:glob-patterns -->

{: .table table-dark table-striped }
| Constant | Pattern | Should Match Examples |
| --- | --- | --- |
| <code>GLOB_GLOBAL_EXCLUDE</code> | <code>**/node_modules/**,**/.git/**,**/__pycache__/**,**/vendor/bundle/**</code> |  |
| <code>GLOB_EXTENSIONLESS_EXCLUDE</code> | <code>**/node_modules/**,**/.git/**,**/.venv/**,**/dist/**,**/out/**,**/build/**,**/coverage/**,**/.vscode/**,**/.vscode-test/**,**/vendor/bundle/**</code> |  |
| <code>GLOB_SHELL_EXCLUDE</code> | <code>**/.venv/**</code> |  |
| <code>GLOB_ANT</code> | <code>**/*.xml</code> | <code>build.xml</code> |
| <code>GLOB_CARGO_MAKE</code> | <code>**/{[Mm]ake[Ff]ile.toml,*.toml}</code> | <code>Makefile.toml</code><br><code>makefile.toml</code><br><code>MakeFile.toml</code><br><code>Makefile.local.toml</code> |
| <code>GLOB_DENO</code> | <code>**/deno.{json,jsonc}</code> | <code>deno.json</code><br><code>deno.jsonc</code> |
| <code>GLOB_JUST</code> | <code>{**/[Jj]ust[Ff]ile,**/.[Jj]ust[Ff]ile,**/*.just}</code> | <code>justfile</code><br><code>Justfile</code><br><code>justFile</code><br><code>.justfile</code><br><code>.Justfile</code><br><code>.justFile</code><br><code>foo.just</code> |
| <code>GLOB_MAVEN</code> | <code>**/pom.xml</code> | <code>pom.xml</code> |
| <code>GLOB_MISE</code> | <code>**/{mise.toml,mise.local.toml,.mise.toml,mise/config.toml,.mise/config.toml,.config/mise.toml,.config/mise/config.toml,.config/mise/conf.d/*.toml}</code> | <code>mise.toml</code><br><code>mise.local.toml</code><br><code>.mise.toml</code><br><code>mise/config.toml</code><br><code>.mise/config.toml</code><br><code>.config/mise.toml</code><br><code>.config/mise/config.toml</code><br><code>.config/mise/conf.d/dev.toml</code> |
| <code>GLOB_MSBUILD</code> | <code>**/*.{csproj,vbproj,vcxproj,xml,proj,sln,targets,*proj,msbuild,build}</code> | <code>foo.csproj</code><br><code>foo.vbproj</code><br><code>foo.vcxproj</code><br><code>foo.xml</code><br><code>foo.proj</code><br><code>foo.sln</code><br><code>foo.targets</code><br><code>foo.msbuild</code><br><code>foo.build</code><br><code>foo.anythingproj</code><br><code>foo.bar.proj</code> |
| <code>GLOB_GULP</code> | <code>**/[Gg]ulp[Ff]ile.{m,c,}js</code> | <code>gulpfile.js</code><br><code>gulpfile.mjs</code><br><code>gulpfile.cjs</code><br><code>Gulpfile.js</code><br><code>Gulpfile.mjs</code><br><code>Gulpfile.cjs</code><br><code>gulpFile.js</code><br><code>gulpFile.mjs</code><br><code>gulpFile.cjs</code><br><code>GulpFile.js</code><br><code>GulpFile.mjs</code><br><code>GulpFile.cjs</code> |
| <code>GLOB_GRUNT</code> | <code>**/[Gg]runt[Ff]ile.{m,c,}js</code> | <code>Gruntfile.js</code><br><code>Gruntfile.mjs</code><br><code>Gruntfile.cjs</code><br><code>gruntfile.js</code><br><code>gruntfile.mjs</code><br><code>gruntfile.cjs</code><br><code>GruntFile.js</code><br><code>GruntFile.mjs</code><br><code>GruntFile.cjs</code><br><code>gruntFile.js</code><br><code>gruntFile.mjs</code><br><code>gruntFile.cjs</code> |
| <code>GLOB_GRADLE</code> | <code>**/*.gradle</code> | <code>build.gradle</code><br><code>module.gradle</code> |
| <code>GLOB_MAKE</code> | <code>**/[Mm]ake[Ff]ile</code> | <code>Makefile</code><br><code>makefile</code><br><code>MakeFile</code> |
| <code>GLOB_NODEJS</code> | <code>**/package.json</code> | <code>package.json</code> |
| <code>GLOB_PNPM</code> | <code>**/package.{json,yaml,yml}</code> | <code>package.yaml</code><br><code>package.yml</code><br><code>package.json</code> |
| <code>GLOB_PERL</code> | <code>**/*.pl</code> | <code>foo.pl</code> |
| <code>GLOB_COMPOSER</code> | <code>**/composer.json</code> | <code>composer.json</code> |
| <code>GLOB_GITHUB_ACTIONS</code> | <code>**/.github/workflows/*.{yml,yaml}</code> | <code>.github/workflows/ci.yml</code><br><code>.github/workflows/ci.yaml</code><br><code>.github/workflows/release.yml</code><br><code>.github/workflows/release.yaml</code> |
| <code>GLOB_GITLAB_CI</code> | <code>**/.gitlab-ci.{yml,yaml}</code> | <code>.gitlab-ci.yml</code><br><code>.gitlab-ci.yaml</code> |
| <code>GLOB_CIRCLECI</code> | <code>**/.circleci/config.{yml,yaml}</code> | <code>.circleci/config.yml</code><br><code>.circleci/config.yaml</code> |
| <code>GLOB_JUPYTER</code> | <code>**/*.ipynb</code> | <code>foo.ipynb</code> |
| <code>GLOB_PYTHON</code> | <code>**/*.py</code> | <code>foo.py</code> |
| <code>GLOB_PIPENV</code> | <code>**/[Pp]ip[Ff]ile</code> | <code>Pipfile</code><br><code>pipfile</code><br><code>PipFile</code> |
| <code>GLOB_POE</code> | <code>**/pyproject.toml</code> | <code>pyproject.toml</code> |
| <code>GLOB_POETRY</code> | <code>**/pyproject.toml</code> | <code>pyproject.toml</code> |
| <code>GLOB_RAKE</code> | <code>{**/*.rake,**/Rakefile}</code> | <code>Rakefile</code><br><code>rakefile</code><br><code>RakeFile</code> |
| <code>GLOB_RUBY</code> | <code>**/*.rb</code> | <code>foo.rb</code> |
| <code>GLOB_TSCONFIG</code> | <code>**/tsconfig.{json,*.json}</code> | <code>tsconfig.json</code><br><code>tsconfig.app.json</code> |
| <code>GLOB_VSCODE</code> | <code>**/.vscode/tasks.json</code> | <code>.vscode/tasks.json</code> |
| <code>GLOB_MCP</code> | <code>**/.vscode/mcp.json</code> | <code>.vscode/mcp.json</code> |
| <code>GLOB_WORKSPACE</code> | <code>**/.workspace-tasks.{json,*.json}</code> | <code>.workspace-tasks.json</code><br><code>.workspace-tasks.dev.json</code> |
| <code>GLOB_VENV</code> | <code>**/.venv/Scripts/{[Dd]eactivate,[Aa]ctivate}{.bat,.fish,.ps1,}</code> | <code>.venv/Scripts/activate.bat</code><br><code>.venv/Scripts/activate.fish</code><br><code>.venv/Scripts/Activate.ps1</code><br><code>.venv/Scripts/deactivate.bat</code><br><code>.venv/Scripts/deactivate.fish</code><br><code>.venv/Scripts/Deactivate.ps1</code><br><code>.venv/Scripts/activate</code><br><code>.venv/Scripts/deactivate</code> |
| <code>GLOB_CMAKE</code> | <code>**/CMakeLists.txt</code> | <code>CMakeLists.txt</code> |
| <code>GLOB_CAKE</code> | <code>**/*.cake</code> | <code>foo.cake</code> |
| <code>GLOB_TASKFILE</code> | <code>**/[Tt]ask[Ff]ile{.dist,.*,}.{yml,yaml}</code> | <code>Taskfile.yml</code><br><code>Taskfile.yaml</code><br><code>TaskFile.yml</code><br><code>TaskFile.yaml</code><br><code>taskFile.yml</code><br><code>taskFile.yaml</code><br><code>Taskfile.dist.yml</code><br><code>Taskfile.dist.yaml</code><br><code>TaskFile.dist.yml</code><br><code>TaskFile.dist.yaml</code><br><code>taskFile.dist.yml</code><br><code>taskFile.dist.yaml</code><br><code>Taskfile.local.yml</code><br><code>Taskfile.local.yaml</code><br><code>TaskFile.local.yml</code><br><code>TaskFile.local.yaml</code><br><code>taskFile.local.yml</code><br><code>taskFile.local.yaml</code> |
