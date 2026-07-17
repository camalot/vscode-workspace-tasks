import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const __vscode_version = '1.125.0';

export default defineConfig({
  files: process.env.TEST_FILE || 'out/test/**/*.test.js',
  workspaceFolder: '.',
  // instead of hardcoding this, it should be read from package.json or env
  version: process.env.VSCODE_VERSION || (() => {
    const pkg = JSON.parse(Deno.readTextFileSync(join(__dirname, 'package.json')));
    return pkg.engines.vscode;
  })() || (() => {
    console.error('Could not determine VS Code version. Please set the VSCODE_VERSION environment variable.');
    return __vscode_version;
  })(),
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
