/**
 * Bootstraps the `ScriptArgumentResolverRegistry` with the built-in resolvers.
 *
 * Call `registerBuiltInResolvers()` once during extension activation.
 *
 * To add a new resolver for an existing or new shell type, import its class and
 * call `ScriptArgumentResolverRegistry.getInstance().register(ext, resolver)`.
 */
import { ScriptArgumentResolverRegistry } from '../scriptArgumentResolverRegistry';
import { PwshGetHelpResolver } from './pwshGetHelpResolver';
import { PwshStaticParamBlockResolver } from './pwshStaticParamBlockResolver';
import { PythonArgparseResolver } from './pythonArgparseResolver';
import { NodeArgparseResolver } from './nodeArgparseResolver';
import { NodeParseArgsResolver } from './nodeParseArgsResolver';

export function registerBuiltInResolvers(): void {
  const registry = ScriptArgumentResolverRegistry.getInstance();

  // PowerShell: try Get-Help first (richer metadata), fall back to static parse.
  registry.register('.ps1', new PwshGetHelpResolver());
  registry.register('.ps1', new PwshStaticParamBlockResolver());

  // Python: argparse-based discovery.
  registry.register('.py', new PythonArgparseResolver());

  // Node.js: parseArgs (node:util or @pkgjs/parseargs) and argparse port.
  registry.register('.js', new NodeParseArgsResolver());
  registry.register('.js', new NodeArgparseResolver());
  registry.register('.mjs', new NodeParseArgsResolver());
  registry.register('.mjs', new NodeArgparseResolver());
  registry.register('.cjs', new NodeParseArgsResolver());
  registry.register('.cjs', new NodeArgparseResolver());
}

export { ScriptArgumentResolverRegistry } from '../scriptArgumentResolverRegistry';
export { PwshGetHelpResolver } from './pwshGetHelpResolver';
export { PwshStaticParamBlockResolver } from './pwshStaticParamBlockResolver';
export { PythonArgparseResolver } from './pythonArgparseResolver';
export { NodeArgparseResolver } from './nodeArgparseResolver';
export { NodeParseArgsResolver } from './nodeParseArgsResolver';
