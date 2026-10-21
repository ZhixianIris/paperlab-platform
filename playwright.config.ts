import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
const databaseUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/support/make-fixtures.mjs',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 980 } },
    },
  ],
  webServer: [
    {
      command: 'node tests/support/start-e2e.mjs',
      url: 'http://127.0.0.1:8788/health',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: databaseUrl,
        APP_ENV: 'test',
        AI_PROVIDER: 'fixture',
        TEST_AUTH_SECRET: 'local-e2e-secret-not-for-production',
        E2E_PORT: '8788',
      },
    },
    {
      command: 'npm run preview:e2e -w web',
      url: baseURL,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
