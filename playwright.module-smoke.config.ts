import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'module-smoke.spec.ts', workers: 1, timeout: 30000,
  outputDir: '.local/module-smoke-results', reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:43300', browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' },
});
