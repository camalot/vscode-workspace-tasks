## [1.0.3] - 2026-01-27

### 🚀 Features

- *(tasks)* Added support for jupyter notebooks via the ms-toolsai.jupyter extensionn

- *(tasks)* Add abilitity to double click task item to run it #10

- Jupyter notebook support added in recent commit #11

- Update tasks to support double click to execute #10

-   feat: update tasks to support double click to execute #10


### 🐛 Bug Fixes

- Preserve taskFileUri and taskSource when cloning items for Favorites/Recent so workspace tasks remain runnable

- *(tree)* Propagate original task ID to split tasks to prevent ID collisions in grouped trees

-   fix(tree): propagate original task ID to split tasks to prevent ID collisions in grouped trees

-   fix: preserve taskFileUri and taskSource when cloning items for Favorites/Recent so workspace tasks remain runnable

- Fixed an issue with unable to run multiple tasks at the same time.

- Grouped tasks by task separator may have wrong icon #13

- A few configuration options don't seem to be considered #14


### 💼 Other

- Merge branch 'v1.0.3' of github.com:camalot/vscode-workspace-tasks into v1.0.3

- * 'v1.0.3' of github.com:camalot/vscode-workspace-tasks:


### 🧪 Testing

- Add Configuration tests for settings get/update and event handling

-   tests: add Configuration tests for settings get/update and event handling


### ⚙️ Miscellaneous Tasks

- *(task)* Ensure that the Tasks root has the proper icon

- *(repo)* Fix typo and lint issues

- Fix readme markdown error.

- *(repo)* Setup some actions and scripts for helping with testing -> publish

-   chore(repo): setup some actions and scripts for helping with testing -> publish

- *(repo)* Moved the samples to a separate repo to get better real world testing out of it

- *(repo)* Added readme for info on sample repository location

- *(repo)* Clean up some npm scripts

- *(commands)* Moving commands out of extension.activate

- *(commands)* Moving commands out of extension.activate

- *(changelog)* Update changelog

- *(config)* Remove unused function to check status of shell type



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.0.2...v1.0.3

## [1.0.2] - 2026-01-25

### 💼 Other

- V1.0.2 Release (#9) by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * mise implementation by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * mise implementation by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * some code cleanup that copilot identified by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * fix readme lint errors by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * start implementation of maven support by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * fix: github actions not respecting the ignore definitions. #7 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * feat: add inline restart for running tasts. #6 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(docs): Updated readme on running tasks by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * feat(maven): maven task provider implemented by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * feat: work on the recent tasks feature by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * feat(recent): recent task tree items #4 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * feat(tasks): some pre-work and samples for supporting jupyter notebooks by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * fix: Adding / Removing favorites is very slow #3 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(sample): updated the sample workspace to disable powershell profile by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * fix: Additional performance improvements when loading the task tree. #3 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * fix: Task types not removed from tree after disabled in the settings #8 by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(repo): setup some changelog generation by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(settings): fixed missing settings translation by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(settings): fixed configuration settings reference by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)

- * chore(repo): added .tasksignore to ignore list for vsix package by @camalot in [#9](https://github.com/camalot/vscode-workspace-tasks/pull/9)



**Full Changelog**: https://github.com/camalot/vscode-workspace-tasks/compare/v1.0.1...v1.0.2

## [1.0.1] - 2026-01-24

### 🐛 Bug Fixes

- Fix readme error and dependabot config by @camalot

- Fix readme error by @camalot


### 💼 Other

- Initial commit by @camalot

- Initial commit by @camalot

- Removed the context menu for now by @camalot

- Added some scafolding for settings by @camalot

- More task providers by @camalot

- Update icons. add more task providers by @camalot

- Set up eslint and update packages by @camalot

- Revert dynamic TOML import and fallback parsing; remove helper and fallback tests by @camalot

- Added settings for github-actions and path config for act. by @camalot

- Update the readme to fix some lint errors by @camalot

- Added github actions support by @camalot

- Some refactoring of configuration by @camalot

- More cleanup of settings by @camalot

- Improve provider file-watching, venv handling, and Ant/ansicon execution by @camalot

- Updated and added some npm built-in tasks by @camalot

- Prepare for 'public' repository by @camalot

- Prepare for 'public' repository by @camalot

- Version bump for first public publish - 1.0.1 by @camalot


### 🚜 Refactor

- Refactoring and implementation by @camalot

- Refactor the shell task provider to be flexible for just about any type of 'shell executed script' by @camalot


### 📚 Documentation

- Documentation cleanup. yarn/pnpm support. png images for docs by @camalot


### ◀️ Revert

- Reverted some changes and update the target by @camalot



### New Contributors
* @camalot made their first contribution
