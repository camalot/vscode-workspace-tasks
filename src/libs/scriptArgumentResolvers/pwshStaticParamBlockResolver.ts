import * as path from 'path';
import { ScriptArgumentResolver, ArgumentResolveResult, ScriptParameter } from '../scriptArgumentResolver';

/**
 * Resolves PowerShell script parameters by statically parsing the `param()` block
 * in the script source.
 *
 * This resolver does not spawn any external processes and works in untrusted
 * workspaces.  It is the fallback when `PwshGetHelpResolver` is unavailable or
 * fails.
 *
 * Supported patterns:
 * - `param(...)` block at file scope
 * - `[Parameter(Mandatory=$true|$false)]` / `[Parameter(Mandatory)]`
 * - `[ValidateSet('a','b','c')]`
 * - Type declarations: `[string]`, `[int]`, `[bool]`, `[switch]`, `[double]`
 * - `$Name` variable declarations
 * - `= 'default'` string literal defaults
 *
 * Known limitations (documented, out of scope for v1):
 * - Parameter sets (`ParameterSetName`)
 * - Pipeline input (`ValueFromPipeline`)
 * - Complex default expressions (`= (Get-Date)`)
 * - Nested `param()` blocks inside functions
 * - Dynamic parameter blocks (`DynamicParam`)
 */
export class PwshStaticParamBlockResolver implements ScriptArgumentResolver {
  public readonly name = 'PwshStaticParamBlockResolver';

  public canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.ps1';
  }

  public async resolve(_filePath: string, content: string): Promise<ArgumentResolveResult> {
    const block = this.extractParamBlock(content);
    if (block === undefined) {
      return { supported: false, parameters: [] };
    }

    const parameters = this.parseParamBlock(block);
    return { supported: true, parameters };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Extracts the content inside the top-level `param(...)` block, stripping
   * single-line comments before processing so they don't confuse the parser.
   */
  private extractParamBlock(content: string): string | undefined {
    // Strip single-line comments to avoid false positives.
    const stripped = content.replace(/#[^\r\n]*/g, '');

    const paramIndex = stripped.search(/\bparam\s*\(/i);
    if (paramIndex === -1) {
      return undefined;
    }

    let depth = 0;
    let start = -1;
    for (let i = paramIndex; i < stripped.length; i++) {
      if (stripped[i] === '(') {
        if (depth === 0) { start = i + 1; }
        depth++;
      } else if (stripped[i] === ')') {
        depth--;
        if (depth === 0) {
          return stripped.slice(start, i);
        }
      }
    }
    return undefined;
  }

  /**
   * Parses individual parameter declarations from the extracted `param()` content.
   * Splits on top-level commas to separate each parameter.
   */
  private parseParamBlock(block: string): ScriptParameter[] {
    const declarations = this.splitTopLevelCommas(block);
    const parameters: ScriptParameter[] = [];

    for (const decl of declarations) {
      const param = this.parseDeclaration(decl.trim());
      if (param) {
        parameters.push(param);
      }
    }

    return parameters;
  }

  /** Splits `block` on commas that are not inside brackets or parentheses. */
  private splitTopLevelCommas(block: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of block) {
      if (ch === '(' || ch === '[') {
        depth++;
        current += ch;
      } else if (ch === ')' || ch === ']') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      parts.push(current);
    }
    return parts;
  }

  /**
   * Parses a single parameter declaration (everything between two top-level
   * commas in the `param()` block).
   */
  private parseDeclaration(decl: string): ScriptParameter | undefined {
    // Must contain a variable name $Name
    const varMatch = decl.match(/\$([A-Za-z_]\w*)\s*(?:=.*)?$/);
    if (!varMatch) {
      return undefined;
    }
    const name = varMatch[1];

    // Mandatory attribute
    const mandatoryTrue = /\[Parameter\s*\([^)]*Mandatory\s*=\s*\$true[^)]*\)\]/i.test(decl)
      || /\[Parameter\s*\(\s*Mandatory\s*\)\]/i.test(decl);
    const mandatoryFalse = /\[Parameter\s*\([^)]*Mandatory\s*=\s*\$false[^)]*\)\]/i.test(decl);
    const required = mandatoryTrue && !mandatoryFalse;

    // Type declaration
    const typeMatch = decl.match(/\[(\w+)\]\s*\$[A-Za-z_]/);
    const type = typeMatch ? this.mapPwshType(typeMatch[1]) : 'unknown';

    // ValidateSet choices
    let choices: string[] | undefined;
    const validateSetMatch = decl.match(/\[ValidateSet\s*\(([^)]+)\)\]/i);
    if (validateSetMatch) {
      choices = validateSetMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }

    // Default value (string literals only)
    let defaultValue: string | undefined;
    const defaultMatch = decl.match(/\$[A-Za-z_]\w*\s*=\s*['"]([^'"]*)['"]/);
    if (defaultMatch) {
      defaultValue = defaultMatch[1];
    }

    return { name, type, required, choices, defaultValue };
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
