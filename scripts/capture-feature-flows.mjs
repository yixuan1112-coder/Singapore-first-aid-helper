import { chromium } from 'playwright';

const baseURL = process.env.SMOKE_URL ?? 'http://localhost:3000/';
const outDir = 'docs/feature-shots';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const wait = () => page.waitForTimeout(250);
const shot = async (name) => {
  await wait();
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
};
const text = (label) => page.getByText(label, { exact: false }).first();
const clickText = async (label) => {
  await text(label).click();
  await wait();
};
const setRole = async (role) => {
  await page.locator('select').first().selectOption(role);
  await wait();
};
const reset = async (role = 'citizen') => {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await setRole(role);
};

try {
  await reset('citizen');
  await shot('00-shell-citizen-map');

  await clickText('Need help');
  await shot('01-citizen-sos-category');
  await clickText('Send for help');
  await shot('02-citizen-sos-live');

  await reset('citizen');
  await clickText('Report');
  await shot('03-citizen-report-choice');
  await clickText('Emergency report form');
  await clickText('Next');
  await clickText('Next');
  await page.getByPlaceholder('Short title').fill('Feature capture report');
  await page.getByPlaceholder('What did you see?').fill('Hazard report created during feature walkthrough.');
  await clickText('Attach photo');
  await shot('04-citizen-report-evidence');
  await clickText('Next');
  await shot('05-citizen-report-review');
  await clickText('File report');
  await shot('06-citizen-report-filed');

  await reset('citizen');
  await clickText('Report');
  await clickText('Voice-prepared report');
  await page.getByPlaceholder('Example: elderly man collapsed near City Hall exit B, needs medical help').fill('Elderly man collapsed near City Hall exit B and needs medical help.');
  await shot('07-citizen-voice-report');

  await reset('citizen');
  await clickText('Report');
  await clickText('Volunteer / community event');
  await shot('08-citizen-volunteer-request');

  await reset('citizen');
  await clickText('Alerts');
  await shot('09-citizen-alerts-nearby');

  await reset('responder');
  await shot('10-responder-shell');
  await clickText('Join');
  await shot('11-responder-joinable-missions');
  const accept = text('Accept SOS');
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
    await shot('12-responder-assignment-after-accept');
  }
  await reset('responder');
  await clickText('Events');
  await shot('13-responder-volunteer-events');
  await text('Join event').first().click().catch(() => undefined);
  await shot('14-responder-event-registered');
  await page.getByTitle('Open profile').click();
  await shot('15-responder-profile');

  await reset('responder');
  await clickText('Groups');
  await shot('16-responder-groups-cases');
  await clickText('ALPHA-09');
  await shot('17-responder-case-room');

  await reset('ops');
  await shot('18-ops-shell');
  await clickText('Reports');
  await shot('19-ops-report-queue');
  await clickText('Distress');
  await shot('20-ops-distress-oversight');
  await clickText('Cases');
  await shot('21-ops-case-oversight');
  await clickText('Roster');
  await shot('22-ops-roster-status');
  await clickText('Zones');
  await shot('23-ops-zones');
  await clickText('Create demo drawn zone');
  await shot('24-ops-zone-created');
  await clickText('Dispatch');
  await shot('25-ops-dispatch');
  await clickText('Broadcast');
  await shot('26-ops-broadcast');
  await clickText('Send broadcast');
  await shot('27-ops-broadcast-queued');
  await clickText('Source health');
  await shot('28-ops-source-health');
  await clickText('Truth');
  await shot('29-ops-readiness-truth');

  console.log('feature screenshots captured');
} finally {
  await browser.close();
}
