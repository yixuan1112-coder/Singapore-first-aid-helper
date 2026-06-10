// Wireframe screenshot job. Boots Playwright against a running dev server
// (default http://localhost:3000) and captures every role + workspace +
// God Mode tab as a PNG into docs/wireframe/.
//
//   node scripts/wireframe.mjs            # uses 3000
//   BASE_URL=http://localhost:5173 node scripts/wireframe.mjs
//
// Uses window.__kk (exposed by AppProvider in dev) to drive the shell
// directly instead of clicking through the UI — far more robust.

import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = join(process.cwd(), 'docs', 'wireframe');
const VIEWPORT = { width: 1440, height: 900 };
const SHOTS = [];

function shot(name) {
  return join(OUT_DIR, `${SHOTS.length.toString().padStart(2, '0')}-${name}.png`);
}

async function snap(page, label) {
  await page.waitForTimeout(400);
  const path = shot(label);
  await page.screenshot({ path, fullPage: false });
  SHOTS.push(label);
  console.log('  ●', label);
}

async function snapDrawer(page, label) {
  // Capture the right-edge column where the workspace drawer lives. Using a
  // viewport clip is deterministic — element-based shots failed on heavier
  // workspaces because layout settled after the timeout.
  await page.waitForTimeout(400);
  const vp = page.viewportSize();
  if (!vp) return;
  const drawerWidth = 540;
  const path = join(OUT_DIR, `${(SHOTS.length - 1).toString().padStart(2, '0')}-${label}-drawer.png`);
  try {
    await page.screenshot({
      path,
      clip: {
        x: Math.max(0, vp.width - drawerWidth),
        y: 0,
        width: Math.min(drawerWidth, vp.width),
        height: vp.height,
      },
    });
    console.log('    ↳ drawer', label);
  } catch (err) {
    console.warn('    ! drawer skipped', label, err.message);
  }
}

async function snapBand(page, label) {
  // Capture the LiveOpsBand strip — TopChrome + band, no map.
  await page.waitForTimeout(300);
  const path = join(OUT_DIR, `${SHOTS.length.toString().padStart(2, '0')}-${label}.png`);
  try {
    const vp = page.viewportSize();
    if (!vp) return;
    // The band sits just under TopChrome. ~52px top chrome + ~48px band = ~100px.
    await page.screenshot({
      path,
      clip: { x: 0, y: 0, width: vp.width, height: 110 },
    });
    SHOTS.push(label);
    console.log('  ●', label, '(band crop)');
  } catch (err) {
    console.warn('    ! band skipped', label, err.message);
  }
}

async function waitForKk(page) {
  await page.waitForFunction(() => Boolean(window.__kk));
}

// Block until AppContext has populated liveSnapshot with actual data.gov.sg
// readings. Without this we screenshot before the 3 NEA fetches resolve and
// every "live" panel looks empty.
async function waitForLiveSnapshot(page, timeoutMs = 8000) {
  try {
    await page.waitForFunction(
      () => {
        const snap = window.__kk?.liveSnapshot;
        if (!snap) return false;
        return (snap.rainfall?.length ?? 0) > 0 || (snap.forecast?.length ?? 0) > 0;
      },
      { timeout: timeoutMs },
    );
    console.log('  ✓ liveSnapshot populated');
  } catch {
    console.warn('  ! liveSnapshot did not arrive within', timeoutMs, 'ms (continuing anyway)');
  }
}

// The provider-quota guard persists hit timestamps in localStorage with a
// 30s min-interval. If we navigate twice (which we do, to seed permissions),
// the second mount gets rate-limited and liveSnapshot ends up empty. Clear
// the quota keys before each real load so fresh fetches go through.
async function clearProviderQuota(page) {
  await page.evaluate(() => {
    for (const provider of ['datagov', 'datamall', 'onemap', 'openrouter']) {
      try {
        localStorage.removeItem('kk:providerHits:' + provider);
      } catch {
        /* noop */
      }
    }
  });
}

async function login(page, role) {
  await page.evaluate((r) => window.__kk.demoLogin(r), role);
  await waitForKk(page);
  await page.waitForTimeout(400);
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

  page.on('pageerror', (err) => console.warn('  ! pageerror:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.warn('  ! console error:', msg.text());
  });

  // Pre-dismiss the permission prompt and GPS gating so it doesn't cover shots.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'kk_permissions_prompted',
      JSON.stringify({ location: false, notifications: false }),
    );
  });
  // Wipe quota hits from the first mount so the second mount can fetch fresh.
  await clearProviderQuota(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForKk(page);
  await waitForLiveSnapshot(page);
  await snap(page, 'login');

  // Seed something so the role homes have real data to render against.
  await login(page, 'ops');
  await page.evaluate(() => window.__kk.godSeedScenario('major'));
  await page.waitForTimeout(800);

  // ── Citizen ─────────────────────────────────────────────────────────
  await login(page, 'citizen');
  await snap(page, 'citizen-home');
  await snapBand(page, 'citizen-liveband');
  for (const [id, label] of [
    ['briefing', 'briefing'],
    ['alerts', 'alerts'],
    ['report_compose', 'report-compose'],
    ['citizen_ai', 'citizen-ai'],
    ['sos_draft', 'sos-draft'],
  ]) {
    await openDrawer(page, id);
    await snap(page, `citizen-${label}`);
    await snapDrawer(page, `citizen-${label}`);
    await closeDrawer(page);
  }

  // ── Responder ───────────────────────────────────────────────────────
  await login(page, 'responder');
  await snap(page, 'responder-home');
  await snapBand(page, 'responder-liveband');
  for (const [id, label] of [
    ['mission_board', 'mission-board'],
    ['joinable_missions', 'joinable-missions'],
    ['responder_ai', 'mission-copilot'],
    ['groups', 'groups'],
    ['volunteer_events', 'volunteer-events'],
    ['activity_log', 'activity-log'],
  ]) {
    await openDrawer(page, id);
    await snap(page, `responder-${label}`);
    await snapDrawer(page, `responder-${label}`);
    await closeDrawer(page);
  }

  // ── Ops ─────────────────────────────────────────────────────────────
  await login(page, 'ops');
  await snap(page, 'ops-home');
  for (const [id, label] of [
    ['report_queue', 'report-queue'],
    ['distress_oversight', 'distress'],
    ['case_oversight', 'case-overview'],
    ['responder_oversight', 'responder-roster'],
    ['dispatch', 'dispatch'],
    ['declare', 'declare'],
    ['ops_ai', 'command-copilot'],
    ['broadcast', 'broadcast'],
    ['source_health', 'source-health'],
    ['activity_log', 'ops-activity-log'],
  ]) {
    if (id === 'activity_log') {
      // Populate the log with realistic ops actions so the tile shows what a
      // working audit feed looks like, not just one God Mode seed entry.
      await page.evaluate(() => {
        const kk = window.__kk;
        if (!kk) return;
        const repA = kk.fileReport
          ? kk.fileReport({
              kind: 'fire',
              title: 'Smoke spotted near Bedok Mall',
              body: 'Demo · seeded for the screenshot run.',
              location: { lng: 103.9298, lat: 1.324 },
            })
          : null;
        const repB = kk.fileReport
          ? kk.fileReport({
              kind: 'medical',
              title: 'Elderly resident collapsed at Tampines',
              body: 'Demo · seeded for the screenshot run.',
              location: { lng: 103.9447, lat: 1.3528 },
            })
          : null;
        if (repA && kk.claimReport) kk.claimReport(repA, 'U-OPS-1');
        if (repA && kk.verifyReport) kk.verifyReport(repA);
        if (repB && kk.dismissReport) kk.dismissReport(repB);
      }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await openDrawer(page, id);
    await snap(page, `ops-${label}`);
    await snapDrawer(page, `ops-${label}`);
    await closeDrawer(page);
  }

  // ── God Mode ────────────────────────────────────────────────────────
  // Open via localStorage flag + reload (most robust)
  await page.evaluate(() => localStorage.setItem('kk:godmode:open', '1'));
  await clearProviderQuota(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForKk(page);
  await login(page, 'ops'); // re-auth after reload
  await page.evaluate(() => localStorage.setItem('kk:godmode:open', '1'));
  await clearProviderQuota(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForKk(page);
  await login(page, 'ops');
  await waitForLiveSnapshot(page);

  await page.waitForTimeout(500);
  await snap(page, 'godmode-csot');

  for (const tab of ['Seed', 'Sources', 'AI matrix']) {
    const btn = page.locator('aside').last().getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).first();
    await btn.click();
    await page.waitForTimeout(350);
    await snap(page, `godmode-${tab.toLowerCase().replace(/\s+/g, '-')}`);
  }

  // Seed via God Mode and re-capture CSOT
  const seedTab = page.locator('aside').last().getByRole('button', { name: /^Seed$/i }).first();
  await seedTab.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /seed · major scenario/i }).click();
  await page.waitForTimeout(400);
  const csotTab = page.locator('aside').last().getByRole('button', { name: /^CSOT$/i }).first();
  await csotTab.click();
  await page.waitForTimeout(400);
  await snap(page, 'godmode-csot-seeded');

  await browser.close();
  console.log(`\nWrote ${SHOTS.length} screenshots to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
