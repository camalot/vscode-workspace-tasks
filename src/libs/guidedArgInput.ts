import * as vscode from 'vscode';
import { ScriptParameter } from './scriptArgumentResolver';
import { ScriptArgumentResolverRegistry } from './scriptArgumentResolverRegistry';
import { TaskItem } from '../taskItem';

const MAX_GUIDED_PARAMS = 10;

/**
 * Collects argument values for the given parameters using VS Code's quick-pick
 * and input-box APIs.  Returns an array of CLI argument tokens suitable for
 * joining and passing to a task runner, or `undefined` when the user cancels a
 * required parameter prompt.
 *
 * At most `MAX_GUIDED_PARAMS` (10) parameters are shown; if the script declares
 * more, the caller should fall back to free-text for the remainder.
 */
export async function collectGuidedArgs(
  params: ScriptParameter[],
  taskName: string,
): Promise<string[] | undefined> {
  const limited = params.slice(0, MAX_GUIDED_PARAMS);
  const argParts: string[] = [];

  for (const param of limited) {
    const tokens = await collectParamTokens(param, taskName);
    if (tokens === null) {
      return undefined; // required parameter was cancelled — abort
    }
    argParts.push(...tokens);
  }

  return argParts;
}

/**
 * Collects CLI tokens for a single parameter.
 * Returns `null` when the user cancels a required parameter (signals abort),
 * or an array of tokens (possibly empty) otherwise.
 */
async function collectParamTokens(param: ScriptParameter, taskName: string): Promise<string[] | null> {
  // Use cliName when available (Python: '--flag'), else PowerShell-style '-Name'
  const flag = param.cliName ?? `-${param.name}`;
  const title = `${taskName} \u2014 ${param.description || param.name}`;

  // switch (store_true / store_false) — Yes/No choice; flag is present or omitted
  if (param.type === 'switch') {
    const items = [
      { label: 'Yes', description: `Include ${flag}` },
      { label: 'No', description: `Omit ${flag}` },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Include ${flag}?`,
      title,
    });
    if (picked === undefined) {
      return param.required ? null : [];
    }
    return picked.label === 'Yes' ? [flag] : [];
  }

  // count action — prompt for an integer; the flag is repeated that many times
  if (param.action === 'count') {
    const val = await vscode.window.showInputBox({
      prompt: `${param.name}${param.description ? ` \u2014 ${param.description}` : ''} (enter count, leave empty to skip)`,
      placeHolder: '1',
      value: param.defaultValue,
    });
    if (val === undefined) {
      return param.required ? null : [];
    }
    if (val === '') {
      return [];
    }
    const n = parseInt(val, 10);
    if (isNaN(n) || n <= 0) {
      return [];
    }
    return Array.from({ length: n }, () => flag);
  }

  // choices — QuickPick
  if (param.choices && param.choices.length > 0) {
    const picked = await vscode.window.showQuickPick(param.choices, {
      placeHolder: `${param.name}${param.required ? ' (required)' : ''}`,
      title,
    });
    if (picked === undefined) {
      return param.required ? null : [];
    }
    return [flag, picked];
  }

  // multi-value (nargs='*', '+', N  or  action='append'/'extend')
  if (isMultiValueParam(param)) {
    return collectMultiValueTokens(param, flag);
  }

  // single value — InputBox (covers nargs='?' and plain parameters)
  const value = await vscode.window.showInputBox({
    prompt: `${param.name}${param.description ? ` \u2014 ${param.description}` : ''}`,
    placeHolder: param.defaultValue ?? `Enter ${param.type} value`,
    value: param.defaultValue,
  });
  if (value === undefined) {
    return param.required ? null : [];
  }
  if (value === '') {
    return [];
  }
  return [flag, value];
}

/** Returns true when a parameter requires multiple value prompts. */
function isMultiValueParam(param: ScriptParameter): boolean {
  if (param.action === 'append' || param.action === 'extend') {
    return true;
  }
  if (param.nargs === '*' || param.nargs === '+') {
    return true;
  }
  if (typeof param.nargs === 'number' && param.nargs > 1) {
    return true;
  }
  return false;
}

/**
 * Collects 0-or-more values for a multi-value parameter, prompting the user
 * in a loop until they escape, provide an empty string, or the exact count
 * is reached.
 *
 * - **Variable count** (`nargs='*'`, `'+'`, `action='append'`/`'extend'`):
 *   escape after providing ≥1 value → stop and use collected values.
 *   Escape on the very first prompt → abort if required, skip if not.
 * - **Exact count** (`nargs=N`):
 *   escape at any point → abort if required, skip (return `[]`) if not.
 *
 * `action='append'` assembles as `--flag v1 --flag v2 …`;
 * everything else assembles as `--flag v1 v2 …`.
 */
async function collectMultiValueTokens(param: ScriptParameter, flag: string): Promise<string[] | null> {
  const isExactCount = typeof param.nargs === 'number';
  const maxCount: number = isExactCount ? (param.nargs as number) : Infinity;
  // For action='append' without nargs: treat like '*' (0+ values, repeated flag)
  const isAppend = param.action === 'append' && !param.nargs;

  const values: string[] = [];

  while (values.length < maxCount) {
    const idx = values.length;
    const countHint = isExactCount
      ? ` (${idx + 1}/${maxCount})`
      : ` (value ${idx + 1}, leave empty or Escape to finish)`;

    const value = await vscode.window.showInputBox({
      prompt: `${param.name}${param.description ? ` \u2014 ${param.description}` : ''}${countHint}`,
      placeHolder: param.defaultValue ?? `Enter ${param.type} value`,
    });

    if (value === undefined) {
      // User pressed Escape
      if (isExactCount) {
        // For exact count, escape at any point discards the whole parameter
        return param.required ? null : [];
      }
      // For variable count, escape on first value means "cancel this param"
      if (values.length === 0 && param.required) {
        return null;
      }
      break; // stop collecting; use what we have
    }

    if (value === '' && !isExactCount) {
      // Empty string ends variable-length collection
      break;
    }

    if (value !== '') {
      values.push(value);
    }
  }

  if (values.length === 0) {
    return [];
  }

  if (isAppend) {
    // --flag v1 --flag v2 --flag v3
    const tokens: string[] = [];
    for (const v of values) {
      tokens.push(flag, v);
    }
    return tokens;
  }

  // --flag v1 v2 v3
  return [flag, ...values];
}

/**
 * Attempts to collect arguments for `item` via guided (parameter-driven) input.
 * Returns the collected argument tokens, or `undefined` when guided input is not
 * possible (no file URI, no resolvers matched, or the user cancelled a required
 * parameter prompt).
 */
export async function tryGuidedInput(item: TaskItem): Promise<string[] | undefined> {
  const fileUri = item.taskFileUri;
  if (!fileUri) {
    return undefined;
  }

  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    content = new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }

  const registry = ScriptArgumentResolverRegistry.getInstance();
  const result = await registry.resolveForFile(fileUri.fsPath, content);
  if (!result || result.parameters.length === 0) {
    return undefined;
  }

  return collectGuidedArgs(result.parameters, item.label as string);
}
