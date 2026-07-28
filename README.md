# openh-site-monitor

Automated synthetic monitoring for [openh.co.il](https://openh.co.il) — checks the site is actually
usable end-to-end, not just "responding to a ping."

**Cost: $0.** No Claude/OpenAI API calls, no paid service. It's a headless-browser test suite
(Playwright) run on a schedule by GitHub Actions' free tier.

## What it checks, every 30 minutes

1. **`cold-incognito.spec.js`** — simulates a brand-new customer: fresh browser context (no
   cookies/history) + cache-busting headers/query params on every request, so it hits the real
   origin the way a first-time visitor would. Walks: homepage → category page → product page →
   add to cart → cart → checkout.
2. **`warm-cached.spec.js`** — simulates a returning visitor with normal caching allowed (no
   cache-busting). Loads the homepage twice and checks the repeat load is fast / reports a cache
   HIT when the host sends a cache-status header, then runs the same shopping flow.
3. **`mobile-layout.spec.js`** — checks the mobile viewport: header doesn't balloon to full-page
   height, floating cart button is reachable, category grid doesn't overflow horizontally.

Every run also fails on any JS console error encountered along the way (e.g. a broken image, a
failed script). Each spec runs against both desktop and mobile emulated Chromium.

## One-time setup

1. Create a GitHub repo (public repos get unlimited free Actions minutes; private repos get
   2,000 free minutes/month, plenty for a 30-min-interval job).
2. Push this folder to it.
3. In the repo: **Settings → Pages → Source → "GitHub Actions"**. This gives you a persistent
   dashboard URL showing the latest pass/fail report (screenshots + traces on failure), instead of
   digging through the Actions tab.
4. That's it — the workflow in `.github/workflows/monitor.yml` runs on its own from then on.

## Running it locally

```bash
npm install
npx playwright install --with-deps chromium
npx playwright test
```

Open `playwright-report/index.html` afterwards for the same HTML report CI produces.

## Tuning

- **Frequency**: edit the cron in `.github/workflows/monitor.yml` (`*/30 * * * *`). Don't go much
  tighter than every 15 min without checking your Actions minutes budget.
- **Canary product**: `tests/shared-flow.js` hardcodes one simple, in-stock product to run the
  add-to-cart/checkout flow against. If that product is ever removed or discontinued, swap in
  another one's URL.
- **Alerting**: currently log/dashboard only (per your preference) — no email/Slack push. If you
  want alerts later, the cheapest add is a step in the workflow that pings a Slack/Discord webhook
  or sends an email only `if: failure()`.

## Known finding from initial verification

While building this, the cold-visitor flow caught a real 404 on the homepage:
`https://openh.co.il/wp-content/uploads/2026/05/ChatGPT-Image-May-27-2026-10_16_11-PM.png` — a
missing image, likely from an Elementor section. Worth fixing; until then this test will
legitimately fail on every run (that's the monitor doing its job, not a bug in the suite).
