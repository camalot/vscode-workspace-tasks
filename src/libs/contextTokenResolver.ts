import * as path from 'path';
import * as vscode from 'vscode';

export interface ContextTokenResolutionContext {
  workspaceFolder: string;
  workspaceFolderBasename: string;
  activeFile: string;
  processEnv: Record<string, string | undefined>;
}

/**
 * Builds token context values from live VS Code state.
 */
export function buildContextFromVscode(resourceUri: vscode.Uri): ContextTokenResolutionContext {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri)?.uri.fsPath ?? '';
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';

  return {
    workspaceFolder,
    workspaceFolderBasename: workspaceFolder ? path.basename(workspaceFolder) : '',
    activeFile,
    processEnv: process.env as Record<string, string | undefined>,
  };
}

/**
 * Resolves known ${...} context tokens in a command string.
 * Unknown tokens are preserved as-is.
 */
export function resolveContextTokens(value: string, ctx: ContextTokenResolutionContext): string {
  const replacements: Record<string, string> = {
    '${workspaceFolder}': ctx.workspaceFolder,
    '${workspaceFolderBasename}': ctx.workspaceFolderBasename,
    '${file}': ctx.activeFile,
    '${fileBasename}': ctx.activeFile ? path.basename(ctx.activeFile) : '',
    '${fileDirname}': ctx.activeFile ? path.dirname(ctx.activeFile) : '',
    '${fileExtname}': ctx.activeFile ? path.extname(ctx.activeFile) : '',
    '${fileBasenameNoExtension}': ctx.activeFile
      ? path.basename(ctx.activeFile, path.extname(ctx.activeFile))
      : '',
    '${pathSeparator}': path.sep,
  };

  let resolved = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    resolved = resolved.replaceAll(token, () => replacement);
  }

  return resolved.replace(/\$\{env\.([^}]+)\}/g, (_match, envName: string) => {
    return ctx.processEnv[envName] ?? '';
  });
}
