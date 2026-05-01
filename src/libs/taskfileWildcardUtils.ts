import * as vscode from 'vscode';

/**
 * Prompts the user to supply a value for each `*` wildcard in the given
 * Taskfile task name pattern.  Returns the resolved task name (e.g. `start:foo:3`)
 * or `undefined` when the user cancels any prompt.
 *
 * Each `*` is replaced left-to-right with the user-supplied value using
 * index-based substitution (safe even when a user-supplied value contains `*`).
 *
 * @param templateName   The task name template containing one or more `*` characters.
 * @param wildcardCount  The number of `*` characters in `templateName`.
 */
export async function promptAndResolveWildcards(
  templateName: string,
  wildcardCount: number,
): Promise<string | undefined> {
  const parts = templateName.split('*'); // [before1, before2, ..., afterLast]
  const values: string[] = [];

  for (let i = 0; i < wildcardCount; i++) {
    const position = i + 1;
    const value = await vscode.window.showInputBox({
      title: `Wildcard argument ${position} of ${wildcardCount}`,
      prompt: `Enter value for wildcard ${position} in task "${templateName}"`,
      placeHolder: `value${position}`,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() === '' ? 'Value cannot be empty' : undefined),
    });
    if (value === undefined) {
      return undefined; // user cancelled
    }
    values.push(value);
  }

  // Interleave parts and values: parts[0] + values[0] + parts[1] + values[1] + ...
  return parts.reduce((acc, part, i) => acc + part + (i < values.length ? values[i] : ''), '');
}
