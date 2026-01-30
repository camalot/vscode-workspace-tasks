import * as vscode from 'vscode';
import * as path from 'path';
import { BaseTaskProvider, TaskProvider } from '../taskProvider';
import { TaskItem } from '../taskItem';
import { TaskFilesService } from '../services/taskFilesService';
import constants from '../libs/constants';
import { TaskIconService } from '../services/taskIconService';
import { ExecutableService, ExecutableResult } from '../services/executableService';

export class GulpTaskProvider extends BaseTaskProvider implements TaskProvider {
  constructor() {
    super('gulp', constants.GLOB_GULP);
  }

  public getCommand(workspaceUri?: vscode.Uri): ExecutableResult {
    const execService = ExecutableService.getInstance();
    return execService.getCommand({
      defaultValue: 'npx gulp',
      configName: 'gulp',
      resolveToAbsolutePath: false,
      windowsExecutableExtension: undefined,
      windowsEnforceExtension: false
    }, workspaceUri);
  }

  async getTasks(): Promise<TaskItem[]> {
    if (!this.enabled) { return []; }

    const tasks: TaskItem[] = [];
    const filesService = TaskFilesService.getInstance();
    const iconService = TaskIconService.getInstance();

    // Support both gulpfile.js and gulpfile.mjs
    const files = await filesService.findFiles([constants.GLOB_GULP]);

    for (const file of files) {
      try {

        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();
        const lines = content.split('\n');
        const displayUri = vscode.Uri.file(path.join(path.dirname(file.fsPath), 'gulpfile.js'));
        const iconUri = iconService.getTaskTypeIcon('gulp', displayUri);
        // We'll also collect named functions/exports so identifiers referenced in series/parallel can be resolved
        const fileText = content;



        // First pass: find explicit task definitions and exports
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Match gulp.task('name', ...) or gulp.task("name", ...)
          const taskMatch = line.match(/gulp\.task\(\s*['"`]([\w\-:\.]+)['"`]/);
          if (taskMatch) {
            const name = taskMatch[1];
            const item = new TaskItem(
              name,
              vscode.TreeItemCollapsibleState.None,
              'gulp',
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i]
            };
            // console.log(`[GulpTaskProvider] Discovered task '${name}' in ${file.fsPath}`);
            tasks.push(item);
            continue;
          }

          // Match module.exports.myTask = ... or exports.myTask = ...
          const exportsMatch = line.match(/(?:module\.exports\.|exports\.)\s*([A-Za-z0-9_\-]+)\s*=\s*/);
          if (exportsMatch) {
            const name = exportsMatch[1];
            const item = new TaskItem(
              name,
              vscode.TreeItemCollapsibleState.None,
              'gulp',
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i]
            };
            // console.log(`[GulpTaskProvider] Discovered export task '${name}' in ${file.fsPath}`);
            tasks.push(item);
            continue;
          }

          // Match ES module exports: export function name ... or export const name =
          const esExportMatch = line.match(/export\s+(?:async\s+function|function|const|let|var)\s+([A-Za-z0-9_\-]+)/);
          if (esExportMatch) {
            const name = esExportMatch[1];
            const item = new TaskItem(
              name,
              vscode.TreeItemCollapsibleState.None,
              'gulp',
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i]
            };
            // console.log(`[GulpTaskProvider] Discovered export function '${name}' in ${file.fsPath}`);
            tasks.push(item);
            continue;
          }

          // Match ES module export alias: export { name as 'alias' }
          const esExportAliasMatch = line.match(/export\s+\{\s*[\w\d_$]+\s+as\s+['"`]([\w\-:\.]+)['"`]\s*\}/);
          if (esExportAliasMatch) {
            const name = esExportAliasMatch[1];
            const item = new TaskItem(
              name,
              vscode.TreeItemCollapsibleState.None,
              'gulp',
              iconUri?.DisplayUri || file,
              undefined,
              iconUri?.TaskIcon || undefined
            );
            item.taskFileUri = file;
            item.description = vscode.workspace.asRelativePath(file);
            item.startLine = i;
            item.onOpenActionCommand = {
              command: 'workspaceTasks.openFileAtLine',
              title: 'Open File',
              arguments: [file, i]
            };
            //  console.log(`[GulpTaskProvider] Discovered export alias '${name}' in ${file.fsPath}`);
            tasks.push(item);
            continue;
          }
        }

        // Second pass: detect tasks referenced in gulp.series() or gulp.parallel()
        const seriesRegex = /gulp\.(?:series|parallel)\s*\(([^)]+)\)/g;
        let seriesMatch: RegExpExecArray | null;
        while ((seriesMatch = seriesRegex.exec(fileText)) !== null) {
          const argsText = seriesMatch[1];
          // find string literal task names
          const nameRegex = /['"`]([\w\-:\.]+)['"`]/g;
          let nameMatch: RegExpExecArray | null;
          while ((nameMatch = nameRegex.exec(argsText)) !== null) {
            const name = nameMatch[1];
            // Avoid duplicates
            if (!tasks.find(t => t.label === name)) {
              const item = new TaskItem(
                name,
                vscode.TreeItemCollapsibleState.None,
                'gulp',
                iconUri?.DisplayUri || file,
                undefined,
                iconUri?.TaskIcon || undefined
              );
              item.taskFileUri = file;
              item.description = vscode.workspace.asRelativePath(file);
              item.onOpenActionCommand = {
                command: 'workspaceTasks.openFileAtLine',
                title: 'Open File',
                arguments: [file, 0]
              };
              // console.log(`[GulpTaskProvider] Discovered series/parallel referenced task '${name}' in ${file.fsPath}`);
              tasks.push(item);
            }
          }

          // Also check for identifier references and try to resolve them to functions/exports
          const idRegex = /\b([A-Za-z_\$][\w\$]*)\b/g;
          let idMatch: RegExpExecArray | null;
          while ((idMatch = idRegex.exec(argsText)) !== null) {
            const id = idMatch[1];
            // skip known keywords like gulp, series, parallel
            if (/^gulp$|^series$|^parallel$/.test(id)) { continue; }
            // Try to find a function/variable/export declaration for this identifier
            const declRegex = new RegExp(`(?:function\\s+${id}\\s*\\(|(?:const|let|var)\\s+${id}\\s*=)|(?:exports\\.${id}\s*=)|(?:module\\.exports\\.${id}\s*=)`);
            if (declRegex.test(fileText)) {
              if (!tasks.find(t => t.label === id)) {
                const item = new TaskItem(
                  id,
                  vscode.TreeItemCollapsibleState.None,
                  'gulp',
                  iconUri?.DisplayUri || file,
                  undefined,
                  iconUri?.TaskIcon || undefined
                );
                item.taskFileUri = file;
                item.description = vscode.workspace.asRelativePath(file);
                item.onOpenActionCommand = {
                  command: 'workspaceTasks.openFileAtLine',
                  title: 'Open File',
                  arguments: [file, 0]
                };
                // console.log(`[GulpTaskProvider] Discovered referenced identifier task '${id}' in ${file.fsPath}`);
                tasks.push(item);
              }
            }
          }
        }

      } catch (e) {
        console.error(`Error parsing Gulpfile: ${file.fsPath}`, e);
      }
    }

    return tasks;
  }
}
