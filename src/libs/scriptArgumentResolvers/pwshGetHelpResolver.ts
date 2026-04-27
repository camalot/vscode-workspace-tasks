import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { ScriptArgumentResolver, ArgumentResolveResult, ScriptParameter } from '../scriptArgumentResolver';
import { LoggerService } from '../../services/loggerService';

const PWSH_TIMEOUT_MS = 5000;

/**
 * Resolves PowerShell script parameters by running:
 *
 *   pwsh -NoProfile -NonInteractive -Command "Get-Help '<path>' -Detailed"
 *
 * and parsing the SYNTAX and PARAMETERS sections of the output.
 *
 * This approach introspects the script's `param()` block and comment-based help
 * (`.SYNOPSIS`, `.PARAMETER`) **without executing any script logic**.
 *
 * Falls through (returns `supported: false`) when:
 * - The workspace is not trusted.
 * - `pwsh` is not available on the system PATH.
 * - The subprocess times out or exits non-zero.
 * - The output cannot be parsed into at least one parameter.
 */
export class PwshGetHelpResolver implements ScriptArgumentResolver {
  public readonly name = 'PwshGetHelpResolver';
  private readonly logger = LoggerService.getInstance();

  public canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.ps1';
  }

  public async resolve(filePath: string, _content: string): Promise<ArgumentResolveResult> {
    if (!vscode.workspace.isTrusted) {
      return { supported: false, parameters: [] };
    }

    const pwshPath = await this.findPwsh();
    if (!pwshPath) {
      this.logger.debug('[PwshGetHelpResolver] pwsh not found on PATH');
      return { supported: false, parameters: [] };
    }

    let output: string;
    try {
      output = await this.runGetHelp(pwshPath, filePath);
    } catch (err) {
      this.logger.warn(`[PwshGetHelpResolver] Get-Help failed: ${err}`);
      return { supported: false, parameters: [] };
    }

    const parameters = this.parseGetHelpOutput(output);
    if (parameters.length === 0) {
      return { supported: false, parameters: [] };
    }
    return { supported: true, parameters };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private findPwsh(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const child = cp.spawn(which, ['pwsh'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.on('close', (code) => {
        if (code === 0 && out.trim().length > 0) {
          resolve(out.trim().split('\n')[0].trim());
        } else {
          resolve(undefined);
        }
      });
      child.on('error', () => resolve(undefined));
    });
  }

  private runGetHelp(pwshPath: string, scriptPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build the command as an argument array — never concatenate user-derived strings.
      const args = [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Help '${scriptPath.replace(/'/g, "''")}' -Detailed`,
      ];

      const child = cp.spawn(pwshPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Get-Help timed out'));
      }, PWSH_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`pwsh exited with code ${code}: ${stderr.trim()}`));
        } else {
          resolve(stdout);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Parses the text output of `Get-Help <script> -Detailed`.
   *
   * Strategy:
   * 1. Extract the SYNTAX line and parse each parameter token.
   * 2. Overlay per-parameter metadata from the PARAMETERS section (required,
   *    description, accepted values).
   */
  private parseGetHelpOutput(output: string): ScriptParameter[] {
    const syntaxParams = this.parseSyntaxLine(output);
    if (syntaxParams.length === 0) {
      return [];
    }
    this.overlayParametersSection(output, syntaxParams);
    return syntaxParams;
  }

  /**
   * Extracts parameters from the SYNTAX section.
   *
   * Example:
   *   script.ps1 [-Environment] <string> [[-Configuration] <string>] [-DryRun] [<CommonParameters>]
   *
   * Token patterns:
   *   `-Name <type>`              → mandatory positional, typed
   *   `[-Name] <type>`            → mandatory named, typed
   *   `[[-Name] <type>]`          → optional named, typed
   *   `[-Name]` (no <type>)       → switch
   *   `[<CommonParameters>]`      → skip
   */
  private parseSyntaxLine(output: string): ScriptParameter[] {
    // The SYNTAX section starts after the "SYNTAX" header.
    const syntaxMatch = output.match(/SYNTAX\s*\r?\n([\s\S]*?)(?:\r?\n[A-Z]|\s*$)/);
    if (!syntaxMatch) {
      return [];
    }
    const syntaxBlock = syntaxMatch[1];

    // Find the first line that looks like a script invocation (contains `[-` or `<`).
    const lines = syntaxBlock.split(/\r?\n/);
    let syntaxLine = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        syntaxLine += ' ' + trimmed;
      }
    }
    syntaxLine = syntaxLine.trim();

    // Remove the script name from the front.
    syntaxLine = syntaxLine.replace(/^\S+\s*/, '');

    const parameters: ScriptParameter[] = [];
    // Tokenise the syntax line character by character to handle nested brackets.
    const tokens = this.tokeniseSyntaxLine(syntaxLine);

    for (const token of tokens) {
      const param = this.parseSyntaxToken(token);
      if (param) {
        parameters.push(param);
      }
    }

    return parameters;
  }

  /**
   * Splits the syntax remainder into top-level bracket groups and bare tokens.
   * E.g. `[-Env] <string> [[-Cfg] <string>] [-DryRun] [<CommonParameters>]`
   * → [`[-Env] <string>`, `[[-Cfg] <string>]`, `[-DryRun]`, `[<CommonParameters>]`]
   */
  private tokeniseSyntaxLine(line: string): string[] {
    const tokens: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of line) {
      if (ch === '[') {
        if (depth === 0 && current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        depth++;
        current += ch;
      } else if (ch === ']') {
        depth--;
        current += ch;
        if (depth === 0) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      tokens.push(current.trim());
    }
    return tokens;
  }

  /**
   * Parses a single syntax token into a `ScriptParameter`.
   * Returns `undefined` for tokens that should be skipped (e.g. `[<CommonParameters>]`).
   */
  private parseSyntaxToken(token: string): ScriptParameter | undefined {
    // Skip CommonParameters placeholder
    if (/^\[<CommonParameters>\]$/i.test(token)) {
      return undefined;
    }

    // Optional outer brackets: `[...]` means the whole parameter group is optional.
    const outerOptional = token.startsWith('[') && token.endsWith(']');
    const inner = outerOptional ? token.slice(1, -1) : token;

    // Check for an inner -Name flag component.
    // Patterns inside the (possibly unwrapped) token:
    //   `[-Name] <type>`   or   `[-Name]`   or   `-Name <type>`   or   `-Name`
    const namedWithType = inner.match(/^\[?-(\w+)\]?\s+<(\w+)>$/);
    const namedOnly = inner.match(/^\[?-(\w+)\]?$/);
    const bareWithType = inner.match(/^-(\w+)\s+<(\w+)>$/);

    if (namedWithType) {
      const [, name, type] = namedWithType;
      return {
        name,
        type: this.mapPwshType(type),
        required: !outerOptional,
      };
    }

    if (bareWithType) {
      const [, name, type] = bareWithType;
      return {
        name,
        type: this.mapPwshType(type),
        required: true,
      };
    }

    if (namedOnly) {
      const [, name] = namedOnly;
      // No <type> → switch parameter
      return {
        name,
        type: 'switch',
        required: false,
      };
    }

    return undefined;
  }

  /**
   * Overlays richer per-parameter metadata from the PARAMETERS section of the
   * `-Detailed` output:  required status, description, and accepted values.
   */
  private overlayParametersSection(output: string, parameters: ScriptParameter[]): void {
    const paramsMatch = output.match(/PARAMETERS\s*\r?\n([\s\S]*?)(?:\r?\n[A-Z][A-Z]|\s*$)/);
    if (!paramsMatch) {
      return;
    }

    const block = paramsMatch[1];

    for (const param of parameters) {
      // Find the block for this parameter name (case-insensitive).
      const re = new RegExp(
        `-${param.name}\\s+[\\s\\S]*?(?=\\s+-[A-Za-z]|$)`,
        'i',
      );
      const m = block.match(re);
      if (!m) {
        continue;
      }
      const section = m[0];

      // Required
      const reqMatch = section.match(/Required\?\s+(true|false)/i);
      if (reqMatch) {
        param.required = reqMatch[1].toLowerCase() === 'true';
      }

      // Accepted values (ValidateSet)
      const avMatch = section.match(/Accept pipeline input\?\s+[\s\S]*?Accepted values\s*:\s*([^\r\n]+)/i);
      if (avMatch) {
        param.choices = avMatch[1].split(',').map((v) => v.trim()).filter(Boolean);
      }

      // Description: lines before the first "Required?" line
      const descMatch = section.match(/^\s*-\w+\s+<\w+>\s*\r?\n([\s\S]*?)(?:Required\?|$)/i);
      if (descMatch) {
        const desc = descMatch[1].replace(/\s+/g, ' ').trim();
        if (desc) {
          param.description = desc;
        }
      }
    }
  }

  private mapPwshType(raw: string): ScriptParameter['type'] {
    switch (raw.toLowerCase()) {
      case 'string': return 'string';
      case 'int':
      case 'int32':
      case 'int64': return 'int';
      case 'double':
      case 'float':
      case 'decimal': return 'float';
      case 'bool':
      case 'boolean': return 'bool';
      case 'switch':
      case 'switchparameter': return 'switch';
      default: return 'unknown';
    }
  }
}
