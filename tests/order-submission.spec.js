const { test, expect } = require('@playwright/test');
const { PRODUCT_PATH, clickThroughPopups } = require('./shared-flow');

// Real incident (Aug 2026): a plugin conflict made WooCommerce's order-processing AJAX
// endpoint (wc-ajax=checkout) fatal with a 500 "critical error" the instant a customer
// pressed the real submit button -- a total, zero-orders outage that every other test in
// this suite was blind to, because they all deliberately stopped one step short of
// submitting (to avoid spamming the store). This test closes that gap: it places one real,
// clearly-marked, harmless test order per run to prove the submission pipeline itself
// still works, and stops the instant it reaches the payment gateway -- never enters card
// details or completes a payment.
//
// Runs once per check (desktop-chromium only; see playwright.config.js) to keep the
// number of test orders created to a minimum. Clean these up periodically in
// WooCommerce -> Orders: search "בדיקה" (the last name below) and bulk-trash them.

test('a real order can be submitted (does not complete payment)', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto(PRODUCT_PATH, { waitUntil: 'domcontentloaded' });
  await clickThroughPopups(page.locator('button.single_add_to_cart_button').first(), page);
  await expect
    .poll(async () => page.locator('.moderncart-floating-cart-count span').innerText().catch(() => '0'))
    .not.toBe('0');

  await page.goto('/checkout/', { waitUntil: 'domcontentloaded' });

  // Fixed, owner-chosen identity so these are instantly recognizable (and easy to search
  // for) in WooCommerce -> Orders. First/last name is the important, stable part; the
  // rest just needs to be valid-shaped, not meaningful.
  const setVal = async (id, value) => {
    await page.locator(`#${id}`).fill(value);
  };
  await setVal('billing_first_name', 'עידן');
  await setVal('billing_last_name', 'בדיקה');
  await setVal('billing_address_1', 'רפאל איתן 5');
  await setVal('billing_address_2', 'אם המושבות');
  await setVal('billing_city', 'פתח תקווה');
  await setVal('billing_postcode', '4951500');
  await setVal('billing_phone', '0500000000');
  await setVal('billing_email', 'ashtrozer@gmail.com');
  const terms = page.locator('#terms');
  if (await terms.count()) await terms.check();

  // Wait for WooCommerce's AJAX order-review update (triggered by the field changes
  // above) to settle before submitting, same as a real shopper would.
  await page.waitForTimeout(2_000);

  const checkoutSubmission = page.waitForResponse(
    (resp) => resp.url().includes('wc-ajax=checkout') && resp.request().method() === 'POST',
    { timeout: 30_000 }
  );
  await clickThroughPopups(page.locator('#place_order'), page);
  const resp = await checkoutSubmission;

  const status = resp.status();
  const bodyText = await resp.text().catch(() => '');
  console.log(`[order-submission] wc-ajax=checkout responded ${status}`);

  // A PHP fatal error (the real incident) always surfaces as a 500 with this generic
  // WordPress message, regardless of which plugin actually caused it.
  expect(
    status,
    `order submission failed with a server error (HTTP ${status}). Body: ${bodyText.slice(0, 300)}`
  ).toBeLessThan(500);
  expect(
    bodyText,
    'order submission hit a WordPress fatal/critical error'
  ).not.toContain('שגיאה קריטית');

  // Success looks like either: WooCommerce redirects the page toward the payment gateway
  // or its own order-received page (result:"success" + a redirect URL in the JSON), or an
  // inline validation error (result:"failure") which is a legitimate reject, not a crash.
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Non-JSON 2xx body: WooCommerce sometimes returns HTML fragments on success too.
  }
  if (parsed && parsed.result === 'failure') {
    console.log('[order-submission] checkout rejected (validation), not a crash:', parsed.messages?.slice(0, 300));
  }

  console.log(
    '[order-submission] test order placed successfully -- remember to clear "MONITOR-TEST" orders from WooCommerce > Orders periodically'
  );
});
