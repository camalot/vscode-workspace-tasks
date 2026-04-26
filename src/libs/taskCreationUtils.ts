import * as vscode from 'vscode';
import * as path from 'path';
import { TaskItem } from '../taskItem';

/**
 * The result of building a task for a given TaskItem.
 * Native tasks wrap a pre-existing vscode.Task (e.g. from getSystemTasks()).
 * Provider-built tasks set native: false.
 */
export interface CreatedTask {
  task: vscode.Task;
  /** The resolved shell command string, if any. */
  command?: string;
  cwd?: string;
  native: boolean;
}

/**
 * Resolved context for building a task from a TaskItem.
 * Obtained via resolveTaskContext().
 */
export interface TaskContext {
  /**
   * The real file URI for the task (item.taskFileUri only).
   * undefined when no file is associated with the task item.
   * Use this to guard cases that require a real file (e.g. shell, msbuild).
   *
   * Note: item.resourceUri is always a synthetic workspace-tasks:// URI set by
   * TaskItem.updateContextValue() and is NOT a usable file path. This field
   * intentionally uses only item.taskFileUri.
   */
  effectiveResourceUri: vscode.Uri | undefined;

  /**
   * Always a file:// URI — effectiveResourceUri when set, otherwise the first
   * workspace folder root (or process.cwd() as last resort).
   * Safe to pass to path.dirname(), vscode.workspace.getWorkspaceFolder(), etc.
   */
  resourceUri: vscode.Uri;

  /** Directory to use as working directory for the task. */
  cwd: string;

  /** The VS Code workspace folder containing the task file, or the first folder as fallback. */
  workspaceFolder: vscode.WorkspaceFolder | undefined;
}

/**
 * Resolves all file/path context needed to create a task for a given TaskItem.
 *
 * Uses item.taskFileUri as the authoritative file URI. item.resourceUri is always
 * a synthetic workspace-tasks:// URI (set by updateContextValue()) and is not a
 * valid file path — it is deliberately excluded from effectiveResourceUri.
 */
export function resolveTaskContext(item: TaskItem): TaskContext {
  const effectiveResourceUri = item.taskFileUri;
  const cwd = effectiveResourceUri
    ? path.dirname(effectiveResourceUri.fsPath)
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const fallbackWorkspaceUri =
    vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(cwd);
  const resourceUri = effectiveResourceUri ?? fallbackWorkspaceUri;
  const workspaceFolder = effectiveResourceUri
    ? vscode.workspace.getWorkspaceFolder(effectiveResourceUri)
    : vscode.workspace.workspaceFolders?.[0];
  return { effectiveResourceUri, resourceUri, cwd, workspaceFolder };
}

/**
 * Splits a user-supplied args string into an array with basic quote awareness.
 * Single- and double-quoted tokens (with embedded spaces) are kept as single elements.
 * Returns an empty array for undefined or whitespace-only input.
 *
 * @example
 * splitArgs('--flag value')           // ['--flag', 'value']
 * splitArgs("--name 'John Doe'")      // ['--name', 'John Doe']
 * splitArgs('--key="spaced value"')   // ['--key=spaced value']
 */
export function splitArgs(args?: string): string[] {
  if (!args || args.trim().length === 0) {
    return [];
  }
  const result: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

/**
 * Parses a command string into an executable + args array, then injects user-supplied
 * arguments. Returns values suitable for ShellExecution(command, args, options),
 * preventing shell injection by treating each argument as a discrete quoted token.
 *
 * Injection rules:
 *  - If the parsed args array contains a token that exactly equals "${args}", all such
 *    tokens are replaced by the elements of splitArgs(userArgs).
 *  - If a token contains "${args}" as an embedded substring (e.g. "--name=${args}"),
 *    the substring is replaced with splitArgs(userArgs).join(' '), keeping it a single token.
 *  - If no "${args}" token is found, splitArgs(userArgs) elements are appended at the end.
 *
 * @param commandString  Resolved command string (may contain "${args}" placeholder).
 * @param userArgs       Raw user-typed argument string from "Run with Args", or undefined.
 * @returns              { command, args } ready for new ShellExecution(command, args, options).
 */
export function injectArgs(
  commandString: string,
  userArgs?: string,
): { command: string; args: string[] } {
  const tokens = splitArgs(commandString);
  if (tokens.length === 0) {
    return { command: commandString.trim(), args: [] };
  }

  const [executable, ...baseArgs] = tokens;
  const userArgTokens = splitArgs(userArgs);

  // No user args to inject — strip any ${args} placeholder tokens so the shell does not
  // receive the literal string "${args}" as an argument, then return.
  if (userArgTokens.length === 0) {
    const cleanArgs = baseArgs.filter((a) => !a.includes('${args}'));
    return { command: executable, args: cleanArgs };
  }

  const hasExact = baseArgs.includes('${args}');
  const hasPartial = !hasExact && baseArgs.some((a) => a.includes('${args}'));

  if (hasExact) {
    // Replace every exact "${args}" token with the user arg tokens.
    const finalArgs: string[] = [];
    for (const token of baseArgs) {
      if (token === '${args}') {
        finalArgs.push(...userArgTokens);
      } else {
        finalArgs.push(token);
      }
    }
    return { command: executable, args: finalArgs };
  }

  if (hasPartial) {
    // Replace "${args}" substring within tokens with user args joined as a single value.
    const joined = userArgTokens.join(' ');
    const finalArgs = baseArgs.map((a) => a.replace(/\$\{args\}/g, joined));
    return { command: executable, args: finalArgs };
  }

  // No placeholder — append user args at end
  return { command: executable, args: [...baseArgs, ...userArgTokens] };
}

/** Options for buildShellTask(). */
export interface BuildShellTaskOptions {
  /** The VS Code task type (e.g. 'npm', 'yarn'). */
  type: string;
  /** The human-readable task label. */
  label: string;
  /** The executable command. */
  command: string;
  /** Arguments to pass to the command. */
  args: string[];
  /** Working directory for the task. */
  cwd: string;
  /** File URI embedded in the task definition as `path`. */
  resourceUri: vscode.Uri;
  /**
   * Override the default task definition shape.
   * Defaults to `{ type, script: label, path: resourceUri.fsPath }`.
   */
  definitionOverride?: vscode.TaskDefinition;
}

/**
 * Constructs a CreatedTask using array-form ShellExecution — the standard form for
 * provider-based tasks. Returns a fully assembled CreatedTask ready to be returned
 * from a provider's createTask() implementation.
 *
 * Providers that require string-form execution (e.g. ant with ansicon) or
 * CustomExecution (e.g. jupyter) should not use this helper and must construct
 * their vscode.Task directly.
 */
export function buildShellTask(options: BuildShellTaskOptions): CreatedTask {
  const { type, label, command, args, cwd, resourceUri, definitionOverride } = options;
  const definition: vscode.TaskDefinition = definitionOverride ?? {
    type,
    script: label,
    path: resourceUri.fsPath,
  };
  const shellExec = new vscode.ShellExecution(command, args, { cwd });
  const task = new vscode.Task(
    definition,
    vscode.TaskScope.Workspace,
    label,
    type,
    shellExec,
  );
  const commandStr = args.length > 0 ? `${command} ${args.join(' ')}` : command;
  return { task, command: commandStr, cwd, native: false };
}
