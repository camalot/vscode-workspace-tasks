import * as path from 'path';
import { ScriptArgumentResolver, ArgumentResolveResult, ScriptParameter } from '../scriptArgumentResolver';

/**
 * Resolves Python script parameters by statically parsing `argparse`
 * `add_argument()` calls in the script source.
 *
 * Supported patterns:
 * - `import argparse` / `from argparse import ArgumentParser` detection
 * - `parser.add_argument('--name', ...)` and `parser.add_argument('-n', '--name', ...)`
 * - `type=int`, `type=float`, `type=str` → type mapping
 * - `required=True/False`
 * - `default=...` (string and numeric literals only)
 * - `choices=[...]` (string list literals only)
 * - `action='store_true'` / `'store_false'` → bool type
 * - `help='...'` → description
 * - Short form `-n` / long form `--name` (uses long form as canonical name)
 *
 * Known limitations (out of scope for v1):
 * - `argparse.ArgumentParser(parents=[...])` (inherited parsers)
 * - `add_subparsers()` / subcommands
 * - `add_mutually_exclusive_group()`
 * - Dynamic `add_argument` calls inside loops / conditionals
 * - `click`, `typer`, `docopt` libraries
 */
export class PythonArgparseResolver implements ScriptArgumentResolver {
  public readonly name = 'PythonArgparseResolver';

  public canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.py';
  }

  public async resolve(_filePath: string, content: string): Promise<ArgumentResolveResult> {
    if (!this.hasArgparse(content)) {
      return { supported: false, parameters: [] };
    }

    const parameters = this.parseAddArgumentCalls(content);
    return { supported: true, parameters };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private hasArgparse(content: string): boolean {
    return /^\s*import\s+argparse\b/m.test(content)
      || /^\s*from\s+argparse\s+import\b/m.test(content);
  }

  /**
   * Extracts all `add_argument(...)` calls from the content using a simple
   * single-pass approach that handles multi-line calls.  We do not attempt
   * full Python AST parsing; calls inside loops or conditionals may be missed
   * (this is explicitly documented as acceptable behaviour).
   */
  private parseAddArgumentCalls(content: string): ScriptParameter[] {
    const parameters: ScriptParameter[] = [];

    // Match `add_argument(...)` calls, capturing balanced parentheses.
    const callPattern = /\.add_argument\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = callPattern.exec(content)) !== null) {
      const start = match.index + match[0].length - 1; // position of opening '('
      const argsStr = this.extractBalancedParens(content, start);
      if (argsStr === undefined) {
        continue;
      }
      const param = this.parseArgCall(argsStr);
      if (param) {
        parameters.push(param);
      }
    }

    return parameters;
  }

  /** Extracts the content inside balanced parentheses starting at `openPos`. */
  private extractBalancedParens(content: string, openPos: number): string | undefined {
    if (content[openPos] !== '(') {
      return undefined;
    }
    let depth = 0;
    let start = openPos + 1;
    for (let i = openPos; i < content.length; i++) {
      if (content[i] === '(') {
        depth++;
      } else if (content[i] === ')') {
        depth--;
        if (depth === 0) {
          return content.slice(start, i);
        }
      }
    }
    return undefined;
  }

  /**
   * Parses the argument string inside a single `add_argument(...)` call.
   *
   * Examples:
   *   `'--name', type=str, required=True, help='The name'`
   *   `'-n', '--name', default='foo'`
   *   `'--dry-run', action='store_true'`
   *   `'--verbose', action='count'`
   *   `'--hobbies', nargs='*', type=str`
   */
  private parseArgCall(argsStr: string): ScriptParameter | undefined {
    // Collect positional string literals (the flag names come first).
    const flagPattern = /(['"])(-{1,2}[\w-]+)\1/g;
    const flags: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = flagPattern.exec(argsStr)) !== null) {
      flags.push(m[2]);
    }

    if (flags.length === 0) {
      return undefined; // positional arg without --flag syntax, skip
    }

    // Prefer the long form (--name) as the canonical name.
    const longFlag = flags.find((f) => f.startsWith('--'));
    const shortFlag = flags.find((f) => f.startsWith('-') && !f.startsWith('--'));
    const cliName = longFlag ?? shortFlag;
    if (!cliName) {
      return undefined;
    }

    // Derive the variable name from the long flag: --my-flag → my_flag
    const name = cliName.replace(/^--?/, '').replace(/-/g, '_');

    // action — parse all known values
    const actionMatch = argsStr.match(
      /\baction\s*=\s*(['"])(store_true|store_false|append|append_const|extend|count|help|version)\1/,
    );
    const action = actionMatch ? actionMatch[2] : undefined;

    // Skip help and version arguments entirely — they are meta-actions, not real params
    if (action === 'help' || action === 'version') {
      return undefined;
    }

    // type
    let type: ScriptParameter['type'] = 'string';
    if (action === 'store_true' || action === 'store_false') {
      // Boolean flags: shown as a Yes/No choice, flag present or omitted
      type = 'switch';
    } else {
      const typeMatch = argsStr.match(/\btype\s*=\s*(int|float|str)\b/);
      if (typeMatch) {
        type = this.mapPyType(typeMatch[1]);
      }
    }

    // required
    const requiredMatch = argsStr.match(/\brequired\s*=\s*(True|False)\b/);
    const required = requiredMatch ? requiredMatch[1] === 'True' : false;

    // nargs — '?', '*', '+', or integer N
    let nargs: string | number | undefined;
    const nargsStrMatch = argsStr.match(/\bnargs\s*=\s*(['"])([?*+])\1/);
    const nargsIntMatch = argsStr.match(/\bnargs\s*=\s*(\d+)\b/);
    if (nargsStrMatch) {
      nargs = nargsStrMatch[2];
    } else if (nargsIntMatch) {
      nargs = parseInt(nargsIntMatch[1], 10);
    }

    // default (string and numeric literals only)
    let defaultValue: string | undefined;
    const defaultStrMatch = argsStr.match(/\bdefault\s*=\s*(['"])([^'"]*)\1/);
    const defaultNumMatch = argsStr.match(/\bdefault\s*=\s*(-?\d+(?:\.\d+)?)\b/);
    if (defaultStrMatch) {
      defaultValue = defaultStrMatch[2];
    } else if (defaultNumMatch) {
      defaultValue = defaultNumMatch[1];
    }

    // choices (string list literals only)
    let choices: string[] | undefined;
    const choicesMatch = argsStr.match(/\bchoices\s*=\s*\[([^\]]*)\]/);
    if (choicesMatch) {
      choices = choicesMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }

    // help / description
    let description: string | undefined;
    const helpMatch = argsStr.match(/\bhelp\s*=\s*(['"])([^'"]*)\1/);
    if (helpMatch) {
      description = helpMatch[2];
    }

    return {
      name,
      type,
      required,
      defaultValue,
      choices: choices && choices.length > 0 ? choices : undefined,
      description,
      cliName: longFlag ?? shortFlag,
      ...(nargs !== undefined && { nargs }),
      ...(action !== undefined && { action }),
    };
  }

  private mapPyType(raw: string): ScriptParameter['type'] {
    switch (raw) {
      case 'int': return 'int';
      case 'float': return 'float';
      case 'str': return 'string';
      default: return 'unknown';
    }
  }
}
