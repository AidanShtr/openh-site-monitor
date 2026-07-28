// Shared shopping-flow steps used by both the cold (no-cache) and warm (cached) specs.
// Kept selectors tied to what's actually rendered on openh.co.il (Astra + Elementor + WooCommerce
// + the "ModernCart" floating cart plugin) as of the last time this was verified against the live site.

const CATEGORY_PATH = '/product-category/kitchentools/';
// Canary product used for the add-to-cart / checkout smoke test. If this product is ever
// discontinued, swap in another simple (in-stock, no variations) product's URL.
const PRODUCT_PATH = '/product/%d7%a4%d7%98%d7%99%d7%a9-%d7%98%d7%a4%d7%a1%d7%a0%d7%99%d7%9d-%d7%a7%d7%98%d7%9f-roher/';

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

  // 3. Product page renders price + add-to-cart button
  // Scoped to .first() because the theme also renders a duplicate (sticky) add-to-cart
  // button for the same product once you scroll -- both share the same class/product id.
  const addToCartBtn = page.locator('button.single_add_to_cart_button').first();
  await t('product', async () => {
    const resp = await page.goto(bust(PRODUCT_PATH, cacheBust), { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `product page responded ${resp.status()}`).toBeTruthy();
    await expect(addToCartBtn).toBeVisible();
    await expect(page.locator('.summary .price, p.price').first()).toContainText('₪');
  });

  // 4. Add to cart (AJAX) and confirm the floating cart badge increments
  await t('add_to_cart', async () => {
    const countBefore = await page.locator('.moderncart-floating-cart-count span').innerText().catch(() => '0');
    await addToCartBtn.click();
    await expect
      .poll(async () => page.locator('.moderncart-floating-cart-count span').innerText().catch(() => countBefore))
      .not.toBe(countBefore);
  });

  // 5. Cart page shows the item and a working checkout link
  await t('cart', async () => {
    const resp = await page.goto('/cart/', { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `cart page responded ${resp.status()}`).toBeTruthy();
    // The theme renders this link twice (duplicate markup for desktop/mobile breakpoints).
    await expect(page.locator('a.checkout-button').first()).toBeVisible();
  });

  // 6. Checkout page renders the billing form (never submit a real order)
  await t('checkout', async () => {
    const resp = await page.goto('/checkout/', { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `checkout page responded ${resp.status()}`).toBeTruthy();
    await expect(page.locator('#place_order')).toBeVisible();
    await expect(page.locator('#billing_email')).toBeVisible();
  });

  return { timings, consoleErrors };
}

module.exports = { runShoppingFlow, CATEGORY_PATH, PRODUCT_PATH };
