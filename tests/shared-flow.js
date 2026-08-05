// Shared shopping-flow steps used by both the cold (no-cache) and warm (cached) specs.
// Kept selectors tied to what's actually rendered on openh.co.il (Astra + Elementor + WooCommerce
// + the "ModernCart" floating cart plugin) as of the last time this was verified against the live site.

const CATEGORY_PATH = '/product-category/kitchentools/';
// Canary product used for the add-to-cart / checkout smoke test. If this product is ever
// discontinued, swap in another simple (in-stock, no variations) product's URL.
const PRODUCT_PATH = '/product/%d7%a4%d7%98%d7%99%d7%a9-%d7%98%d7%a4%d7%a1%d7%a0%d7%99%d7%9d-%d7%a7%d7%98%d7%9f-roher/';

// Search term the store should always have results for (matches the canary product's
// name, "hammer", plus several others).
const SEARCH_TERM = 'פטיש';

function bust(path, cacheBust) {
  if (!cacheBust) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}_cb=${Date.now()}`;
}

/**
 * Runs the full "new customer buys a product" journey and returns timing + assertions
 * for each step. `cacheBust` appends a fresh query string + no-cache headers to every
 * navigation so CDN/browser caches are bypassed (simulates a true first-time visitor).
 */
async function runShoppingFlow(page, { expect, cacheBust }) {
  const timings = {};
  const t = async (label, fn) => {
    const start = Date.now();
    await fn();
    timings[label] = Date.now() - start;
  };

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // 1. Homepage
  await t('homepage', async () => {
    const resp = await page.goto(bust('/', cacheBust), { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `homepage responded ${resp.status()}`).toBeTruthy();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  // 2. Category / shop listing renders products
  await t('category', async () => {
    const resp = await page.goto(bust(CATEGORY_PATH, cacheBust), { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `category page responded ${resp.status()}`).toBeTruthy();
    await expect(page.locator('ul.products li.product').first()).toBeVisible();
  });

  // 3. Product search returns results
  await t('search', async () => {
    const resp = await page.goto(bust(`/?s=${encodeURIComponent(SEARCH_TERM)}&post_type=product`, cacheBust), {
      waitUntil: 'domcontentloaded',
    });
    expect(resp.ok(), `search responded ${resp.status()}`).toBeTruthy();
    await expect(
      page.locator('a[href*="/product/"]').first(),
      `search for "${SEARCH_TERM}" returned at least one product`
    ).toBeAttached();
  });

  // 4. Product page renders price, product image, and add-to-cart button
  // Scoped to .first() because the theme also renders a duplicate (sticky) add-to-cart
  // button for the same product once you scroll -- both share the same class/product id.
  const addToCartBtn = page.locator('button.single_add_to_cart_button').first();
  await t('product', async () => {
    const resp = await page.goto(bust(PRODUCT_PATH, cacheBust), { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `product page responded ${resp.status()}`).toBeTruthy();
    await expect(addToCartBtn).toBeVisible();
    await expect(page.locator('.summary .price, p.price').first()).toContainText('₪');
    // The main product image must actually load -- a product page with a broken photo
    // is as good as broken for a shopper deciding whether to buy.
    const mainImage = page.locator('.woocommerce-product-gallery img').first();
    await expect(mainImage).toBeVisible();
    await expect
      .poll(() => mainImage.evaluate((img) => img.complete && img.naturalWidth > 0), {
        message: 'main product image loaded (non-zero natural size)',
      })
      .toBe(true);
  });

  // 5. Add to cart (AJAX) and confirm the floating cart badge increments
  await t('add_to_cart', async () => {
    // Real incident (Aug 2026): an Elementor popup ad (WhatsApp/phone customer service
    // promo) can cover the product page and intercept the add-to-cart click entirely --
    // Playwright then retries the click silently for up to the test timeout, surfacing as
    // an opaque 90s hang instead of a clear failure. Detect and close it first; if it can't
    // be closed, fail immediately with a message that says exactly what's blocking the button.
    const blockingPopup = page.locator('.elementor-popup-modal:visible').first();
    if (await blockingPopup.count()) {
      const popupText = await blockingPopup.innerText().catch(() => '(unknown content)');
      const closeBtn = blockingPopup.locator('.dialog-close-button, [aria-label="Close"]').first();
      await closeBtn.click({ timeout: 3_000 }).catch(() => {});
      await expect(
        blockingPopup,
        `a popup is covering the product page and blocking the add-to-cart button: "${popupText.slice(0, 150)}"`
      ).toBeHidden({ timeout: 5_000 });
    }

    const countBefore = await page.locator('.moderncart-floating-cart-count span').innerText().catch(() => '0');
    await addToCartBtn.click({ timeout: 15_000 });
    await expect
      .poll(async () => page.locator('.moderncart-floating-cart-count span').innerText().catch(() => countBefore))
      .not.toBe(countBefore);
  });

  // 6. Cart page shows the item, a real total in shekels, and a working checkout link
  await t('cart', async () => {
    const resp = await page.goto('/cart/', { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `cart page responded ${resp.status()}`).toBeTruthy();
    await expect(page.locator('.cart_totals, .woocommerce-cart-form').first()).toContainText('₪');
    // The theme renders this link twice (duplicate markup for desktop/mobile breakpoints).
    await expect(page.locator('a.checkout-button').first()).toBeVisible();
  });

  // 7. Checkout page renders the billing form and at least one payment method
  // (never submit a real order)
  await t('checkout', async () => {
    const resp = await page.goto('/checkout/', { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `checkout page responded ${resp.status()}`).toBeTruthy();
    await expect(page.locator('#place_order')).toBeVisible();
    await expect(page.locator('#billing_email')).toBeVisible();
    // If the payment gateway plugin breaks or is misconfigured, WooCommerce renders the
    // form but with no way to pay -- catch that explicitly. The radio inputs can be
    // visually hidden when only one gateway exists, so assert presence, not visibility.
    expect(
      await page.locator('input[name="payment_method"], #payment .wc_payment_method').count(),
      'at least one payment method is offered at checkout'
    ).toBeGreaterThan(0);
  });

  return { timings, consoleErrors };
}

module.exports = { runShoppingFlow, CATEGORY_PATH, PRODUCT_PATH, SEARCH_TERM };
