## [1.2.0] - 2026-03-08

### 🚀 Features

- Enhanced performance via single find call for tasks


### 🐛 Bug Fixes

- User level tasks are not handled properly #116

- Element with id group:<group_name>:<file>.json is already registered #120

- Add file indexing wait in taskFilesService integration tests

- Updated how the icons are rendered when it is a workspace-task iconUri

- When a user task from a user's profile is loaded, it now shows correctly in the tree


### 💼 Other

- V1.1.15 (#124)

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests

- Add file indexing wait in taskFilesService integration tests


### ⚙️ Miscellaneous Tasks

- Setup for some codecov

- Test coverage info sent to codecov

- Added test coverage for low coverage files

- Test coverage for taskRunner

- Remove test output files

- Documentation of plan for task loading performance

- Fix markdown lint errors

- Fix markdown lint errors

- Add codecov files to vscodeignore

- Update changelog

- Implement suggestions from copilot.

- Update version info

- Update changelog

- Markdown-lint fix

- Revert eslint version



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.14...v1.2.0

## [1.1.14] - 2026-02-19

### 🐛 Bug Fixes

- Use workspaceState instead of globalState to save favorites/queues/recentTasks

- Fixed removeFromFavorites being displayed on incorrect tree item


### 💼 Other

- V1.1.14 (#114)


### ⚙️ Miscellaneous Tasks

- Copilot suggestions and test fixing

- Fix tests and restore file that was updated based on copilot suggestions

- Resolve bad fast-xml-parser

- Fix failing linter

- Update changelog



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.13...v1.1.14

## [1.1.13] - 2026-02-17

### 🚀 Features

- Open all favorites by default or setting to do so #107

- Too many context actions missing while script is executing #105


### 🐛 Bug Fixes

- Recent Tasks not showing #106

- Recent Tasks not showing #106

- Regression vscode task failure


### 💼 Other

- V1.1.13 (#110)


### ⚙️ Miscellaneous Tasks

- Adding tests

- Commit the png for cargo

- Commit the png for cargo

- Improve test coverage

- Test suite changes

- Bump dev dependencies

- Ensure all tasks use the state manager to get a task id.

- Fix some tests that were configured incorrectly

- Update changelog



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.12...v1.1.13

## [1.1.12] - 2026-02-14

### 💼 Other

- V1.1.12 (#102)

- * feat: Ability to sync favorites and queues. #91

- * chore(repo): update links and some info in readme

- * feat: package.yaml support for pnpm #98

- * feat: golang support

- * feat: golang support simplified

- * fix: ask History Panel is 'Forced Focus' on extension activation #101

- * feat(tasks): Poetry initial task provider

- * chore: changes to poetry tasks glob

- * chore: added poetry icon

- * feat: add support for poe/poetry #95

- * feat: added rake tasks support #97

- * feat: added cargo and cargo-make support #94

- * chore: update changelog

- * chore: disable javascript pritter

- * chore: fix tests

- * chore: fixed failing tests

- * chore: remove unused constant



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.11...v1.1.12

## [1.1.11] - 2026-02-11

### 💼 Other

- Readme Cleanup (#89)

- * chore(repo): README claims the Task History table view is "Persistent" across VS Code sessions #87

- * chore(repo): The Task History Tree View description doesn’t match the implementation #86

- * Update README.md

- Copilot <175728472+Copilot@users.noreply.github.com>

- Ryan Conrad <camalot@gmail.com>

- * Update README.md

- Copilot <175728472+Copilot@users.noreply.github.com>

- Ryan Conrad <camalot@gmail.com>

- ---------

- Ryan Conrad <camalot@gmail.com>

- Copilot <175728472+Copilot@users.noreply.github.com>

- V1.1.11 (#90)

- * chore(repo): Unused variable task. #88

- * chore(repo): logger is defined but never used in TaskHistoryService #83

- * fix: The view mode context key uses 'tree' | 'webview' #85

- * fix: The webview enables scripts but the HTML is injected without a Content Security Policy (CSP) / nonce setup.  #84

- * feat: enable task history view presistence

- * feat(tasks): Support for Bun and Bun for NPM Script Runner #77

- * chore: remove bun dependency

- * feat: Support for Bun and Bun for NPM Script Runner #77

- * chore(ux): ux changes to the task history table and actions

- * fix: update steps for the release action

- * chore(changelog): update changelog

- * chore(repo): lint error resolution.

- * chore(repo): update editorconfig expectations for ps1 files

- * chore(repo): resolve copilot review suggestions

- * chore(repo): fix broken test



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.10...v1.1.11

## [1.1.10] - 2026-02-10

### 💼 Other

- V1.1.10 (#81)

- * chore(lint): path is imported but not used #76

- * fix: terminatedTasks is tracked by task id, but that flag is never cleared. #75

- * chore(tests): findMatchingTask introduces non-trivial matching behavior  #73

- * feat: Task Run History View #80

- * feat(tasks): initial ground work for 'bun' support. WIP

- * feat(ux): Task Run History View #80

- * chore(changelog): update changelog

- * chore(lint): fix linter errors



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.9...v1.1.10

## [1.1.9] - 2026-02-09

### 💼 Other

- V1.1.9 (#72)

- * fix: The status-reset logic is duplicated in both onDidEndTaskProcess and onDidEndTask. #66

- * fix: onDidEndTask unconditionally marks any still-running task as success #69

- * fix(tasks): When the tree is refreshed, npm tasks are not being added back. #70

- * fix(tasks): Any task that seems to be a "system task" does not ever show up in the Recent Tasks. #71

- * fix(tasks): VSCode Tasks executed by a compound task do not update state when running #67

- * fix(tasks): npm type in .vscode/tasks.json not added to recent tasks when executed

- * chore(changelog): generate changelog

- * fix(repo): EditorConfig lint error



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.8...v1.1.9

## [1.1.8] - 2026-02-09

### 💼 Other

- V1.1.8 (#65)

- * fix: Composite-only tasks finish immediately #64

- * chore(repo): update readme and ignore test task files

- * chore(changelog): update changelog



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.7...v1.1.8

## [1.1.7] - 2026-02-08

### 💼 Other

- V1.1.7 (#63)

- * fix: No tasks visible how best to debug? #61

- * chore(debug): added logging channel and debug option

- * chore(tasks): changed how vscode tasks and npm tasks are initially loaded

- * chore(tasks): if system tasks defined for supported task type, those are used

- * chore(changelog): update changelog

- * feat(cursor): Support for Cursor (VS Code Version 1.105.1) #62

- * chore(core): downgrade the minimum required vscode engine version

- * chore(changelog): update changelog

- * fix: Some types not displaying proper icon for the group #59

- * chore(task): add docker icon for #59


### ⚙️ Miscellaneous Tasks

- *(repo)* Update svg -> png to not overwite existing png by default



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.6...v1.1.7

## [1.1.6] - 2026-02-04

### 💼 Other

- V1.1.6 (#57)

- * feat(tasks): universal task interfaces initial

- * fix: treat vscode tasks as they are natively defined by vscode. #50 #49 #56

- * chore(changelog): update changelog

- * chore(repo): fix failing test

- * chore: checking for the file uri

- * chore: resolve copilot suggestions



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.5...v1.1.6

## [1.1.5] - 2026-02-03

### 💼 Other

- V1.1.5 (#55)

- * fix(ux): incorrect icons for gradle/makefile/shell

- * fix: exclude png files from package as not used in package

- * chore(deps-dev): bump @typescript-eslint/eslint-plugin from 8.53.1 to 8.54.0 #53

- * chore(deps-dev): bump @typescript-eslint/parser from 8.53.1 to 8.54.0 #52

- * chore(deps-dev): bump typescript-eslint from 8.53.1 to 8.54.0 #51

- * chore(repo): version bump

- * chore(changelog): update changelog

- * chore(repo): exclude gif from package

- * ensure that res/icon.png is included in package

- * chore(changelog): fix changelog compare link and regenerate

- * chore(repo): update npm package.lock

- * chore(repo): set remote urls for images



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.4...v1.1.5

## [1.1.4] - 2026-02-02

### 💼 Other

- V1.1.4 (#48)

- * fix(ux): Notification message on show/hide tasks and other locations should not have been enabled. #47

- * generate changelog

- * chore(repo): remove some unused variables defined



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.3...v1.1.4

## [1.1.3] - 2026-02-01

### 🐛 Bug Fixes

- Bump @vscode/test-cli from 0.0.11 to 0.0.12 #42

- Bump mocha from 11.3.0 to 11.7.5 #41


### 💼 Other

- V1.1.3 (#46)

- * chore(repo): update layout of readme

- * chore(repo): some readme and docs updates

- * feat: ability to hide individual or groups of tasks

- * feat(ux): Ability to hide individual or groups of tasks #43

- * feat(ux): Ability to hide individual or groups of tasks #43

- * feat: Ensure vscode tasks respect the 'hide' property

- * feat(tasks): Added eslint tasks

- * feat(tasks): Added action context menu items #44

- * chore(repo): super-linter fixes

- * chore(repo): generate changelog

- * fix(repo): Super-Linter log output directory

- * fix(repo): copilot PR suggestions to remove unused references.

- * fix(repo): fix permission to write comment on PR from super-linter

- * fix(repo): super-linter disable javascript_es due to not working correctly

- * fix(repo): editorconfig: extra space at end of line.

- * fix(shell): fixed the execution of shell tasks which broke due to recent changes



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.2...v1.1.3

## [1.1.2] - 2026-01-31

### 🚀 Features

- Different icons for type/folder/task #31


### 🐛 Bug Fixes

- Cant run powershell tasks if inside of subdirectory with spaces in name #36

- Fixed JSON.parse(transferItem.value as string) can throw #40


### 💼 Other

- V1.1.2 (#39)

- * chore(repo): some workflow setup

- * chore(repo): run prettier --fix

- * chore(repo): run ci.yml action to get everything passing

- * fix: Bump fast-xml-parser from 5.3.3 to 5.3.4 #38

- * chore(repo): generate changelog

- * fix: fix issue after updating fast-xml-parser

- * chore(repo): fix fast-xml-parser version. got reverted

- * fix: missing icon for gradle and makefile in recent tasks group


### ⚙️ Miscellaneous Tasks

- *(repo)* Added configuration documenation

- *(repo)* Bump version



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.1...v1.1.2

## [1.1.1] - 2026-01-30

### 🚀 Features

- *(ux)* Add settings to show or hide different task hover icons #32

- Improved Task Grouping for visibility in mono repo or workspace with a lot of the same task type. #30


### 💼 Other

- V1.1.1 (#34)

- * feat: Deno task support

- * chore(changelog): update cliff config

- * chore(changelog): generate changelog

- * feat(ux): Add task hover button for showing the task location #33

- * chore(repo): modified the CONTRIBUTING document

- * chore(repo): fix linter errors in markdown

- * chore(repo): fix linter errors in markdown

- * chore(changelog): update changelog

- * chore(repo): fix PR review comments

- * chore(repo): update version to v1.1.1


### ⚙️ Miscellaneous Tasks

- Added CONTRIBUTING and CODE_OF_CONDUCT



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.1.0...v1.1.1

## [1.1.0] - 2026-01-29

### 🐛 Bug Fixes

- Add colors to the action buttons for tasks (#21) (#26)


### 💼 Other

- V1.1.0 (#27)

- * feat(ux): Add an Explorer view for tasks #15

- * chore(tests): work on the test coverage

- * chore(commands): code cleanup of some commands

- * chore(repo): remove runQueue command from extension.activate

- * chore(repo): completed commands refactor

- * feat(ux): Configurable click behavior of tasks #25

- * feat(ux): Allow to disable checkmark after first execution of task #24

- * chore(sample): update a sample file

- * fix: Add colors to the action buttons for tasks - favorites #21

- * feat(tasks): Add setting to control task terminal panel behavior #20


### ⚙️ Miscellaneous Tasks

- *(repo)* SUPPORT document and assets for it



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.0.3...v1.1.0

## [1.0.3] - 2026-01-27

### 💼 Other

- V1.0.3 (#17)

- * chore(deps): update dependency version for @types/node

- * feat(tasks): added support for jupyter notebooks via the ms-toolsai.jupyter extensionn

- * chore(task): ensure that the Tasks root has the proper icon

- * chore(repo): fix typo and lint issues

- * feat(tasks): add abilitity to double click task item to run it #10

- * chore: Fix readme markdown error.

- * feat: jupyter notebook support added in recent commit #11

- * feat: update tasks to support double click to execute #10

- * tests: add Configuration tests for settings get/update and event handling

- * chore(repo): setup some actions and scripts for helping with testing -> publish

- * fix: preserve taskFileUri and taskSource when cloning items for Favorites/Recent so workspace tasks remain runnable

- * fix(tree): propagate original task ID to split tasks to prevent ID collisions in grouped trees

- * chore(repo): moved the samples to a separate repo to get better real world testing out of it

- * fix: fixed an issue with unable to run multiple tasks at the same time.

- * chore(repo): added readme for info on sample repository location

- * fix: grouped tasks by task separator may have wrong icon #13

- * chore(repo): clean up some npm scripts

- * chore(commands): moving commands out of extension.activate

- * chore(commands): moving commands out of extension.activate

- * fix: A few configuration options don't seem to be considered #14

- * chore(changelog): update changelog

- * chore(config): remove unused function to check status of shell type

- * feat(tasks): Restrict task search depth. #16

- * chore: cleanup unused changelog tool configuration


### ⚙️ Miscellaneous Tasks

- *(repo)* Tooling config cleanup



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.0.2...v1.0.3

## [1.0.2] - 2026-01-25

### 💼 Other

- V1.0.2 Release (#9)

- * mise implementation

- * mise implementation

- * some code cleanup that copilot identified

- * fix readme lint errors

- * start implementation of maven support

- * fix: github actions not respecting the ignore definitions. #7

- * feat: add inline restart for running tasts. #6

- * chore(docs): Updated readme on running tasks

- * feat(maven): maven task provider implemented

- * feat: work on the recent tasks feature

- * feat(recent): recent task tree items #4

- * feat(tasks): some pre-work and samples for supporting jupyter notebooks

- * fix: Adding / Removing favorites is very slow #3

- * chore(sample): updated the sample workspace to disable powershell profile

- * fix: Additional performance improvements when loading the task tree. #3

- * fix: Task types not removed from tree after disabled in the settings #8

- * chore(repo): setup some changelog generation

- * chore(settings): fixed missing settings translation

- * chore(settings): fixed configuration settings reference

- * chore(repo): added .tasksignore to ignore list for vsix package



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.0.1...v1.0.2

## [1.0.1] - 2026-01-24

### 🐛 Bug Fixes

- Fix readme error and dependabot config

- Fix readme error


### 💼 Other

- Initial commit

- Initial commit

- Removed the context menu for now

- Added some scafolding for settings

- More task providers

- Update icons. add more task providers

- Set up eslint and update packages

- Revert dynamic TOML import and fallback parsing; remove helper and fallback tests

- Added settings for github-actions and path config for act.

- Update the readme to fix some lint errors

- Added github actions support

- Some refactoring of configuration

- More cleanup of settings

- Improve provider file-watching, venv handling, and Ant/ansicon execution

- Updated and added some npm built-in tasks

- Prepare for 'public' repository

- Prepare for 'public' repository

- Version bump for first public publish - 1.0.1


### 🚜 Refactor

- Refactoring and implementation

- Refactor the shell task provider to be flexible for just about any type of 'shell executed script'


### 📚 Documentation

- Documentation cleanup. yarn/pnpm support. png images for docs


### ◀️ Revert

- Reverted some changes and update the target



