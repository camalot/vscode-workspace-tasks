import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: '.',
  version: '1.105.1',
  launchArgs: ['--disable-updates', '--no-sandbox', '--disable-gpu']
});
