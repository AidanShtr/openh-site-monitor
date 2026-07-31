# openh-site-monitor

Automated synthetic monitoring for [openh.co.il](https://openh.co.il) — checks the site is actually
usable end-to-end, not just "responding to a ping."

**Cost: $0.** No Claude/OpenAI API calls, no paid service. It's a headless-browser test suite
(Playwright) run on a schedule by GitHub Actions' free tier.

## What it checks, every scheduled run

**The shopping flow** (`cold-incognito.spec.js` + `warm-cached.spec.js`), on three browser
profiles — desktop Chrome, Android Chrome (Pixel 7), and **real iPhone Safari (WebKit engine)**:

homepage → category page → product **search** → product page (price, photo loads,
add-to-cart button) → add to cart (badge increments) → cart (item + ₪ total + checkout link) →
checkout (billing form + **at least one payment method offered**).

The cold variant uses a fresh browser context with cache-busting (a true first-time visitor,
no CDN/browser cache); the warm variant allows normal caching and also verifies the repeat
homepage load is actually fast/served from cache.

**Infrastructure** (`critical-infrastructure.spec.js`, once per run):
- SSL certificate valid, with more than 14 days before expiry
- `http://` correctly redirects to `https://`
- Homepage loads in under 15s and is **indexable** (no accidental `noindex` — the classic
  "site quietly vanishes from Google" disaster)
- Sitemap reachable; robots.txt doesn't block the whole site

**Site health** (`site-health.spec.js`, once per run):
- Every header/nav menu link (all ~40, including submenus) returns a working page
- No mixed content (insecure `http://` resources on the page)
- Images on the homepage and a category page actually render (fails if more than a quarter
  are broken)

**Mobile layout** (`mobile-layout.spec.js`): header stays compact, floating cart button
reachable, no horizontal overflow — on both mobile profiles and desktop.

Pass/fail reflects "can customers actually buy": console errors that don't block checkout
(e.g. a stray 404'd background image) are logged in the report as annotations but don't turn
the dashboard red.

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
