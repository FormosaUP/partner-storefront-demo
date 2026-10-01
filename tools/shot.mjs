// Screenshots the storefront on its registered origin.
// With --local, the Pages URL is served from ./out so unpublished builds can be checked on the real origin.
// Usage: node tools/shot.mjs [--local] [--out temp/shots] [scenario ...]
import { chromium, devices } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const PAGE = 'https://formosaup.github.io/partner-storefront-demo/';
const args = process.argv.slice(2);
const local = args.includes('--local');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'temp/shots';
const wanted = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.txt': 'text/plain', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function open(browser, kind) {
  const context = await browser.newContext(
    kind === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  );
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`  [console ${kind}]`, m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log(`  [pageerror ${kind}]`, String(e).slice(0, 300)));
  page.on('response', (r) => r.status() >= 400 && console.log(`  [http ${r.status()}]`, r.url().slice(0, 140)));
  if (local) {
    await page.route(PAGE + '**', (route) => {
      const url = new URL(route.request().url());
      let rel = decodeURIComponent(url.pathname.replace('/partner-storefront-demo/', ''));
      let file = join('out', rel);
      if (!rel || (existsSync(file) && statSync(file).isDirectory())) file = join('out', rel, 'index.html');
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
  }
  return page;
}

const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = (page, name, opts = {}) => page.screenshot({ path: `${outDir}/${name}.png`, ...opts });

const scenarios = {
  async home(page, kind) {
    await page.goto(PAGE);
    await shot(page, `${kind}-0-skeleton`);
    await page.waitForSelector('.card:not(.card--skeleton)', { timeout: 30000 });
    await settle(page, 2500);
    await shot(page, `${kind}-1-home`);
    await page.evaluate(() => window.scrollTo(0, 620));
    await settle(page, 1800);
    await shot(page, `${kind}-2-menu`);
  },
  async flow(page, kind) {
    await page.goto(PAGE);
    await page.waitForSelector('.card:not(.card--skeleton)', { timeout: 30000 });
    await settle(page, 1500);
    // Quick-add two plain dishes.
    const adds = page.locator('.card__add[aria-label^="Add "]');
    await adds.nth(0).scrollIntoViewIfNeeded();
    await adds.nth(0).click();
    await settle(page, 300);
    await shot(page, `${kind}-3-fly`);
    await adds.nth(1).click();
    await settle(page, 900);
    // Open a dish with options.
    const withOptions = page.locator('.card__add[aria-label^="Choose options"]').first();
    await withOptions.scrollIntoViewIfNeeded();
    await withOptions.click();
    await page.waitForSelector('.option', { timeout: 20000 });
    await settle(page, 1200);
    await shot(page, `${kind}-4-dish`);
    await page.locator('.dish__foot .btn--primary').click();
    await settle(page, 700);
    await shot(page, `${kind}-5-dish-required`);
    for (const group of await page.locator('fieldset.options').all()) {
      if ((await group.locator('.options__rule').innerText()).includes('Required')) await group.locator('.option').first().click();
    }
    await settle(page, 600);
    await shot(page, `${kind}-6-dish-chosen`);
    await page.locator('.dish__foot .btn--primary').click();
    await settle(page, 1800);
    if (kind === 'phone') {
      await shot(page, `${kind}-7-cartbar`);
      await page.locator('.cart-bar').click();
      await settle(page, 1500);
    }
    await shot(page, `${kind}-8-cart`);
    await page.locator('.cart__foot .btn--primary').click();
    await settle(page, 700);
    await page.locator('.cart__foot .btn--primary').click();
    await settle(page, 500);
    await shot(page, `${kind}-9-checkout-errors`);
  },
};

const API = 'https://api-dev.ulite.com/online-order/partner/api/v1';
const CORS = { 'access-control-allow-origin': 'https://formosaup.github.io', 'access-control-expose-headers': 'Retry-After' };
const json = (route, status, body, headers = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...headers }, body: JSON.stringify(body) });
// Rewrites a real response, so mocked states still use the store's own data.
const patch = (page, path, change) =>
  page.route(API + path, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    change(body.data);
    await route.fulfill({ response: res, json: body });
  });
const loaded = async (page) => {
  await page.goto(PAGE);
  await page.waitForSelector('.card:not(.card--skeleton), .state-page', { timeout: 30000 });
  await settle(page, 1800);
};
const addOne = async (page) => {
  const add = page.locator('.card__add[aria-label^="Add "]').first();
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await settle(page, 1500);
};
const openCart = async (page, kind) => {
  if (kind === 'phone') await page.locator('.cart-bar').click();
  await settle(page, 900);
};

// Mocked states: nothing here reaches the ordering endpoints for real.
Object.assign(scenarios, {
  async closed(page, kind) {
    await patch(page, '/Store/Settings', (d) => (d.asapAvailable = false));
    await loaded(page);
    await shot(page, `${kind}-closed`);
  },
  async soldout(page, kind) {
    await patch(page, '/Menu/*', (d) => {
      const products = d.categories[0].products;
      products[0].availabilityStatus = 'UNAVAILABLE';
      if (products[1]) products[1].imageUrl = null;
      if (products[2]) products[2].imageUrl = 'https://img-dev.ulite.com/missing.jpg';
    });
    await loaded(page);
    await page.locator('.section').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 260));
    await settle(page, 1500);
    await shot(page, `${kind}-soldout-nophoto`);
  },
  async unpublished(page, kind) {
    await page.route(API + '/**', (route) => json(route, 403, { isSuccess: false, data: null, message: null, error: { code: 'STORE_UNPUBLISHED', message: 'x' } }));
    await loaded(page);
    await shot(page, `${kind}-unpublished`);
  },
  async offline(page, kind) {
    await page.route(API + '/**', (route) => route.abort());
    await loaded(page);
    await shot(page, `${kind}-network`);
  },
  async ratelimit(page, kind) {
    await loaded(page);
    await page.route(API + '/Order/Preview', (route) => json(route, 429, {}, { 'Retry-After': '25' }));
    await addOne(page);
    await openCart(page, kind);
    await shot(page, `${kind}-ratelimited`);
  },
  async uncertain(page, kind) {
    await loaded(page);
    await page.route(API + '/Order', (route) => route.abort());
    await addOne(page);
    await openCart(page, kind);
    await page.locator('.cart__foot .btn--primary').click();
    await page.locator('input[autocomplete="name"]').fill('Test');
    await page.locator('input[type="tel"]').fill('2125550123');
    await page.locator('.cart__foot .btn--primary').click();
    await settle(page, 2500);
    await shot(page, `${kind}-uncertain`);
  },
  async ticket(page, kind) {
    const id = '00000000-0000-4000-8000-000000000000';
    await page.route(API + '/Order/' + id, (route) =>
      json(route, 200, { isSuccess: true, error: null, message: null, data: {
        id, shortId: 'A1B2', orderSerialNumber: '042', orderStatusLabel: 'UNPAID', priceType: 'CARD_PRICE', subTotal: 448.8, cashSubTotal: 440, cardSubTotal: 448.8,
        total: 448.8, cashTotal: 440, cardTotal: 448.8, checkoutType: 'PAY_IN_STORE', pickupName: 'Test', note: null, lifecycleStatus: 'ACTIVE', fulfillmentStatus: 'PREPARING', adjustments: [],
        products: [
          { id: '1', productName: '老乾杯特製和牛咖哩', note: null, quantity: 1, subTotal: 387.6, cashSubTotal: 380, cardSubTotal: 387.6, modifiers: [] },
          { id: '2', productName: '北海道七星米白飯', note: 'less rice', quantity: 1, subTotal: 61.2, cashSubTotal: 60, cardSubTotal: 61.2, modifiers: [] },
        ] } }));
    await page.goto(PAGE + '?order=' + id);
    await page.waitForSelector('.ticket__number', { timeout: 30000 });
    await settle(page, 2200);
    await shot(page, `${kind}-ticket`);
  },
});

const browser = await chromium.launch();
for (const name of wanted.length ? wanted : ['home']) {
  for (const kind of ['phone', 'desktop']) {
    console.log(`${name} / ${kind}`);
    const page = await open(browser, kind);
    try {
      await scenarios[name](page, kind);
    } catch (e) {
      console.log('  FAILED', String(e).slice(0, 400));
      await shot(page, `${kind}-${name}-failed`).catch(() => {});
    }
    await page.context().close();
  }
}
await browser.close();
