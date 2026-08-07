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
reachable, no horizontal overflow, and the checkout form isn't covered by a floating
widget/popup — on both mobile profiles and desktop.

**Real order submission** (`order-submission.spec.js`, once per run, desktop only): places
one actual test order (fixed identity: עידן בדיקה / ashtrozer@gmail.com — instantly
recognizable in WooCommerce → Orders) and confirms the submission itself succeeds — either
redirecting to the real payment gateway or getting a legitimate validation rejection. **Never
enters card details or completes a payment.** This exists because every other test
deliberately stops one step short of the real submit button (to avoid spamming the store),
which is exactly the gap that let a real checkout outage (Aug 2026, see below) go undetected
by the rest of the suite. Clear out the resulting test orders periodically — search "בדיקה"
in WooCommerce → Orders and bulk-trash them.

Pass/fail reflects "can customers actually buy": console errors that don't block checkout
(e.g. a stray 404'd background image) are logged in the report as annotations but don't turn
the dashboard red.

## One-time setup

1. Create a GitHub repo (public repos get unlimited free Actions minutes; private repos get
   2,000 free minutes/month, plenty for a daily job).
2. Push this folder to it.
3. In the repo: **Settings → Pages → Source → "GitHub Actions"**. This gives you a persistent
   dashboard URL showing the latest pass/fail report (screenshots + traces on failure), instead of
   digging through the Actions tab.
4. **Daily trigger (external, since GitHub's own `schedule:` proved unreliable — see below):**
   free [cron-job.org](https://cron-job.org) account that calls this workflow's
   `workflow_dispatch` API endpoint on a real timer.
   - GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → generate
     one scoped to **only this repository**, with **Actions: Read and write** permission (nothing
     else). Copy the token.
   - cron-job.org → Create cronjob:
     - URL: `https://api.github.com/repos/<owner>/<repo>/actions/workflows/monitor.yml/dispatches`
     - Method: `POST`
     - Headers: `Authorization: Bearer <your token>`, `Accept: application/vnd.github+json`,
       `Content-Type: application/json`
     - Body: `{"ref":"main"}`
     - Schedule: whatever time you want, in your own timezone (cron-job.org handles DST for you,
       unlike GitHub's UTC-only cron).
5. That's it — manual runs still work from the Actions tab / `gh workflow run monitor.yml`
   regardless of the external scheduler.

## Running it locally

```bash
npm install
npx playwright install --with-deps chromium
npx playwright test
```

Open `playwright-report/index.html` afterwards for the same HTML report CI produces.

## Tuning

- **Frequency**: runs daily at ~8:30 AM Israel time (`.github/workflows/monitor.yml`), plus
  on-demand via the Actions tab ("Run workflow") or `gh workflow run monitor.yml`. GitHub's
  scheduler deprioritizes crons landing exactly on `:00`/`:30` under load, hence `:33` instead
  of `:30` — confirmed directly (a `*/30` schedule was observed firing as rarely as once every
  ~6-11 hours before this fix). Note the cron is UTC-fixed, so it'll drift an hour relative to
  Israel local time across the DST switch each spring/fall — see the comment in the workflow.
- **Canary product**: `tests/shared-flow.js` hardcodes one simple, in-stock product to run the
  add-to-cart/checkout flow against. If that product is ever removed or discontinued, swap in
  another one's URL.
- **Alerting**: emails `openh2021@gmail.com` on any failure, via a Gmail App Password stored as
  the `MAIL_USERNAME`/`MAIL_PASSWORD` repo secrets. Requires those secrets to be set for the
  email step to actually fire.

## Known findings from building/using this

- **Aug 2026, real checkout outage**: WooCommerce auto-updated to v11, and the installed
  payment gateway plugin (Yaad Sarig / YaadPay) only ships compatibility classes through v10 —
  its `tb_wc_object::factory()` returns `null` for anything checkout-related on v11, causing a
  hard PHP fatal (`Call to a member function get_total() on null`) on every single order
  attempt. 100% of orders failed until this was resolved. This is a plugin-side bug affecting
  every site running that plugin on WooCommerce 11+ (2,000+ active installs), not something
  specific to this store. This is exactly why `order-submission.spec.js` exists — nothing else
  in the suite submitted a real order, so this outage went undetected by automation the whole
  time it was live.
- Two separate popup/overlay incidents (also Aug 2026, see `mobile-layout.spec.js` and
  `shared-flow.js` comments): the Joinchat WhatsApp widget auto-opening over the mobile
  checkout form, and a separate Elementor promo popup covering the product page's add-to-cart
  button at an unpredictable delay. Both are now guarded against (`clickThroughPopups`).
- A 404'd homepage background image
  (`wp-content/uploads/2026/05/ChatGPT-Image-May-27-2026-10_16_11-PM.png`) is a known, low
  -impact leftover — logged in the report as a non-blocking annotation, doesn't fail the suite.
