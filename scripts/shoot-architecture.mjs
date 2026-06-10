// Captures pitch/architecture.html at lossless quality.
// Outputs:
//   docs/architecture.svg  — pure vector, extracted from the page (lossless forever)
//   docs/architecture.png  — 3x DPI PNG of the dark diagram only (lossless raster)
//
// Run: node scripts/shoot-architecture.mjs

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const htmlPath = resolve(root, 'pitch/architecture.html');
const outDir = resolve(root, 'docs');
await mkdir(outDir, { recursive: true });

// --- 1. Extract the inline <svg>...</svg> as a standalone file -------------
const html = await readFile(htmlPath, 'utf8');
const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/);
if (!svgMatch) throw new Error('No <svg> found in architecture.html');
const svgRaw = svgMatch[0]
  // Ensure xmlns is present (it is, but be safe)
  .replace(/^<svg(?![^>]*xmlns)/, '<svg xmlns="http://www.w3.org/2000/svg"');
await writeFile(resolve(outDir, 'architecture.svg'), svgRaw, 'utf8');
console.log('✓ docs/architecture.svg written (', svgRaw.length, 'bytes )');

// --- 2. High-DPI PNG of just the .diagram element -------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1720, height: 1800 },
  deviceScaleFactor: 3,           // 3x DPI for crisp output
});
const page = await ctx.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });

// Wait for fonts to settle
await page.waitForTimeout(400);

const el = await page.locator('section.diagram');
await el.screenshot({
  path: resolve(outDir, 'architecture.png'),
  type: 'png',
  omitBackground: false,
});
console.log('✓ docs/architecture.png written (3x DPI)');

await browser.close();
