const { test, expect } = require('@playwright/test');
const { runShoppingFlow } = require('./shared-flow');

// Every test in @playwright/test already gets a brand-new, isolated browser context
// (no cookies/localStorage carried over) -- i.e. true incognito by default. On top of
// that we bypass caches on every navigation so this hits the origin like a genuinely
// new customer with an empty browser, not a CDN/browser cache.
test.use({
  extraHTTPHeaders: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
});

test('cold visitor: full shopping flow with no caching', async ({ page }) => {
  const { timings, consoleErrors } = await runShoppingFlow(page, { expect, cacheBust: true });

  console.log('[cold] step timings (ms):', JSON.stringify(timings));
  if (consoleErrors.length) {
    console.log('[cold] browser console errors:', consoleErrors);
  }
  expect(consoleErrors, 'no JS console errors during the cold flow').toHaveLength(0);
});
