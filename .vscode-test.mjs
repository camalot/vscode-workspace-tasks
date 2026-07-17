import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: process.env.TEST_FILE || 'out/test/**/*.test.js',
  workspaceFolder: '.',
  version: '1.105.1',
  launchArgs: ['--disable-updates', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(tmpdir(), 'vscode-workspace-tasks-test', 'user-data')}`],
  mocha: {
    timeout: 60000,
    reporter: 'mocha-multi-reporters',
    reporterOptions: {
      reporterEnabled: 'spec, mocha-junit-reporter',
      mochaJunitReporterReporterOptions: {
        mochaFile: join(__dirname, 'coverage', 'junit.xml'),
      }
    }
  }
});
