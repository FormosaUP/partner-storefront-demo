// Lays screenshots side by side into one contact sheet. Usage: node tools/sheet.mjs out.png height a.png b.png ...
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';

const [out, height, ...files] = process.argv.slice(2);
const images = files.map((f) => `<img src="${pathToFileURL(f).href}" style="height:${height}px">`).join('');
const html = `${out}.html`;
writeFileSync(html, `<body style="margin:0;background:#777;display:flex;gap:10px;padding:10px;align-items:flex-start;width:max-content">${images}</body>`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(pathToFileURL(html).href);
await page.locator('body').screenshot({ path: out });
await browser.close();
unlinkSync(html);
