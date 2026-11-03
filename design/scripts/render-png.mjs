// Рендер SVG-превью в PNG через предустановленный Playwright (Chromium).
// node scripts/render-png.mjs [--scale 2] [id ...]
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si >= 0 ? Number(args.splice(si, 2)[1]) : 2;
const only = args;

const dir = path.join(ROOT, 'previews', 'svg');
const files = readdirSync(dir).filter((f) => f.endsWith('.svg') && (!only.length || only.some((o) => f.includes(o))));
const browser = await chromium.launch();
for (const f of files) {
  const page = await browser.newPage({ deviceScaleFactor: scale });
  await page.goto(pathToFileURL(path.join(dir, f)).href);
  const { w, h } = await page.evaluate(() => ({ w: document.documentElement.width.baseVal.value, h: document.documentElement.height.baseVal.value }));
  await page.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const out = path.join(ROOT, 'previews', f.replace(/\.svg$/, '.png'));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) } });
  console.log('png', path.basename(out));
  await page.close();
}
await browser.close();
