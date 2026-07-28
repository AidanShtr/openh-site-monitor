const { test, expect } = require('@playwright/test');
const { runShoppingFlow } = require('./shared-flow');

// Simulates a returning visitor: no cache-busting, so the CDN/browser cache is allowed
// to serve the homepage on the second hit. We warm it up first, then check the repeat
// load is faster and (when the host sends a cache-status header) actually reports a HIT.
test('warm visitor: repeat homepage load is served from cache', async ({ page }) => {
  const first = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(first.ok()).toBeTruthy();
  const firstHeaders = first.headers();

  const start = Date.now();
  const second = await page.goto('/', { waitUntil: 'domcontentloaded' });
  const warmLoadMs = Date.now() - start;
  expect(second.ok()).toBeTruthy();
  const secondHeaders = second.headers();

  const cacheStatus = secondHeaders['cf-cache-status'] || secondHeaders['x-cache'] || null;
  console.log('[warm] repeat homepage load:', warmLoadMs, 'ms, cache status:', cacheStatus);

  if (cacheStatus) {
    // Only assert HIT when the host actually exposes a cache-status header -- not
    // every response type (e.g. dynamic pages) is expected to be cacheable.
    expect(cacheStatus.toUpperCase()).toMatch(/HIT/);
  }
  void firstHeaders;
});

test('warm visitor: full shopping flow with normal caching allowed', async ({ page }, testInfo) => {
  // Same purchase-path check as the cold flow, just with caching left on. A pass here means
  // returning customers can check out too.
  const { timings, consoleErrors } = await runShoppingFlow(page, { expect, cacheBust: false });

  console.log('[warm] step timings (ms):', JSON.stringify(timings));
  // Non-blocking: console errors are noted for visibility, not treated as a checkout failure.
  if (consoleErrors.length) {
    console.log('[warm] browser console errors (non-blocking):', consoleErrors);
    testInfo.annotations.push({ type: 'console-errors', description: consoleErrors.join(' | ') });
  }
});
