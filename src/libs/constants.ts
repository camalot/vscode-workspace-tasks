

const constants: Record<string, any> = {
  extensionName: "workspaceTasks",
  configurationSection: "workspaceTasks",

  FAVORITES_KEY: "favorites",

  QUEUE_KEY: "queue",

  DEFAULT_TASK_GROUP_SEPARATOR: "",

  GLOB_GLOBAL_EXCLUDE: "**/node_modules/**,**/.git/**",
  GLOB_ANT: "**/*.xml",
  // GLOB_DENO: "**/{deno,package}.json",
  GLOB_JUST: "{**/justfile,**/.justfile,**/*.just}",
  GLOB_MAVEN: "**/pom.xml",
  GLOB_MISE: "**/{mise.toml,mise.*.toml,mise.*.local.toml}",
  GLOB_MSBUILD: "**/*.{csproj,vbproj,vcxproj,xml,proj,sln}",
  GLOB_SHELL_EXCLUDE: "**/.venv/**",
  GLOB_GULP: "{**/gulpfile.js,**/gulpfile.mjs}",
  GLOB_GRUNT: "**/[Gg]runtfile.js",
  GLOB_GRADLE: "**/*.gradle",
  GLOB_MAKE: "**/[M]akefile",
  GLOB_NODEJS: "**/package.json",
  GLOB_PERL: "**/*.pl",
  GLOB_COMPOSER: "**/composer.json",
  GLOB_GITHUB_ACTIONS: "**/.github/workflows/*.{yml,yaml}",
  GLOB_JUPYTER: "**/*.ipynb",
  GLOB_PYTHON: "**/*.py",
  GLOB_PIPENV: "**/[Pp]ip[Ff]ile",
  GLOB_POETRY: "**/pyproject.toml",
  GLOB_RUBY: "**/*.rb",
  GLOB_TSCONFIG: "**/tsconfig.{json,*.json}",
  GLOB_VSCODE: "**/.vscode/tasks.json",
  GLOB_MCP: "**/.vscode/mcp.json",
  GLOB_WORKSPACE: "**/.workspace-tasks.{json,*.json}",
  GLOB_VENV: "**/.venv/Scripts/{activate.bat,activate.fish,Activate.ps1,deactivate.bat}",

};

export default constants;
