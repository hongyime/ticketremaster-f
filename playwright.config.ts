import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests', timeout: 30_000, expect: { timeout: 5000 },
  fullyParallel: true, forbidOnly: !!process.env.CI, retries: 0, workers: 2,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:43187', timezoneId: 'Asia/Singapore', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: `"${process.execPath}" scripts/e2e-server.mjs`, url: 'http://127.0.0.1:43187', reuseExistingServer: false, timeout: 120_000 },
})
