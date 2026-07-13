/**
 * Quick dev screenshot helper: captures one 1600x1000 screenshot per route
 * from the local dev server (:4300).
 *
 * Usage: tsx scripts/dev-shot.ts /route [/route ...]
 * Output dir: $SHOT_DIR (default /tmp/cc-shots)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const routes = process.argv.slice(2);
const outDir = process.env.SHOT_DIR ?? '/tmp/cc-shots';
mkdirSync(outDir, { recursive: true });
const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (const r of routes) {
    const name = r === '/' ? 'root' : r.replace(/^\//, '').replace(/[/?&=%]+/g, '-');
    await page.goto(`http://localhost:4300${r}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
};
run();
