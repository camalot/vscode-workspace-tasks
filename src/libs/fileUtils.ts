import * as vscode from 'vscode';
import { TaskIgnoreService } from '../services/taskIgnoreService';

/**
 * Finds files in the workspace matching a glob pattern AND any open files matching a language ID.
 * Returns a deduplicated list of URIs.
 *
 * @param globPattern The glob pattern to search for (e.g. '&#42;&#42;/Makefile')
 * @param excludePattern The glob pattern to exclude (e.g. '&#42;&#42;/node_modules/&#42;&#42;')
 * @param languageId The VS Code language identifier to match open files against (e.g. 'makefile')
 * @returns Promise<vscode.Uri[]>
 */
export async function findFilesByGlobAndLanguage(
    globPattern: string,
    excludePattern: string | undefined,
    languageId: string
): Promise<vscode.Uri[]> {
    const targetLanguageId = languageId.toLowerCase();

    // 1. Find standard files based on glob
    const foundFiles = await vscode.workspace.findFiles(globPattern, excludePattern);

    // 2. Find open files with specific language mode
    const openFiles = vscode.workspace.textDocuments
        .filter(doc => doc.languageId.toLowerCase() === targetLanguageId && doc.uri.scheme === 'file')
        .map(doc => doc.uri);

    // 3. Deduplicate
    const distinctFiles = new Map<string, vscode.Uri>();
    foundFiles.forEach(f => distinctFiles.set(f.toString(), f));
    openFiles.forEach(f => distinctFiles.set(f.toString(), f));

    // 4. Apply Ignore Rules
    const ignoreService = TaskIgnoreService.getInstance();
    const result: vscode.Uri[] = [];
    for (const uri of distinctFiles.values()) {
        if (!ignoreService.shouldIgnore(uri)) {
            result.push(uri);
        }
    }

    return result;
}
