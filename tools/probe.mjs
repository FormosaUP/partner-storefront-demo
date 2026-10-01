// Calls the partner API from a page on the registered origin and saves the responses to temp/.
// Usage: node tools/probe.mjs GET /api/v1/Store/Settings [name] [jsonBody]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORIGIN_PAGE = 'https://formosaup.github.io/partner-storefront-demo/';
const API = 'https://api-dev.ulite.com/online-order/partner';

const calls = [];
const args = process.argv.slice(2);
if (args.length) {
  calls.push({ method: args[0], path: args[1], name: args[2] ?? 'probe', body: args[3] });
} else {
  calls.push(
    { method: 'GET', path: '/api/v1/Store/Settings', name: 'settings' },
    { method: 'GET', path: '/api/v1/Store/Languages', name: 'languages' },
    { method: 'GET', path: '/api/v1/Menu', name: 'menus' },
    { method: 'GET', path: '/api/v1/Category/AllWithProducts', name: 'categories' },
    { method: 'GET', path: '/api/v1/Product/Full', name: 'full' },
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(ORIGIN_PAGE, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
await page.goto(ORIGIN_PAGE);
mkdirSync('temp', { recursive: true });
for (const c of calls) {
  const res = await page.evaluate(async ({ url, method, body, lang }) => {
    try {
      const r = await fetch(url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(lang ? { 'X-Context-Language': lang } : {}) },
        body,
      });
      const headers = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      return { status: r.status, headers, text: await r.text() };
    } catch (e) {
      return { error: String(e) };
    }
  }, { url: API + c.path, method: c.method, body: c.body, lang: process.env.PROBE_LANG });
  writeFileSync(`temp/${c.name}.json`, res.text ?? JSON.stringify(res));
  console.log(c.method, c.path, '->', res.status ?? res.error, JSON.stringify(res.headers ?? {}), (res.text ?? '').length, 'bytes');
}
await browser.close();
