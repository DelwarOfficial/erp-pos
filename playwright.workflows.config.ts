import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'ui-workflows.spec.ts', workers: 1, timeout: 120000,
  expect: { timeout: 20000 }, outputDir: '.local/workflow-browser-results', reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:43305', browserName: 'chromium', headless: true,
    trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
});
