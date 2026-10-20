import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @meetwell/web start --port 3100 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3100/api/v1/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
