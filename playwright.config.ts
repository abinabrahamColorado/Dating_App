import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsx scripts/web.ts start --port 3100 --hostname 127.0.0.1',
    env: {
      APP_MODE: 'test',
      APP_ORIGIN: 'http://localhost:3100',
      IDENTITY_DATABASE_URL: process.env.TEST_IDENTITY_DATABASE_URL ?? '',
      APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL ?? '',
      OPS_DATABASE_URL: process.env.TEST_OPS_DATABASE_URL ?? '',
      MEDIA_BUCKET: 'meetwell-private-test',
    },
    url: 'http://localhost:3100/api/v1/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
