const { test, expect } = require('@playwright/test');

// Page-content health checks beyond the buy flow: every door into the store works
// (nav links), nothing is served insecurely, and images actually render. Runs only on
// the desktop-chromium project (see playwright.config.js) -- these are content-level
// checks that don't vary by device.

test('every navigation menu link returns a working page', async ({ page, request }) => {
  // The nav has ~40 links counting submenus; sequential fetches don't fit the default
  // test timeout, so give this test its own budget and check in parallel batches.
  test.setTimeout(180_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const links = await page
    .locator('header a[href], nav a[href]')
    .evaluateAll((as) =>
      [...new Set(
        as.map((a) => a.href).filter((h) => h.startsWith(location.origin) && !h.includes('#'))
      )]
    );
  expect(links.length, 'found same-origin links in the header/nav').toBeGreaterThan(3);

  const broken = [];
  const batchSize = 8;
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (url) => {
        const resp = await request.get(url, { timeout: 30_000 }).catch(() => null);
        return { url, status: resp ? resp.status() : null };
      })
    );
    for (const { url, status } of results) {
      if (!status || status >= 400) broken.push(`${url} -> ${status ?? 'no response'}`);
    }
  }
  console.log(`[health] checked ${links.length} nav links`);
  expect(broken, 'nav links that returned an error').toEqual([]);
});

test('homepage has no mixed content (insecure http:// resources)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const insecure = await page.evaluate(() =>
    [...document.querySelectorAll('img[src], script[src], iframe[src], link[rel="stylesheet"][href], source[src]')]
      .map((el) => el.src || el.href)
      .filter((u) => u && u.startsWith('http://'))
  );
  // Browsers block or warn on these, which can break the page or show "Not Secure" --
  // a direct trust-killer on a checkout site.
  expect(insecure, 'resources loaded over insecure http://').toEqual([]);
});

test('key pages render their images', async ({ page }, testInfo) => {
  // <img> tags that finished loading with zero natural size are broken. Checked on the
  // two highest-traffic pages. Reported as non-blocking unless a large share is broken --
  // one dead thumbnail shouldn't redden the "can people buy" dashboard, a wall of them should.
  const brokenByPage = {};
  for (const path of ['/', '/product-category/kitchentools/']) {
    await page.goto(path, { waitUntil: 'load' });
    const { broken, total } = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img[src]')].filter((i) => i.complete);
      return {
        total: imgs.length,
        broken: imgs.filter((i) => i.naturalWidth === 0).map((i) => i.src.slice(0, 120)),
      };
    });
    brokenByPage[path] = { broken, total };
    if (broken.length) {
      console.log(`[health] ${path}: ${broken.length}/${total} images broken:`, broken);
      testInfo.annotations.push({ type: 'broken-images', description: `${path}: ${broken.join(' | ')}` });
    }
    expect(
      broken.length,
      `${path}: more than a quarter of images broken (${broken.length}/${total})`
    ).toBeLessThanOrEqual(Math.max(1, Math.floor(total / 4)));
  }
});
