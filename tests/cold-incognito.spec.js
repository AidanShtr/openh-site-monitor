const { test, expect } = require('@playwright/test');
const { runShoppingFlow } = require('./shared-flow');

// Every test in @playwright/test already gets a brand-new, isolated browser context
// (no cookies/localStorage carried over) -- i.e. true incognito by default.

test.beforeEach(async ({ page }) => {
  // Force cache bypass on requests back to openh.co.il only -- sending these headers to
  // third-party origins too (fonts.gstatic.com, Klaviyo, etc.) trips their CORS preflight
  // and produces fake-looking errors that have nothing to do with the site itself.
  await page.route('https://openh.co.il/**', (route) => {
    route.continue({
      headers: { ...route.request().headers(), 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
  });
});

test('cold visitor: full shopping flow with no caching', async ({ page }, testInfo) => {
  // This test's job is "can a new customer actually buy something" -- home -> category ->
  // product -> add to cart -> cart -> checkout. Every step above already asserts what it
  // needs to (page loads, button visible, cart count changes, etc.), so a passing run here
  // means the purchase path works, full stop.
  const { timings, consoleErrors } = await runShoppingFlow(page, { expect, cacheBust: true });

  console.log('[cold] step timings (ms):', JSON.stringify(timings));
  // Console errors (e.g. a stray 404'd background image) are noted for visibility but don't
  // fail this test -- they don't stop anyone from checking out. Fix them on your own time.
  if (consoleErrors.length) {
    console.log('[cold] browser console errors (non-blocking):', consoleErrors);
    testInfo.annotations.push({ type: 'console-errors', description: consoleErrors.join(' | ') });
  }
});
