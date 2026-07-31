// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  // Cap concurrency: this suite runs against the live store, and too many simultaneous
  // browser sessions can slow it down enough to cause false failures (seen locally at 5
  // workers: JS chunk loads started dropping).
  workers: 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'results.json' }], ['list']]
    : [['html', { open: 'on-failure' }], ['list']],
  use: {
    baseURL: process.env.SITE_URL || 'https://openh.co.il',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Site-wide checks (SSL, redirects, nav links, mixed content) run once here; the
    // device projects below skip them and re-run only the customer-facing flows.
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testIgnore: ['**/critical-infrastructure.spec.js', '**/site-health.spec.js'],
    },
    // Real Safari engine (WebKit), not Chrome pretending to be a phone -- iPhone users
    // are a large share of shoppers and Safari has its own cookie/cache/render behavior.
    {
      name: 'iphone-safari',
      use: { ...devices['iPhone 14'] },
      testIgnore: ['**/critical-infrastructure.spec.js', '**/site-health.spec.js'],
    },
  ],
});
