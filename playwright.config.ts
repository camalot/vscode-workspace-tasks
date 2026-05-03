import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 600000,
  use: {
    baseURL: 'http://localhost:4000/vscode-workspace-tasks',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // command: 'bundle exec jekyll serve --baseurl "/vscode-workspace-tasks"',
    command: 'bundle exec jekyll serve --destination ../_site --config _config.yml,_config-local.yml --skip-initial-build',
    // command: 'npm run docs:serve',
    url: 'http://localhost:4000/vscode-workspace-tasks/',
    cwd: './docs',
    reuseExistingServer: !process.env.CI,
    timeout: 300000,
  },
});
