import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'inline-customer.spec.ts', workers: 1,
  timeout: 60000, expect: { timeout: 10000 }, reporter: 'list',
  outputDir: '.local/inline-customer-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    browserName: 'chromium', headless: true, serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 }, trace: 'off', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
});
