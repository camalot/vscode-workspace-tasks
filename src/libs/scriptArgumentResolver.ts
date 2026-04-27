/**
 * Core types and interfaces for script argument resolution.
 *
 * A `ScriptArgumentResolver` is a strategy object that inspects a script file
 * (statically or via an external process) and returns the parameters that the
 * script accepts.  Multiple resolvers may be registered for a single shell type;
 * they are tried in registration order and the first result with `supported: true`
 * and at least one parameter wins.
 */

export interface ScriptParameter {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool' | 'switch' | 'unknown';
  required: boolean;
  defaultValue?: string;
  /** ValidateSet (PowerShell) or argparse `choices` (Python). */
  choices?: string[];
  description?: string;
  /**
   * The CLI flag name when it differs from `name`.
   * For Python argparse long flags: '--arg-name' (may differ from the variable name).
   */
  cliName?: string;
  /**
   * argparse `nargs` value: '?', '*', '+', or an integer N.
   * '?': 0 or 1 value; '*': 0 or more; '+': 1 or more; N: exactly N values.
   */
  nargs?: string | number;
  /**
   * argparse `action` value: 'store_true', 'store_false', 'append', 'append_const',
   * 'extend', 'count', etc.  'help' and 'version' are stripped at parse time.
   */
  action?: string;
}

export interface ArgumentResolveResult {
  /**
   * `false` means this resolver cannot handle the file (e.g. no `param()` block found,
   * argparse not imported, etc.).  The registry will try the next resolver.
   */
  supported: boolean;
  parameters: ScriptParameter[];
}

/**
 * A strategy for discovering the parameters of a script file.
 *
 * Implement this interface to add a new resolver (e.g. sys.argv parser for Python,
 * Click decorator parser, etc.).  Register instances with
 * `ScriptArgumentResolverRegistry.register()`.
 *
 * Resolvers are responsible for their own workspace-trust checks when spawning
 * processes — they must NOT spawn if the workspace is not trusted.
 */
export interface ScriptArgumentResolver {
  /**
   * Human-readable name used in logging.
   */
  readonly name: string;

  /**
   * Returns `true` when this resolver can potentially handle the given file path
   * (typically based on extension).  Returning `true` does not guarantee that
   * `resolve()` will succeed.
   */
  canHandle(filePath: string): boolean;

  /**
   * Attempt to discover the script's parameters.
   *
   * @param filePath  Absolute path to the script file.
   * @param content   Raw UTF-8 content of the script file (already read by the
   *                  caller so resolvers that do only static analysis do not need
   *                  to perform IO).
   * @returns A resolved `ArgumentResolveResult`.  Return `{ supported: false,
   *          parameters: [] }` when the resolver cannot handle this particular
   *          file (different from a runtime error — errors should be thrown).
   */
  resolve(filePath: string, content: string): Promise<ArgumentResolveResult>;
}
