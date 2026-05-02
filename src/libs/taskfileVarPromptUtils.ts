import * as vscode from 'vscode';

/**
 * Taskfile required variable definition used for interactive prompting.
 *
 * Note: The Taskfile schema may include additional fields such as `msg`.
 * Those are intentionally omitted here because they are not needed for
 * VS Code prompt collection.
 */
export interface TaskfileRequiredVar {
  name: string;
  enum?: string[];
}

export interface TaskfileVarPromptOptions {
  mode?: 'runTask' | 'runWithArgs';
  defaultsByName?: Record<string, string | undefined>;
}

function quoteTaskVarValue(value: string): string {
  // Shell-safe single-quote escaping: 'it'\''s'
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

/**
 * Prompt the user for required Taskfile variables and return assignment tokens
 * suitable for passing as task CLI args (e.g. `ENV='prod'`).
 *
 * Returns `undefined` when the user cancels any prompt.
 */
export async function promptAndResolveRequiredVars(
  vars: TaskfileRequiredVar[],
  taskName: string,
  options?: TaskfileVarPromptOptions,
): Promise<string[] | undefined> {
  const mode = options?.mode ?? 'runTask';
  const defaultsByName = options?.defaultsByName ?? {};
  const assignments: string[] = [];

  for (const requiredVar of vars) {
    const defaultValue = typeof defaultsByName[requiredVar.name] === 'string'
      ? defaultsByName[requiredVar.name]!.trim()
      : undefined;

    if (mode === 'runTask' && defaultValue && defaultValue.length > 0) {
      continue;
    }

    const title = `${taskName} - required variable "${requiredVar.name}"`;
    let value: string | undefined;

    if (Array.isArray(requiredVar.enum) && requiredVar.enum.length > 0) {
      const enumOptions = defaultValue && requiredVar.enum.includes(defaultValue)
        ? [defaultValue, ...requiredVar.enum.filter((v) => v !== defaultValue)]
        : requiredVar.enum;
      value = await vscode.window.showQuickPick(enumOptions, {
        title,
        placeHolder: defaultValue
          ? `Select value for ${requiredVar.name} (default: ${defaultValue})`
          : `Select value for ${requiredVar.name}`,
        ignoreFocusOut: true,
      });
    } else {
      value = await vscode.window.showInputBox({
        title,
        prompt: `Enter value for ${requiredVar.name}`,
        value: defaultValue,
        ignoreFocusOut: true,
        validateInput: (input) => input.trim().length === 0 ? 'Value cannot be empty' : undefined,
      });
    }

    if (value === undefined) {
      return undefined;
    }

    assignments.push(`${requiredVar.name}=${quoteTaskVarValue(value)}`);
  }

  return assignments;
}
