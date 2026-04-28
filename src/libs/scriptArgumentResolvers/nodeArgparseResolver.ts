import * as path from 'path';
import { ScriptArgumentResolver, ArgumentResolveResult, ScriptParameter } from '../scriptArgumentResolver';

/**
 * Resolves Node.js script parameters by statically parsing `argparse`
 * `add_argument(...)` calls.
 *
 * Supports the common Node port patterns:
 * - `const { ArgumentParser } = require('argparse')`
 * - `import { ArgumentParser } from 'argparse'`
 * - `parser.add_argument('-n', '--name', { ... })`
 * - `parser.add_argument(['-n', '--name'], { ... })`
 */
export class NodeArgparseResolver implements ScriptArgumentResolver {
  public readonly name = 'NodeArgparseResolver';

  public canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.js' || ext === '.mjs' || ext === '.cjs';
  }

  public async resolve(_filePath: string, content: string): Promise<ArgumentResolveResult> {
    if (!this.hasArgparse(content)) {
      return { supported: false, parameters: [] };
    }

    const parameters = this.parseAddArgumentCalls(content);
    return { supported: true, parameters };
  }

  private hasArgparse(content: string): boolean {
    return /\brequire\(\s*['"]argparse['"]\s*\)/.test(content)
      || /\bfrom\s+['"]argparse['"]/.test(content);
  }

  private parseAddArgumentCalls(content: string): ScriptParameter[] {
    const parameters: ScriptParameter[] = [];
    const callPattern = /\.add_argument\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = callPattern.exec(content)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const argsStr = this.extractBalanced(content, openPos, '(', ')');
      if (argsStr === undefined) {
        continue;
      }

      const parsed = this.parseAddArgumentCallArgs(argsStr);
      if (parsed) {
        parameters.push(parsed);
      }
    }

    return parameters;
  }

  private parseAddArgumentCallArgs(argsStr: string): ScriptParameter | undefined {
    const parts = this.splitTopLevel(argsStr, ',');
    if (parts.length === 0) {
      return undefined;
    }

    const maybeOptions = parts[parts.length - 1].trim();
    const optionsObj = maybeOptions.startsWith('{') && maybeOptions.endsWith('}')
      ? maybeOptions
      : undefined;

    const flagParts = optionsObj ? parts.slice(0, -1) : parts;
    const flags = this.extractFlags(flagParts);
    if (flags.length === 0) {
      return undefined;
    }

    const longFlag = flags.find((f) => f.startsWith('--'));
    const shortFlag = flags.find((f) => f.startsWith('-') && !f.startsWith('--'));
    const cliName = longFlag ?? shortFlag;
    if (!cliName) {
      return undefined;
    }

    const action = optionsObj ? this.parseAction(optionsObj) : undefined;
    if (action === 'help' || action === 'version') {
      return undefined;
    }

    const dest = optionsObj ? this.matchStringValue(optionsObj, 'dest') : undefined;
    const name = dest ?? cliName.replace(/^--?/, '').replace(/-/g, '_');

    const required = optionsObj
      ? this.matchBooleanValue(optionsObj, 'required') ?? false
      : false;

    const mappedType = optionsObj ? this.parseType(optionsObj) : undefined;
    const type: ScriptParameter['type'] = (action === 'store_true' || action === 'store_false')
      ? 'switch'
      : (mappedType ?? 'string');

    const defaultValue = optionsObj ? this.parseDefaultValue(optionsObj) : undefined;
    const choices = optionsObj ? this.parseChoices(optionsObj) : undefined;
    const nargs = optionsObj ? this.parseNargs(optionsObj) : undefined;
    const description = optionsObj ? this.matchStringValue(optionsObj, 'help') : undefined;

    return {
      name,
      type,
      required,
      defaultValue,
      choices: choices && choices.length > 0 ? choices : undefined,
      description,
      cliName,
      ...(nargs !== undefined && { nargs }),
      ...(action !== undefined && { action }),
    };
  }

  private extractFlags(parts: string[]): string[] {
    const flags: string[] = [];
    const stringFlagPattern = /(['"])(-{1,2}[\w-]+)\1/g;

    for (const partRaw of parts) {
      const part = partRaw.trim();
      if (!part) {
        continue;
      }

      if (part.startsWith('[') && part.endsWith(']')) {
        let m: RegExpExecArray | null;
        while ((m = stringFlagPattern.exec(part)) !== null) {
          flags.push(m[2]);
        }
        continue;
      }

      const direct = part.match(/^(['"])(-{1,2}[\w-]+)\1$/);
      if (direct) {
        flags.push(direct[2]);
      }
    }

    return flags;
  }

  private parseType(optionsObj: string): ScriptParameter['type'] | undefined {
    const typeStr = this.matchStringValue(optionsObj, 'type');
    if (typeStr) {
      const normalized = typeStr.toLowerCase();
      if (normalized === 'string' || normalized === 'str') {
        return 'string';
      }
      if (normalized === 'int' || normalized === 'integer') {
        return 'int';
      }
      if (normalized === 'float' || normalized === 'double' || normalized === 'number') {
        return 'float';
      }
      if (normalized === 'bool' || normalized === 'boolean') {
        return 'bool';
      }
      return 'unknown';
    }

    const typeCtor = optionsObj.match(/\btype\s*:\s*(String|Number|Boolean)\b/);
    if (!typeCtor) {
      return undefined;
    }
    switch (typeCtor[1]) {
      case 'String': return 'string';
      case 'Number': return 'float';
      case 'Boolean': return 'bool';
      default: return 'unknown';
    }
  }

  private parseAction(optionsObj: string): string | undefined {
    const raw = this.matchStringValue(optionsObj, 'action');
    if (!raw) {
      return undefined;
    }

    const normalized = raw
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/-/g, '_')
      .toLowerCase();

    switch (normalized) {
      case 'store_true':
      case 'store_false':
      case 'append':
      case 'append_const':
      case 'extend':
      case 'count':
      case 'help':
      case 'version':
        return normalized;
      default:
        return normalized;
    }
  }

  private parseDefaultValue(optionsObj: string): string | undefined {
    const str = this.matchStringValue(optionsObj, 'default');
    if (str !== undefined) {
      return str;
    }

    const bool = this.matchBooleanValue(optionsObj, 'default');
    if (bool !== undefined) {
      return bool ? 'true' : 'false';
    }

    const num = optionsObj.match(/\bdefault\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (num) {
      return num[1];
    }

    return undefined;
  }

  private parseChoices(optionsObj: string): string[] | undefined {
    const m = optionsObj.match(/\bchoices\s*:\s*\[([^\]]*)\]/);
    if (!m) {
      return undefined;
    }

    const items = this.splitTopLevel(m[1], ',')
      .map((v) => v.trim())
      .map((v) => {
        const str = v.match(/^['"]([\s\S]*)['"]$/);
        if (str) {
          return str[1];
        }
        if (/^(true|false)$/i.test(v)) {
          return v.toLowerCase();
        }
        if (/^-?\d+(?:\.\d+)?$/.test(v)) {
          return v;
        }
        return '';
      })
      .filter(Boolean);

    return items.length > 0 ? items : undefined;
  }

  private parseNargs(optionsObj: string): string | number | undefined {
    const str = this.matchStringValue(optionsObj, 'nargs');
    if (str && (str === '?' || str === '*' || str === '+')) {
      return str;
    }

    const num = optionsObj.match(/\bnargs\s*:\s*(\d+)/);
    if (num) {
      return parseInt(num[1], 10);
    }

    return undefined;
  }

  private matchStringValue(content: string, key: string): string | undefined {
    const re = new RegExp(`\\b${key}\\s*:\\s*(['\\"])([\\s\\S]*?)\\1`);
    const m = content.match(re);
    return m ? m[2] : undefined;
  }

  private matchBooleanValue(content: string, key: string): boolean | undefined {
    const re = new RegExp(`\\b${key}\\s*:\\s*(true|false)\\b`, 'i');
    const m = content.match(re);
    if (!m) {
      return undefined;
    }
    return m[1].toLowerCase() === 'true';
  }

  private extractBalanced(content: string, openPos: number, open: string, close: string): string | undefined {
    if (content[openPos] !== open) {
      return undefined;
    }

    let depth = 0;
    const start = openPos + 1;
    let quote: string | undefined;

    for (let i = openPos; i < content.length; i++) {
      const ch = content[i];
      const prev = i > 0 ? content[i - 1] : '';

      if (quote) {
        if (ch === quote && prev !== '\\') {
          quote = undefined;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        quote = ch;
        continue;
      }

      if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          return content.slice(start, i);
        }
      }
    }

    return undefined;
  }

  private splitTopLevel(content: string, separator: string): string[] {
    const parts: string[] = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote: string | undefined;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      const prev = i > 0 ? content[i - 1] : '';

      if (quote) {
        current += ch;
        if (ch === quote && prev !== '\\') {
          quote = undefined;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        quote = ch;
        current += ch;
        continue;
      }

      if (ch === '(') {
        parenDepth++;
        current += ch;
        continue;
      }
      if (ch === ')') {
        parenDepth--;
        current += ch;
        continue;
      }
      if (ch === '{') {
        braceDepth++;
        current += ch;
        continue;
      }
      if (ch === '}') {
        braceDepth--;
        current += ch;
        continue;
      }
      if (ch === '[') {
        bracketDepth++;
        current += ch;
        continue;
      }
      if (ch === ']') {
        bracketDepth--;
        current += ch;
        continue;
      }

      if (
        ch === separator
        && parenDepth === 0
        && braceDepth === 0
        && bracketDepth === 0
      ) {
        parts.push(current);
        current = '';
        continue;
      }

      current += ch;
    }

    if (current.trim().length > 0) {
      parts.push(current);
    }

    return parts;
  }
}
