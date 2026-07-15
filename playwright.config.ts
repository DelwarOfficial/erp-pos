// playwright.config.ts
// Playwright configuration — per §8 testing requirements.
// e2e tests in tests/e2e + axe-core accessibility scans.

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Asia/Dhaka',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { browserName: 'chromium' },
      testIgnore: /accessibility/,
    },
    // Mobile Safari project — only runs when webkit browser is installed
    // (skipped automatically in sandbox environments without sudo)
    ...(process.env.SKIP_WEBKIT ? [] : [{
      name: 'Mobile Safari',
      use: {
        browserName: 'webkit' as const,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testIgnore: /accessibility/,
    }]),
    {
      name: 'Accessibility (axe)',
      testMatch: /accessibility/,
      use: { browserName: 'chromium' },
    },
  ],

  webServer: {
    command: 'bun run dev',
    port: 3000,
    timeout: 30_000,
    reuseExistingServer: true,
  },
});
