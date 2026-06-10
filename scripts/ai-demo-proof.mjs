import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const baseUrl = option('base-url', process.env.KK_DEMO_URL || 'http://127.0.0.1:3000');
const bridgeUrl = option('bridge-url', process.env.KK_BRIDGE_URL || baseUrl);
const outputDir = path.resolve(option('out', path.join(repoRoot, 'tmp', 'ai-demo', 'proof')));
const pace = option('pace', 'fast');
const timeoutMs = Number(option('timeout-ms', pace === 'fast' ? '180000' : '420000'));
const headed = process.argv.includes('--headed');

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: !headed,
  executablePath: process.env.KK_CHROME_BIN || '/usr/bin/google-chrome',
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-SG',
  timezoneId: 'Asia/Singapore',
  geolocation: { latitude: 1.3118, longitude: 103.8608, accuracy: 8 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
});

let proof;
try {
  await page.goto(`${baseUrl}/demo${pace === 'fast' ? '?pace=fast' : ''}`);
  await page.getByRole('button', { name: /Play live demo/i }).click();
  const run = page.getByRole('button', { name: 'Run', exact: true });
  // The current launcher auto-runs after preparation. Older/manual variants
  // stop at a ready state with a separate Run button, so support both.
  await run.waitFor({ state: 'visible', timeout: 2500 }).then(
    () => run.click(),
    () => {},
  );

  await Promise.race([
    page.getByText(/AI demo completed at/i).waitFor({ timeout: timeoutMs }),
    page.getByText(/Demo stopped:/i).waitFor({ timeout: timeoutMs }),
  ]);

  const body = await page.locator('body').innerText();
  const sessionId = body.match(/DEMO-\d{8}-\d{6}-[A-Z0-9]{4}/)?.[0];
  if (!sessionId) throw new Error('Director did not expose a demo session ID');
  const statusResponse = await fetch(`${bridgeUrl}/api/demo/${sessionId}/status`);
  if (!statusResponse.ok) throw new Error(`Status endpoint returned HTTP ${statusResponse.status}`);
  const status = await statusResponse.json();
  const completed = body.includes('AI demo completed at') && !body.includes('Demo stopped:');
  proof = {
    sessionId,
    completed,
    retainedObjects: status.retainedObjects,
    byCluster: status.byCluster,
    browserErrors: errors,
    checkedAt: new Date().toISOString(),
  };
  if (!completed) throw new Error(body.match(/Demo stopped: .+/)?.[0] ?? 'Director failed');
  if (status.retainedObjects !== 0) throw new Error(`Cleanup left ${status.retainedObjects} retained demo objects`);
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join(' | ')}`);
} finally {
  await page.screenshot({ path: path.join(outputDir, 'final.png'), fullPage: true });
  if (proof) await writeFile(path.join(outputDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser.close();
}

console.log(`[demo-proof] passed ${proof.sessionId}; retained demo objects: ${proof.retainedObjects}`);
