// Pitch deck screenshot job.
//
// Seeds the major demo scenario via window.__kk.godSeedScenario('major') so
// every shot has real, populated content (reports, SOS, cases, events) — no
// "no items within 8 km" placeholders.
//
// Captures each drawer/state needed by /pitch/index.html and writes the PNGs
// into /pitch/shots/ with deck-friendly names.
//
//   BASE_URL=http://localhost:3000 node scripts/pitch-shots.mjs

import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = join(process.cwd(), 'pitch', 'shots');
const VIEWPORT = { width: 1440, height: 900 };

async function snap(page, name) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log('  ●', name);
}

async function bootOnce(page) {
  // Hit the URL exactly once; everything else happens in-page so we don't
  // wipe the seeded CSOT every time we switch roles.
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const kk = window.__kk;
    if (!kk) throw new Error('window.__kk not available — is this a dev/preview build?');
    kk.demoLogin('citizen');
  });
  await page.waitForTimeout(600);
  // Dismiss the optional PermissionPrompt modal so it doesn't sit over every shot.
  const skip = page.getByRole('button', { name: /skip for now/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(250);
  }
}

async function switchRole(page, role) {
  await page.evaluate((r) => {
    const kk = window.__kk;
    kk.setDrawerContent(null);
    kk.setRole(r);
  }, role);
  await page.waitForTimeout(400);
}

async function teleportSelfTo(page, lng, lat) {
  await page.evaluate(([x, y]) => {
    const kk = window.__kk;
    if (kk?.updateResponderLocation && kk?.SELF_ID) {
      kk.updateResponderLocation(kk.SELF_ID, { lng: x, lat: y });
    }
  }, [lng, lat]);
  await page.waitForTimeout(200);
}

async function seedMajor(page) {
  await page.evaluate(() => {
    const kk = window.__kk;
    kk.godResetCsot();
    kk.godSeedScenario('major');
    // Seed once more for richness — adds extra report + crash for queue depth.
    kk.godSeedScenario('minor');
  });
  await page.waitForTimeout(800);
}

async function openDrawer(page, id) {
  await page.evaluate((d) => window.__kk.setDrawerContent(d), id);
  await page.waitForTimeout(450);
}

async function closeDrawer(page) {
  await page.evaluate(() => window.__kk.setDrawerContent(null));
  await page.waitForTimeout(250);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // Boot once. Everything else uses in-page role switching so the CSOT
  // seeded below survives the whole capture run.
  await bootOnce(page);
  await seedMajor(page);

  // Tampines hub is where the major-seed SOS lives. Teleport the demo
  // responder there so the 8-km joinable-missions filter resolves to it.
  const TAMPINES = { lng: 103.9447, lat: 1.3528 };
  await teleportSelfTo(page, TAMPINES.lng, TAMPINES.lat);

  // ─── SLIDE 07 · three roles, one truth ────────────────────────────
  console.log('Slide 07 · three roles, one truth');
  await closeDrawer(page);
  await snap(page, 's07-citizen-home');

  await switchRole(page, 'responder');
  await openDrawer(page, 'joinable_missions');
  await snap(page, 's07-responder-joinable');
  await closeDrawer(page);

  await switchRole(page, 'ops');
  await openDrawer(page, 'report_queue');
  await snap(page, 's07-ops-report-queue');
  await closeDrawer(page);

  // ─── SLIDE 06 · AI · responder slash composer ─────────────────────
  console.log('Slide 06 · responder slash composer');
  await switchRole(page, 'responder');
  await openDrawer(page, 'mission_board');
  await snap(page, 's06-responder-copilot');
  await closeDrawer(page);

  // ─── SLIDE 08 · ops source health ─────────────────────────────
  console.log('Slide 08 · source health');
  await switchRole(page, 'ops');
  await openDrawer(page, 'source_health');
  await snap(page, 's08-source-health');
  await closeDrawer(page);

  // ─── SLIDE 09 · citizen flow (4 steps) ────────────────────────
  console.log('Slide 09 · citizen flow');
  await switchRole(page, 'citizen');
  await snap(page, 's09-citizen-1-home');
  await openDrawer(page, 'sos_draft');
  await snap(page, 's09-citizen-2-sos-draft');
  await closeDrawer(page);
  await openDrawer(page, 'report_compose');
  await snap(page, 's09-citizen-3-report');
  await closeDrawer(page);
  await openDrawer(page, 'alerts');
  await snap(page, 's09-citizen-4-alerts');
  await closeDrawer(page);

  // ─── SLIDE 10 · responder flow (4 steps) ──────────────────────────
  console.log('Slide 10 · responder flow');
  await switchRole(page, 'responder');
  await snap(page, 's10-responder-1-home');
  await openDrawer(page, 'mission_board');
  await snap(page, 's10-responder-2-mission-board');
  await closeDrawer(page);
  await openDrawer(page, 'joinable_missions');
  await snap(page, 's10-responder-3-joinable');
  await closeDrawer(page);
  await openDrawer(page, 'groups');
  await snap(page, 's10-responder-4-groups');
  await closeDrawer(page);

  // ─── SLIDE 11 · ops flow (4 steps) ────────────────────────────────
  console.log('Slide 11 · ops flow');
  await switchRole(page, 'ops');
  await openDrawer(page, 'report_queue');
  await snap(page, 's11-ops-1-report-queue');
  await closeDrawer(page);
  await openDrawer(page, 'dispatch');
  await snap(page, 's11-ops-2-dispatch');
  await closeDrawer(page);
  await openDrawer(page, 'declare');
  await snap(page, 's11-ops-3-declare');
  await closeDrawer(page);
  await openDrawer(page, 'broadcast');
  await snap(page, 's11-ops-4-broadcast');
  await closeDrawer(page);

  await browser.close();
  console.log('\nDone — wrote pitch shots to', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
