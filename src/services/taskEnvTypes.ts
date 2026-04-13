import { IEnvFileReference } from './workspaceTasksService';

/**
 * Criteria used to select which tasks a rule applies to.
 * All specified fields must match (AND logic).
 */
export interface ITaskMatcher {
  /** Task name: exact string, glob pattern (e.g. `publish*`), or `/regex/` string. */
  taskName?: string;
  /** Task source/type (e.g. `"npm"`, `"shell"`). Accepts a string or array (any element must match). */
  taskType?: string | string[];
  /** Source file glob pattern(s) matched against the task definition file path. */
  source?: string | string[];
  /** Workspace folder name (not path) for multi-root scoping. */
  workspaceFolder?: string;
}

/**
 * A single per-task environment variable rule from `workspaceTasks.taskEnv`.
 */
export interface ITaskEnvRule {
  match: ITaskMatcher;
  env?: Record<string, string>;
  envFiles?: IEnvFileReference;
  secretFiles?: IEnvFileReference;
  /** Maps environment variable names to VS Code SecretStorage keys. */
  secrets?: Record<string, string>;
  /** Set to `false` to disable this rule without removing it. Default: `true`. */
  enabled?: boolean;
}

/**
 * Discriminated union identifying the layer that produced an env entry.
 * Used for source annotation in the inspector command (Phase 6).
 */
export type EnvEntrySource =
  | 'globalSetting'       // workspaceTasks.env
  | 'globalEnvFile'       // workspaceTasks.envFiles
  | 'globalSecretFile'    // workspaceTasks.secretFiles            (isSecret = true)
  | 'blockEnvFile'        // language-block envFiles
  | 'blockEnv'            // language-block env
  | 'blockSecretFile'     // language-block secretFiles            (isSecret = true)
  | 'taskEnvFile'         // per-task envFiles  (.workspace-tasks.json)
  | 'taskEnv'             // per-task env       (.workspace-tasks.json)
  | 'taskSecretFile'      // per-task secretFiles                  (isSecret = true)
  | 'taskSecretStorage'   // per-task secrets → SecretStorage      (isSecret = true)
  | 'ruleEnvFile'         // taskEnv rule envFiles
  | 'ruleEnv'             // taskEnv rule env
  | 'ruleSecretFile'      // taskEnv rule secretFiles              (isSecret = true)
  | 'ruleSecretStorage';  // taskEnv rule secrets → SecretStorage  (isSecret = true)

/**
 * A resolved environment variable entry with full provenance information.
 */
export interface IResolvedEnvEntry {
  value: string;
  source: EnvEntrySource;
  /** Human-readable source description, e.g. `".env.local (workspaceTasks.envFiles)"`. */
  sourceLabel: string;
  /** `true` when the value originated from a `.secret` file or VS Code SecretStorage. */
  isSecret: boolean;
}

/**
 * Minimal view of a language-block or per-task config needed for env resolution.
 * Structurally compatible with both `LanguageTaskConfig` and `FileTaskDefinition`.
 */
export interface ILanguageEnvConfig {
  env?: Record<string, string>;
  envFiles?: IEnvFileReference;
  secretFiles?: IEnvFileReference;
}
