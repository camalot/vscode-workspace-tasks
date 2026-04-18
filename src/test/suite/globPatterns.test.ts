import * as assert from 'assert';
import micromatch from 'micromatch';
import constants from '../../libs/constants';

interface GlobCase {
  name: string;
  pattern: string;
  matches: string[];
  nonMatches: string[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function assertPattern(caseDef: GlobCase): void {
  for (const filePath of caseDef.matches) {
    assert.strictEqual(
      micromatch.isMatch(normalizePath(filePath), caseDef.pattern, { dot: true }),
      true,
      `${caseDef.name} should match: ${filePath}`,
    );
  }

  for (const filePath of caseDef.nonMatches) {
    assert.strictEqual(
      micromatch.isMatch(normalizePath(filePath), caseDef.pattern, { dot: true }),
      false,
      `${caseDef.name} should not match: ${filePath}`,
    );
  }
}

suite('Glob Pattern Constants Test Suite', () => {
  const globCases: GlobCase[] = [
    {
      name: 'GLOB_ANT',
      pattern: constants.GLOB_ANT,
      matches: ['repo/build.xml', 'repo/config/settings.xml'],
      nonMatches: ['repo/build.gradle', 'repo/readme.md'],
    },
    {
      name: 'GLOB_CARGO_MAKE',
      pattern: constants.GLOB_CARGO_MAKE,
      matches: [
        'repo/Makefile.toml',
        'repo/makefile.toml',
        'repo/MakeFile.toml',
        'repo/Makefile.local.toml',
      ],
      nonMatches: ['repo/README.md', 'repo/Makefile', 'repo/file.toml.md'],
    },
    {
      name: 'GLOB_DENO',
      pattern: constants.GLOB_DENO,
      matches: ['repo/deno.json', 'repo/deno.jsonc'],
      nonMatches: ['repo/deno.js', 'repo/package.json'],
    },
    {
      name: 'GLOB_JUST',
      pattern: constants.GLOB_JUST,
      matches: [
        'repo/justfile',
        'repo/Justfile',
        'repo/justFile',
        'repo/.justfile',
        'repo/.Justfile',
        'repo/.justFile',
        'repo/foo.just',
      ],
      nonMatches: ['repo/just.config', 'repo/taskfile.yml', 'repo/just'],
    },
    {
      name: 'GLOB_MAVEN',
      pattern: constants.GLOB_MAVEN,
      matches: ['repo/pom.xml'],
      nonMatches: ['repo/pom.yml', 'repo/build.gradle'],
    },
    {
      name: 'GLOB_MISE',
      pattern: constants.GLOB_MISE,
      matches: [
        'repo/mise.toml',
        'repo/mise.local.toml',
        'repo/mise.dist.toml',
        'repo/mise.dist.local.toml',
      ],
      nonMatches: ['repo/mise.json', 'repo/misefile.toml', 'repo/mise.toml.backup'],
    },
    {
      name: 'GLOB_MSBUILD',
      pattern: constants.GLOB_MSBUILD,
      matches: [
        'repo/foo.csproj',
        'repo/foo.vbproj',
        'repo/foo.vcxproj',
        'repo/foo.xml',
        'repo/foo.proj',
        'repo/foo.sln',
        'repo/foo.targets',
        'repo/foo.msbuild',
        'repo/foo.build',
        'repo/foo.anythingproj',
        'repo/foo.bar.proj',
      ],
      nonMatches: ['repo/a.gradle', 'repo/a.md', 'repo/project.projection'],
    },
    {
      name: 'GLOB_GULP',
      pattern: constants.GLOB_GULP,
      matches: [
        'repo/gulpfile.js',
        'repo/gulpfile.mjs',
        'repo/gulpfile.cjs',
        'repo/Gulpfile.js',
        'repo/Gulpfile.mjs',
        'repo/Gulpfile.cjs',
        'repo/gulpFile.js',
        'repo/gulpFile.mjs',
        'repo/gulpFile.cjs',
        'repo/GulpFile.js',
        'repo/GulpFile.mjs',
        'repo/GulpFile.cjs',
      ],
      nonMatches: ['repo/gulpfile.ts', 'repo/Gruntfile.js', 'repo/gulp-file.js'],
    },
    {
      name: 'GLOB_GRUNT',
      pattern: constants.GLOB_GRUNT,
      matches: [
        'repo/Gruntfile.js',
        'repo/Gruntfile.mjs',
        'repo/Gruntfile.cjs',
        'repo/gruntfile.js',
        'repo/gruntfile.mjs',
        'repo/gruntfile.cjs',
        'repo/GruntFile.js',
        'repo/GruntFile.mjs',
        'repo/GruntFile.cjs',
        'repo/gruntFile.js',
        'repo/gruntFile.mjs',
        'repo/gruntFile.cjs',
      ],
      nonMatches: ['repo/gulpfile.js', 'repo/Gruntfile.ts', 'repo/grunt-file.js'],
    },
    {
      name: 'GLOB_GRADLE',
      pattern: constants.GLOB_GRADLE,
      matches: ['repo/build.gradle', 'repo/module.gradle'],
      nonMatches: ['repo/build.gradle.kts', 'repo/pom.xml'],
    },
    {
      name: 'GLOB_MAKE',
      pattern: constants.GLOB_MAKE,
      matches: ['repo/Makefile', 'repo/makefile', 'repo/MakeFile'],
      nonMatches: ['repo/Makefile.toml', 'repo/Makefile.md', 'repo/make-file'],
    },
    {
      name: 'GLOB_NODEJS',
      pattern: constants.GLOB_NODEJS,
      matches: ['repo/package.json'],
      nonMatches: ['repo/package.yaml', 'repo/pnpm-lock.yaml'],
    },
    {
      name: 'GLOB_PNPM',
      pattern: constants.GLOB_PNPM,
      matches: ['repo/package.json', 'repo/package.yaml', 'repo/package.yml'],
      nonMatches: ['repo/package-lock.json', 'repo/packages.yml', 'repo/package.json.backup'],
    },
    {
      name: 'GLOB_PERL',
      pattern: constants.GLOB_PERL,
      matches: ['repo/build.pl', 'repo/scripts/run.pl'],
      nonMatches: ['repo/build.pm', 'repo/run.sh'],
    },
    {
      name: 'GLOB_COMPOSER',
      pattern: constants.GLOB_COMPOSER,
      matches: ['repo/composer.json'],
      nonMatches: ['repo/composer.lock', 'repo/package.json'],
    },
    {
      name: 'GLOB_GITHUB_ACTIONS',
      pattern: constants.GLOB_GITHUB_ACTIONS,
      matches: [
        'repo/.github/workflows/ci.yml',
        'repo/.github/workflows/ci.yaml',
        'repo/.github/workflows/release.yml',
        'repo/.github/workflows/release.yaml',
      ],
      nonMatches: ['repo/.github/workflow/ci.yml', 'repo/.github/workflows/ci.json'],
    },
    {
      name: 'GLOB_GITLAB_CI',
      pattern: constants.GLOB_GITLAB_CI,
      matches: ['repo/.gitlab-ci.yml', 'repo/.gitlab-ci.yaml'],
      nonMatches: ['repo/.gitlab/ci.yml', 'repo/gitlab-ci.yml'],
    },
    {
      name: 'GLOB_JUPYTER',
      pattern: constants.GLOB_JUPYTER,
      matches: ['repo/notebook.ipynb'],
      nonMatches: ['repo/notebook.py', 'repo/notebook.md'],
    },
    {
      name: 'GLOB_PYTHON',
      pattern: constants.GLOB_PYTHON,
      matches: ['repo/main.py', 'repo/scripts/build.py'],
      nonMatches: ['repo/main.pyc', 'repo/main.ts'],
    },
    {
      name: 'GLOB_PIPENV',
      pattern: constants.GLOB_PIPENV,
      matches: ['repo/Pipfile', 'repo/pipfile', 'repo/PipFile'],
      nonMatches: ['repo/Pipfile.lock', 'repo/pyproject.toml', 'repo/pip-file'],
    },
    {
      name: 'GLOB_POE',
      pattern: constants.GLOB_POE,
      matches: ['repo/pyproject.toml'],
      nonMatches: ['repo/poetry.toml', 'repo/PyProject.toml'],
    },
    {
      name: 'GLOB_POETRY',
      pattern: constants.GLOB_POETRY,
      matches: ['repo/pyproject.toml'],
      nonMatches: ['repo/poetry.toml', 'repo/PyProject.toml'],
    },
    {
      name: 'GLOB_RAKE',
      pattern: constants.GLOB_RAKE,
      matches: ['repo/tasks.rake', 'repo/Rakefile'],
      nonMatches: ['repo/tasks.rb', 'repo/Rakefile.md', 'repo/rakefile'],
    },
    {
      name: 'GLOB_RUBY',
      pattern: constants.GLOB_RUBY,
      matches: ['repo/main.rb', 'repo/scripts/test.rb'],
      nonMatches: ['repo/main.rake', 'repo/main.py'],
    },
    {
      name: 'GLOB_TSCONFIG',
      pattern: constants.GLOB_TSCONFIG,
      matches: ['repo/tsconfig.json', 'repo/tsconfig.app.json'],
      nonMatches: ['repo/jsconfig.json', 'repo/tsconfig.js'],
    },
    {
      name: 'GLOB_VSCODE',
      pattern: constants.GLOB_VSCODE,
      matches: ['repo/.vscode/tasks.json'],
      nonMatches: ['repo/.vscode/settings.json', 'repo/tasks.json'],
    },
    {
      name: 'GLOB_MCP',
      pattern: constants.GLOB_MCP,
      matches: ['repo/.vscode/mcp.json'],
      nonMatches: ['repo/.vscode/tasks.json', 'repo/.vscode/mcp.yaml'],
    },
    {
      name: 'GLOB_WORKSPACE',
      pattern: constants.GLOB_WORKSPACE,
      matches: ['repo/.workspace-tasks.json', 'repo/.workspace-tasks.dev.json'],
      nonMatches: ['repo/workspace-tasks.json', 'repo/.workspace-task.json'],
    },
    {
      name: 'GLOB_VENV',
      pattern: constants.GLOB_VENV,
      matches: [
        'repo/.venv/Scripts/activate.bat',
        'repo/.venv/Scripts/activate.fish',
        'repo/.venv/Scripts/Activate.ps1',
        'repo/.venv/Scripts/deactivate.bat',
        'repo/.venv/Scripts/deactivate.fish',
        'repo/.venv/Scripts/Deactivate.ps1',
        'repo/.venv/Scripts/activate',
        'repo/.venv/Scripts/deactivate',
      ],
      nonMatches: ['repo/.venv/bin/activate', 'repo/.venv/Scripts/python.exe', 'repo/.venv/scripts/activate.bat'],
    },
    {
      name: 'GLOB_CMAKE',
      pattern: constants.GLOB_CMAKE,
      matches: ['repo/CMakeLists.txt'],
      nonMatches: ['repo/CMakeLists.cmake', 'repo/Makefile'],
    },
    {
      name: 'GLOB_CAKE',
      pattern: constants.GLOB_CAKE,
      matches: ['repo/build.cake'],
      nonMatches: ['repo/build.csx', 'repo/cakefile'],
    },
    {
      name: 'GLOB_TASKFILE',
      pattern: constants.GLOB_TASKFILE,
      matches: [
        'repo/Taskfile.yml',
        'repo/Taskfile.yaml',
        'repo/TaskFile.yml',
        'repo/TaskFile.yaml',
        'repo/taskFile.yml',
        'repo/taskFile.yaml',
        'repo/Taskfile.dist.yml',
        'repo/Taskfile.dist.yaml',
        'repo/TaskFile.dist.yml',
        'repo/TaskFile.dist.yaml',
        'repo/taskFile.dist.yml',
        'repo/taskFile.dist.yaml',
        'repo/Taskfile.local.yml',
        'repo/Taskfile.local.yaml',
        'repo/TaskFile.local.yml',
        'repo/TaskFile.local.yaml',
        'repo/taskFile.local.yml',
        'repo/taskFile.local.yaml',
      ],
      nonMatches: ['repo/Taskfile.toml', 'repo/task.yml', 'repo/taskfile.txt'],
    },
  ];

  for (const caseDef of globCases) {
    test(`${caseDef.name} matches expected files`, () => {
      assertPattern(caseDef);
    });
  }

  test('GLOB_GLOBAL_EXCLUDE filters only expected paths', () => {
    const excludes = constants.GLOB_GLOBAL_EXCLUDE.split(',').map((s: string) => s.trim());

    const shouldMatch = [
      'repo/node_modules/left-pad/index.js',
      'repo/.git/config',
      'repo/__pycache__/module.cpython-313.pyc',
      'repo/vendor/bundle/ruby/3.3.0/gems/a.rb',
    ];
    const shouldNotMatch = [
      'repo/src/node_module/index.js',
      'repo/git/config',
      'repo/vendor/ruby/app.rb',
      'repo/src/main.ts',
    ];

    for (const filePath of shouldMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), true, `should exclude ${filePath}`);
    }

    for (const filePath of shouldNotMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), false, `should not exclude ${filePath}`);
    }
  });

  test('GLOB_EXTENSIONLESS_EXCLUDE filters only expected paths', () => {
    const excludes = constants.GLOB_EXTENSIONLESS_EXCLUDE.split(',').map((s: string) => s.trim());

    const shouldMatch = [
      'repo/node_modules/x/index.js',
      'repo/.git/config',
      'repo/.venv/lib/python3.13/site.py',
      'repo/dist/main.js',
      'repo/out/main.js',
      'repo/build/main.js',
      'repo/coverage/lcov.info',
      'repo/.vscode/settings.json',
      'repo/.vscode-test/fixtures/x.txt',
      'repo/vendor/bundle/ruby/3.3.0/gems/a.rb',
    ];
    const shouldNotMatch = [
      'repo/src/main.ts',
      'repo/vendor/src/main.js',
      'repo/.vscodeignore',
      'repo/coverage-report/index.html',
    ];

    for (const filePath of shouldMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), true, `should exclude ${filePath}`);
    }

    for (const filePath of shouldNotMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), false, `should not exclude ${filePath}`);
    }
  });

  test('GLOB_SHELL_EXCLUDE filters only expected paths', () => {
    const excludes = [constants.GLOB_SHELL_EXCLUDE];

    const shouldMatch = [
      'repo/.venv/bin/activate',
      'repo/sub/.venv/Scripts/activate.bat',
    ];
    const shouldNotMatch = [
      'repo/venv/bin/activate',
      'repo/scripts/activate.sh',
    ];

    for (const filePath of shouldMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), true, `should exclude ${filePath}`);
    }

    for (const filePath of shouldNotMatch) {
      assert.strictEqual(micromatch.isMatch(filePath, excludes, { dot: true }), false, `should not exclude ${filePath}`);
    }
  });
});
