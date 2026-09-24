import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'presentation.spec.ts', workers: 1,
  timeout: 120_000, expect: { timeout: 15_000 },
  outputDir: '.local/presentation-results', reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    browserName: 'chromium', headless: true, serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
