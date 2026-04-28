import * as path from 'path';
import { ScriptArgumentResolver, ArgumentResolveResult, ScriptParameter } from '../scriptArgumentResolver';

/**
 * Resolves Node.js script parameters by statically parsing `parseArgs()`
 * configuration objects from either:
 * - `node:util` / `util`
 * - `@pkgjs/parseargs` polyfill
 */
export class NodeParseArgsResolver implements ScriptArgumentResolver {
  public readonly name = 'NodeParseArgsResolver';

  public canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.js' || ext === '.mjs' || ext === '.cjs';
  }

  public async resolve(_filePath: string, content: string): Promise<ArgumentResolveResult> {
    if (!this.hasParseArgsImport(content)) {
      return { supported: false, parameters: [] };
    }

    const objects = this.collectNamedObjectLiterals(content);
    const parseArgsCalls = this.extractParseArgsCalls(content);

    const parameters: ScriptParameter[] = [];
    for (const callArg of parseArgsCalls) {
      const configObj = this.resolveObjectExpression(callArg, objects);
      if (!configObj) {
        continue;
      }

      const optionsExpr = this.extractOptionsExpression(configObj);
      if (!optionsExpr) {
        continue;
      }

      const optionsObj = this.resolveObjectExpression(optionsExpr, objects);
      if (!optionsObj) {
        continue;
      }

      parameters.push(...this.parseOptionsObject(optionsObj));
    }

    return { supported: true, parameters };
  }

  private hasParseArgsImport(content: string): boolean {
    const importsParseArgs = /\bparseArgs\b/.test(content);
    const hasSupportedSource = /(?:\bfrom\s+['"](?:node:util|util|@pkgjs\/parseargs)['"])|(?:\brequire\(\s*['"](?:node:util|util|@pkgjs\/parseargs)['"]\s*\))/.test(content);
    return importsParseArgs && hasSupportedSource;
  }

  private collectNamedObjectLiterals(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const openPos = match.index + match[0].length - 1;
      const body = this.extractBalanced(content, openPos, '{', '}');
      if (body === undefined) {
        continue;
      }
      map.set(name, `{${body}}`);
    }

    return map;
  }

  private extractParseArgsCalls(content: string): string[] {
    const calls: string[] = [];
    const pattern = /\bparseArgs\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const argsBody = this.extractBalanced(content, openPos, '(', ')');
      if (argsBody === undefined) {
        continue;
      }

      const args = this.splitTopLevel(argsBody, ',').map((p) => p.trim()).filter(Boolean);
      if (args.length > 0) {
        calls.push(args[0]);
      }
    }

    return calls;
  }

  private extractOptionsExpression(configObj: string): string | undefined {
    const inner = this.trimOuterBraces(configObj);
    if (!inner) {
      return undefined;
    }

    const props = this.splitTopLevel(inner, ',').map((p) => p.trim()).filter(Boolean);
    for (const prop of props) {
      if (prop === 'options') {
        return 'options';
      }

      const m = prop.match(/^options\s*:\s*([\s\S]+)$/);
      if (m) {
        return m[1].trim();
      }
    }

    return undefined;
  }

  private parseOptionsObject(optionsObj: string): ScriptParameter[] {
    const inner = this.trimOuterBraces(optionsObj);
    if (!inner) {
      return [];
    }

    const entries = this.splitTopLevel(inner, ',').map((e) => e.trim()).filter(Boolean);
    const parameters: ScriptParameter[] = [];

    for (const entry of entries) {
      const pair = entry.match(/^((?:['"][^'"]+['"])|(?:[A-Za-z_$][\w$-]*))\s*:\s*([\s\S]+)$/);
      if (!pair) {
        continue;
      }

      const rawName = pair[1];
      const optionName = rawName.replace(/^['"]|['"]$/g, '');
      const defObj = this.resolveObjectExpression(pair[2].trim(), new Map());
      if (!defObj) {
        continue;
      }

      const typeName = this.matchStringValue(defObj, 'type')?.toLowerCase();
      const multiple = this.matchBooleanValue(defObj, 'multiple') ?? false;
      const defaultValue = this.parseDefaultValue(defObj);

      let type: ScriptParameter['type'] = 'string';
      if (typeName === 'boolean') {
        type = 'switch';
      } else if (typeName === 'string') {
        type = 'string';
      } else {
        type = 'unknown';
      }

      const param: ScriptParameter = {
        name: optionName.replace(/-/g, '_'),
        type,
        required: false,
        cliName: `--${optionName}`,
      };

      if (defaultValue !== undefined) {
        param.defaultValue = defaultValue;
      }

      if (multiple && type !== 'switch') {
        param.action = 'append';
        param.nargs = '*';
      }

      parameters.push(param);
    }

    return parameters;
  }

  private resolveObjectExpression(expr: string, namedObjects: Map<string, string>): string | undefined {
    const trimmed = expr.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const identifier = trimmed.match(/^[A-Za-z_$][\w$]*$/);
    if (identifier) {
      return namedObjects.get(trimmed);
    }

    return undefined;
  }

  private trimOuterBraces(obj: string): string | undefined {
    const trimmed = obj.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return undefined;
    }
    return trimmed.slice(1, -1);
  }

  private parseDefaultValue(defObj: string): string | undefined {
    const str = this.matchStringValue(defObj, 'default');
    if (str !== undefined) {
      return str;
    }

    const bool = this.matchBooleanValue(defObj, 'default');
    if (bool !== undefined) {
      return bool ? 'true' : 'false';
    }

    const num = defObj.match(/\bdefault\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (num) {
      return num[1];
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
