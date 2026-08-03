const { test, expect } = require('@playwright/test');
const { PRODUCT_PATH } = require('./shared-flow');

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

  test('checkout form is not covered by floating widgets', async ({ page }) => {
    // Regression test for a real lost order (Aug 2026): the Joinchat WhatsApp plugin
    // auto-opened its chat box over the mobile checkout form, making the billing fields
    // untappable. Checks that the elements a customer must touch are actually the ones
    // that receive their tap -- catches ANY overlay (chat widgets, cookie banners,
    // accessibility popups), not just Joinchat.
    test.setTimeout(90_000);

    await page.goto(PRODUCT_PATH, { waitUntil: 'domcontentloaded' });
    await page.locator('button.single_add_to_cart_button').first().click();
    await expect
      .poll(async () => page.locator('.moderncart-floating-cart-count span').innerText().catch(() => '0'))
      .not.toBe('0');
    // Dwell like a real shopper -- Joinchat only counts a page view once its script has
    // been up for a few seconds, and its auto-open fires message_delay seconds after the
    // message_views-th counted view.
    await page.waitForTimeout(6_000);
    await page.goto('/checkout/', { waitUntil: 'domcontentloaded' });

    // Deterministic half of the check: if the Joinchat widget is present on the checkout
    // page with auto-open configured (opens its chat box over the form mid-checkout,
    // message_views > 0 and message_delay > 0), that's a fail regardless of whether the
    // timing happens to fire during this run. Green again once auto-open is disabled or
    // the widget is excluded from cart/checkout.
    const joinchatSettings = await page
      .locator('.joinchat[data-settings]')
      .getAttribute('data-settings', { timeout: 5_000 })
      .then((s) => JSON.parse(s))
      .catch(() => null);
    if (joinchatSettings) {
      const autoOpens = (joinchatSettings.message_delay ?? 0) > 0 && (joinchatSettings.message_views ?? 0) > 0;
      expect(
        autoOpens,
        `Joinchat is set to auto-open its chat box on the checkout page (message_views=${joinchatSettings.message_views}, message_delay=${joinchatSettings.message_delay}s) -- it covers the billing form on mobile`
      ).toBe(false);
    }

    // Behavioral half: give any auto-opening widget ample time to fire, then verify taps land.
    await page.waitForTimeout(12_000);

    const mustBeTappable = ['#billing_first_name', '#billing_email', '#billing_phone', '#place_order'];
    const blocked = [];
    for (const selector of mustBeTappable) {
      const el = page.locator(selector);
      await el.scrollIntoViewIfNeeded();
      const result = await el.evaluate((target) => {
        const r = target.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ok = top === target || target.contains(top) || (top && top.contains(target));
        return ok ? null : (top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : 'off-viewport');
      });
      if (result) blocked.push(`${selector} covered by ${result}`);
    }
    expect(blocked, 'checkout elements a customer cannot tap').toEqual([]);
  });
});
