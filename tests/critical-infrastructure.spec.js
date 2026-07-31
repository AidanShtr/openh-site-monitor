const { test, expect } = require('@playwright/test');
const tls = require('tls');

// Infrastructure-level checks that sit underneath the shopping flow: the certificate,
// redirects, and search-engine visibility. Any of these failing is site-wide, so this
// spec only runs on the desktop-chromium project (see playwright.config.js) -- running
// it per-device would just repeat the same network-level checks.

const HOST = new URL(process.env.SITE_URL || 'https://openh.co.il').hostname;

test('SSL certificate is valid and not about to expire', async () => {
  const cert = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 15000 }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      resolve(c);
    });
    // tls.connect rejects invalid/expired/mismatched certs by default, so reaching the
    // callback at all already proves the certificate is currently valid for this host.
    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('TLS connection timed out')));
  });

  const daysLeft = Math.floor((new Date(cert.valid_to) - Date.now()) / 86_400_000);
  console.log(`[ssl] certificate valid until ${cert.valid_to} (${daysLeft} days left)`);
  // Fail with two weeks' margin so an expiring cert becomes a red dashboard well before
  // browsers start showing customers a scary full-page security warning.
  expect(daysLeft, 'days until SSL certificate expires').toBeGreaterThan(14);
});

test('http:// redirects to https://', async ({ request }) => {
  const resp = await request.get(`http://${HOST}/`, { maxRedirects: 0 });
  expect([301, 302, 307, 308], `http:// responded ${resp.status()}`).toContain(resp.status());
  expect(resp.headers()['location']).toMatch(new RegExp(`^https://${HOST.replace(/\./g, '\\.')}`));
});

test('homepage loads fast enough and is indexable by Google', async ({ page }) => {
  const start = Date.now();
  const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
  const loadMs = Date.now() - start;
  expect(resp.ok(), `homepage responded ${resp.status()}`).toBeTruthy();

  console.log(`[infra] homepage domcontentloaded in ${loadMs} ms`);
  // Generous ceiling: this is "the site is unusably slow" territory, not a perf budget.
  // Normal runs land around 2-4s; sustained 15s+ means customers are giving up.
  expect(loadMs, 'homepage load time (ms)').toBeLessThan(15_000);

  // Guard against the classic silent disaster: someone toggles "Discourage search
  // engines" in WP Settings -> Reading (or an SEO plugin misfires) and the store
  // gradually vanishes from Google while looking perfectly fine to visitors.
  const metaRobots = await page.locator('meta[name="robots"]').first().getAttribute('content').catch(() => null);
  expect(metaRobots || '', 'meta robots must not contain noindex').not.toMatch(/noindex/i);
  expect(resp.headers()['x-robots-tag'] || '', 'X-Robots-Tag must not contain noindex').not.toMatch(/noindex/i);
});

test('sitemap is reachable for search engines', async ({ request }) => {
  const resp = await request.get('/sitemap_index.xml');
  expect(resp.status(), `sitemap_index.xml responded ${resp.status()}`).toBe(200);
  expect(await resp.text()).toContain('<sitemap');
});

test('robots.txt does not block the whole site', async ({ request }) => {
  const resp = await request.get('/robots.txt');
  // A missing robots.txt is treated by crawlers as "allow everything", so 404 is not a
  // failure here -- only an explicit site-wide Disallow is. (The 404 itself is a known
  // quirk on this host; see README.)
  if (resp.status() === 200) {
    const body = await resp.text();
    const blocksEverything = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/mi.test(body);
    expect(blocksEverything, 'robots.txt must not Disallow: / for all agents').toBe(false);
  } else {
    console.log(`[infra] robots.txt responded ${resp.status()} (treated by crawlers as allow-all; not a failure)`);
  }
});
