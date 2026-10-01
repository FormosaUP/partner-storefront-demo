// Renders a proposed store logo and banner into brand/. The banner is a collage of the store's own dish photos.
// Usage: node tools/brand.mjs   (needs temp/big-photos.json from a catalogue probe)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, statSync } from 'node:fs';

const photos = JSON.parse(readFileSync('temp/big-photos.json', 'utf8'));
const pick = (name) => {
  const p = photos.find((x) => x.name.includes(name));
  if (!p) throw new Error('photo not found: ' + name);
  return p.url;
};
const tiles = [
  { area: '1 / 1 / 3 / 2', url: pick('特選日本和牛烤肉醬姿切套餐'), pos: '50% 45%' },
  { area: '1 / 2 / 2 / 3', url: pick('貓下去招牌涼麵'), pos: '50% 50%' },
  { area: '1 / 3 / 2 / 4', url: pick('葡萄柚的寂寞'), pos: '50% 40%' },
  { area: '2 / 2 / 3 / 4', url: pick('蜂蜜吐司總匯三明治'), pos: '50% 55%' },
];
const FONT = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,144,600;1,144,500&display=block';
mkdirSync('brand', { recursive: true });

const browser = await chromium.launch();

// Banner: 1600x900, kept light so it can be the hero image on any screen.
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; width: 1600px; height: 900px; background: #f6f1e7; }
    .grid { box-sizing: border-box; width: 100%; height: 100%; padding: 22px; display: grid; gap: 16px;
      grid-template-columns: 1.25fr 0.8fr 0.8fr; grid-template-rows: 1fr 0.82fr; }
    .tile { border-radius: 26px; overflow: hidden; box-shadow: 0 0 0 2px #1d1a16; background: #ece5d6 center / cover no-repeat; }
    .tile:nth-child(1) { border-radius: 26px 26px 26px 6px; }
  </style><div class="grid">${tiles.map((t) => `<div class="tile" style="grid-area:${t.area};background-image:url('${t.url}');background-position:${t.pos}"></div>`).join('')}</div>`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'brand/banner.jpg', type: 'jpeg', quality: 80 });
  await page.close();
}

// Logo: 512x512, reads at 40px.
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><link rel="stylesheet" href="${FONT}"><style>
    body { margin: 0; width: 512px; height: 512px; background: #b8431a; display: grid; place-items: center; overflow: hidden; }
    .ring { position: absolute; inset: 34px; border: 3px dashed rgb(246 241 231 / 0.55); border-radius: 50%; }
    .word { position: relative; font: italic 500 250px/1 'Fraunces', serif; color: #f6f1e7; letter-spacing: -0.04em; transform: translateY(-14px); }
  </style><div class="ring"></div><div class="word">up</div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'brand/logo.png' });
  await page.close();
}
await browser.close();
for (const f of ['brand/banner.jpg', 'brand/logo.png']) console.log(f, Math.round(statSync(f).size / 1024) + 'KB');
