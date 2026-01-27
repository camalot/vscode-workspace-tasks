
1.0.3
=============
2026-01-27

* fix: A few configuration options don't seem to be considered #14 (7651f899)
* chore(commands): moving commands out of extension.activate (1b2087c6)
* chore(commands): moving commands out of extension.activate (a40288ea)
* chore(repo): clean up some npm scripts (586312ba)
* fix: grouped tasks by task separator may have wrong icon #13 (f398092e)
* chore(repo): added readme for info on sample repository location (88673fae)
* chore(repo): moved the samples to a separate repo to get better real world testing out of it (dd9e83e9)
* fix(tree): propagate original task ID to split tasks to prevent ID collisions in grouped trees (70fc255a)
* fix: preserve taskFileUri and taskSource when cloning items for Favorites/Recent so workspace tasks remain runnable (9ee390b7)
* chore(repo): setup some actions and scripts for helping with testing -> publish (074799f1)
* tests: add Configuration tests for settings get/update and event handling (b671fe01)
* feat: update tasks to support double click to execute #10 (5b084574)
* chore: Fix readme markdown error. (7af2545c)
* feat(tasks): add ability to double click task item to run it #10 (d0bf329d)
* chore(repo): fix typo and lint issues (0bd693f4)
* chore(task): ensure that the Tasks root has the proper icon (93158465)
* feat(tasks): added support for jupyter notebooks via the ms-toolsai.jupyter extensionn (98dd195f)
* chore(deps): update dependency version for @types/node (f9902e05)

1.0.2
=============
2026-01-25

* fix: Task types not removed from tree after disabled in the settings #8 (872c3b74)
* fix: Additional performance improvements when loading the task tree. #3 (5f8e71ea)
* chore(sample): updated the sample workspace to disable powershell profile (111c50e4)
* fix: Adding / Removing favorites is very slow #3 (21992a15)
* feat(tasks): some pre-work and samples for supporting jupyter notebooks (cec0ddeb)
* feat(recent): recent task tree items #4 (348f13bc)
* feat: work on the recent tasks feature (7094b8cf)
* feat(maven): maven task provider implemented (52839cd6)
* chore(docs): Updated readme on running tasks (1727dde2)
* feat: add inline restart for running tasts. #6 (71508027)
* fix: github actions not respecting the ignore definitions. #7 (e86cea75)
* start implementation of maven support (bf69ea77)
* fix readme lint errors (d532d54a)
* some code cleanup that copilot identified (594314fc)
* mise implementation (e8c87028)
* mise implementation (bb059152)
* v1.0.2 Release (#9) (3bd6ef7f)

1.0.1
=============
2026-01-24

* version bump for first public publish - 1.0.1 (442ecebc)
* fix readme error (6f4676c2)
* fix readme error and dependabot config (dc655dd7)
* prepare for 'public' repository (bb0cdf94)
* prepare for 'public' repository (bbe3b041)
* documentation cleanup. yarn/pnpm support. png images for docs (7233d074)
* updated and added some npm built-in tasks (07a5af2f)
* Improve provider file-watching, venv handling, and Ant/ansicon execution (10c1724b)
* more cleanup of settings (7705d16d)
* some refactoring of configuration (1e58b641)
* refactor the shell task provider to be flexible for just about any type of 'shell executed script' (9946e8cf)
* added github actions support (e568adca)
* update the readme to fix some lint errors (9f25f8e3)
* added settings for github-actions and path config for act. (29a88470)
* reverted some changes and update the target (000cabad)
* Revert dynamic TOML import and fallback parsing; remove helper and fallback tests (903154a4)
* set up eslint and update packages (a3cc73ad)
* refactoring and implementation (57826a3b)
* update icons. add more task providers (d2474a4b)
* more task providers (e4d4e543)
* added some scafolding for settings (8f5ffa55)
* removed the context menu for now (da1695e2)
* initial commit (f29defd2)
* Initial commit (1f95a35d)
