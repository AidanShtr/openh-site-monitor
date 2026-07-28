const { test, expect } = require('@playwright/test');

// Sanity checks for the mobile revamp (compact single-row header, floating quick-add
// cart button, no horizontal overflow on product listings). Kept loose/structural on
// purpose -- Elementor markup changes often -- rather than pinned to exact class names.
test.describe('mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('homepage header is compact and cart icon is reachable', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp.ok()).toBeTruthy();

    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    // Sanity check, not a pixel-perfect spec: the header shouldn't dominate the
    // mobile screen (e.g. a broken/unwrapped nav pushing it to full-page height).
    expect(box && box.height, 'header height on mobile (viewport 812px tall)').toBeLessThan(400);

    await expect(page.locator('.moderncart-floating-cart-button')).toBeVisible();
  });

  test('category page has no horizontal overflow', async ({ page }) => {
    const resp = await page.goto('/product-category/kitchentools/');
    expect(resp.ok()).toBeTruthy();
    await expect(page.locator('ul.products li.product').first()).toBeVisible();

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    // Tolerance for minor rounding/scrollbar quirks; anything beyond that means content is
    // spilling off-screen on mobile instead of scrolling horizontally within its own card row.
    expect(overflow, 'horizontal page overflow (px)').toBeLessThanOrEqual(20);
  });
});
