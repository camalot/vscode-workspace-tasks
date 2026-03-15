import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: '.',
  version: '1.105.1',
  launchArgs: ['--disable-updates', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(__dirname, '.vscode-test', 'user-data')}`],
  mocha: {
    reporter: 'mocha-junit-reporter',
    reporterOptions: {
      mochaFile: join(__dirname, 'coverage', 'junit.xml'),
      toConsole: true
    }
  }
});
