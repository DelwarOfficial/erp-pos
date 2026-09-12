import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'ui-health.spec.ts', workers: 1, timeout: 30000,
  outputDir: '.local/ui-health-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:43300', browserName: 'chromium', headless: true,
    trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' },
});
