import * as vscode from 'vscode';

export interface IBaseTaskConfiguration {
  type: 'shell' | 'process';
  command: string;
  isBackground?: boolean;
  args?: string[];
  options?: ICommandOptions;
  problemMatcher?: string | IProblemMatcher | (string | IProblemMatcher)[];
  // array of mix of ITaskDescription and ICompoundTaskDescription
  tasks?: (ITaskDescription | ICompoundTaskDescription)[];
}

export interface ITaskConfiguration extends IBaseTaskConfiguration {
  version: '2.0.0';
  /**
   * Windows specific task configuration
   */
  windows?: IBaseTaskConfiguration;

  /**
   * macOS specific task configuration
   */
  osx?: IBaseTaskConfiguration;

  /**
   * Linux specific task configuration
   */
  linux?: IBaseTaskConfiguration;
}

export interface ICommandOptions {
  cwd?: string;
  env?: { [key: string]: string };
  shell?: IShellConfiguration;
}

export interface IShellConfiguration {
  executable: string;
  args?: string[];
}

/**
 * A description of a problem matcher that detects problems
 * in build output.
 */
export interface IProblemMatcher {
  /**
   * The name of a base problem matcher to use. If specified the
   * base problem matcher will be used as a template and properties
   * specified here will replace properties of the base problem
   * matcher
   */
  base?: string;

  /**
   * The owner of the produced VS Code problem. This is typically
   * the identifier of a VS Code language service if the problems are
   * to be merged with the one produced by the language service
   * or 'external'. Defaults to 'external' if omitted.
   */
  owner?: string;

  /**
   * A human-readable string describing the source of this problem.
   * E.g. 'typescript' or 'super lint'.
   */
  source?: string;

  /**
   * The severity of the VS Code problem produced by this problem matcher.
   *
   * Valid values are:
   *   "error": to produce errors.
   *   "warning": to produce warnings.
   *   "info": to produce infos.
   *
   * The value is used if a pattern doesn't specify a severity match group.
   * Defaults to "error" if omitted.
   */
  severity?: string;

  /**
   * Defines how filename reported in a problem pattern
   * should be read. Valid values are:
   *  - "absolute": the filename is always treated absolute.
   *  - "relative": the filename is always treated relative to
   *    the current working directory. This is the default.
   *  - ["relative", "path value"]: the filename is always
   *    treated relative to the given path value.
   *  - "autodetect": the filename is treated relative to
   *    the current workspace directory, and if the file
   *    does not exist, it is treated as absolute.
   *  - ["autodetect", "path value"]: the filename is treated
   *    relative to the given path value, and if it does not
   *    exist, it is treated as absolute.
   *  - "search": performs a deep (and, possibly, heavy) file system
   *    search within the directories.
   *  - ["search", {include: ["${workspaceFolder}"]}]: performs
   *    a deep search among the directories given in the "include" array.
   *  - ["search", {include: ["${workspaceFolder}"], exclude: []}]:
   *    performs a deep search among the directories given in the "include"
   *    array, excluding those named in the "exclude" array.
   */
  fileLocation?: string | string[] | ['search', { include?: string[]; exclude?: string[] }];

  /**
   * The name of a predefined problem pattern, the inline definition
   * of a problem pattern or an array of problem patterns to match
   * problems spread over multiple lines.
   */
  pattern?: string | IProblemPattern | IProblemPattern[];

  /**
   * Additional information used to detect when a background task (like a watching task in Gulp)
   * is active.
   */
  background?: IBackgroundMatcher;
}

/**
 * A description to track the start and end of a background task.
 */
export interface IBackgroundMatcher {
  /**
   * If set to true the watcher is in active mode when the task
   * starts. This is equals of issuing a line that matches the
   * beginPattern.
   */
  activeOnStart?: boolean;

  /**
   * If matched in the output the start of a background task is signaled.
   */
  beginsPattern?: string;

  /**
   * If matched in the output the end of a background task is signaled.
   */
  endsPattern?: string;
}

export interface IProblemPattern {
  /**
   * The regular expression to find a problem in the console output of an
   * executed task.
   */
  regexp: string;

  /**
   * Whether the pattern matches a problem for the whole file or for a location
   * inside a file.
   *
   * Defaults to "location".
   */
  kind?: 'file' | 'location';

  /**
   * The match group index of the filename.
   */
  file: number;

  /**
   * The match group index of the problem's location. Valid location
   * patterns are: (line), (line,column) and (startLine,startColumn,endLine,endColumn).
   * If omitted the line and column properties are used.
   */
  location?: number;

  /**
   * The match group index of the problem's line in the source file.
   * Can only be omitted if location is specified.
   */
  line?: number;

  /**
   * The match group index of the problem's column in the source file.
   */
  column?: number;

  /**
   * The match group index of the problem's end line in the source file.
   *
   * Defaults to undefined. No end line is captured.
   */
  endLine?: number;

  /**
   * The match group index of the problem's end column in the source file.
   *
   * Defaults to undefined. No end column is captured.
   */
  endColumn?: number;

  /**
   * The match group index of the problem's severity.
   *
   * Defaults to undefined. In this case the problem matcher's severity
   * is used.
   */
  severity?: number;

  /**
   * The match group index of the problem's code.
   *
   * Defaults to undefined. No code is captured.
   */
  code?: number;

  /**
   * The match group index of the message. Defaults to 0.
   */
  message: number;

  /**
   * Specifies if the last pattern in a multi line problem matcher should
   * loop as long as it does match a line consequently. Only valid on the
   * last problem pattern in a multi line problem matcher.
   */
  loop?: boolean;
}

export interface IPresentationOptions {
  /**
   * Controls whether the task output is reveal in the user interface.
   * Defaults to `always`.
   */
  reveal?: 'never' | 'silent' | 'always';

  /**
   * Controls whether the command associated with the task is echoed
   * in the user interface. Defaults to `true`.
   */
  echo?: boolean;

  /**
   * Controls whether the panel showing the task output is taking focus.
   * Defaults to `false`.
   */
  focus?: boolean;

  /**
   * Controls if the task panel is used for this task only (dedicated),
   * shared between tasks (shared) or if a new panel is created on
   * every task execution (new). Defaults to `shared`.
   */
  panel?: 'shared' | 'dedicated' | 'new';

  /**
   * Controls whether to show the `Terminal will be reused by tasks,
   * press any key to close it` message.
   */
  showReuseMessage?: boolean;

  /**
   * Controls whether the terminal is cleared before this task is run.
   * Defaults to `false`.
   */
  clear?: boolean;

  /**
   * Controls whether the task is executed in a specific terminal
   * group using split panes. Tasks in the same group (specified by a string value)
   * will use split terminals to present instead of a new terminal panel.
   */
  group?: string;

  /**
   * Controls whether the terminal is closed when the task ends.
   * Defaults to `false`.
   */
  close?: boolean;
}

export interface ICompoundTaskDescription {
  label: string;
  dependsOn?: string[];
  dependsOrder?: 'sequence' | 'parallel';
  presentation?: IPresentationOptions;
}

/**
 * The description of a task.
 */
export interface ITaskDescription {
  /**
   * The task's name
   */
  label: string;

  /**
   * The type of a custom task. Tasks of type "shell" are executed
   * inside a shell (e.g. bash, cmd, powershell, ...)
   */
  type: 'shell' | 'process';

  /**
   * The command to execute. If the type is "shell" it should be the full
   * command line including any additional arguments passed to the command.
   */
  command: string;

  /**
   * The command options such as the current working directory
   * and environment variables.
   */
  options?: ICommandOptions;

  /**
   * Whether the executed command is kept alive and runs in the background.
   */
  isBackground?: boolean;

  /**
   * Additional arguments passed to the command. Should be used if type
   * is "process".
   */
  args?: string[];

  /**
   * Defines the group to which this task belongs. Also supports to mark
   * a task as the default task in a group.
   */
  group?: string | { kind: string; isDefault: boolean };

  /**
   * The presentation options.
   */
  presentation?: IPresentationOptions;

  /**
   * The problem matcher(s) to use to capture problems in the tasks
   * output.
   */
  problemMatcher?: string | IProblemMatcher | (string | IProblemMatcher)[];

  /**
   * Defines when and how a task is run.
   */
  runOptions?: IRunOptions;
}




/**
 * A description to when and how run a task.
 */
export interface IRunOptions {
  /**
   * Controls how variables are evaluated when a task is executed through
   * the Rerun Last Task command.
   * The default is `true`, meaning that variables will be re-evaluated when
   * a task is rerun. When set to `false`, the resolved variable values from
   * the previous run of the task will be used.
   */
  reevaluateOnRerun?: boolean;

  /**
   * Specifies when a task is run.
   *
   * Valid values are:
   *   "default": The task will only be run when executed through the Run Task command.
   *   "folderOpen": The task will be run when the containing folder is opened.
   */
  runOn?: string;
}
