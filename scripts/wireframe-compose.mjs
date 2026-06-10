// Compose the submission wireframe.
//
// Outputs:
//   docs/index.html      — GitHub Pages root (interactive flow + descriptions)
//   docs/wireframe.png   — single-image fallback render
//   docs/.nojekyll       — disables Jekyll on GitHub Pages
//
// Inputs:
//   docs/wireframe/*.png — captured by scripts/wireframe.mjs
//
// Each role lane lays its screens out on a CSS Grid; an SVG overlay draws
// curved flow arrows between screen pairs declared in EDGES at load time.

import { chromium } from 'playwright';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SHOTS_DIR = join(ROOT, 'docs', 'wireframe');
const DOCS_DIR = join(ROOT, 'docs');
const HTML_OUT = join(DOCS_DIR, 'index.html');
const PNG_OUT = join(DOCS_DIR, 'wireframe.png');
const NOJEKYLL = join(DOCS_DIR, '.nojekyll');

// id → { match, title, desc, comments[] }
// match = suffix of screenshot file after the NN- prefix.
// Descriptions are feature/product-level — what this screen does for the user
// and what makes it distinctive. Not implementation detail.
const SCREENS = {
  // ── Auth ─────────────────────────────────────────────────────────
  'auth-login': {
    lane: 'auth',
    match: 'login',
    title: 'Sign in',
    desc: 'Single entry for citizens, responders, and operations staff. Picks the workspace each role gets when they enter.',
    comments: [
      'Three roles share one app — the next screen reshapes around who you are.',
    ],
  },

  // ── Citizen ──────────────────────────────────────────────────────
  'cz-band': {
    lane: 'citizen',
    match: 'citizen-liveband',
    title: 'Live ops band (in-app)',
    wide: true,
    desc: 'Persistent band under the top chrome showing the four live data trackers the rest of the shell depends on, plus a one-tap entry to AI Kaki. Same data feeds the map overlays and the AI context.',
    comments: [
      'Chips: PSI (NEA · 60s) · Rain stations (NEA · 60s) · OneMap themes (5m cache) · LTA traffic (5m cache).',
      'Provider state badge is the same SourceHealth the ops Source Health workspace shows — one truth.',
      'Right edge: "Ask AI Kaki" jumps straight into the citizen_assistant prompt.',
    ],
  },
  'cz-home': {
    lane: 'citizen',
    match: 'citizen-home',
    title: 'Citizen home',
    desc: 'Live Singapore map showing only published, trustworthy alerts plus public-data overlays (air quality, rainfall, hospitals, AEDs).',
    comments: [
      'OneMap SG basemap (CORS-open tiles); NEA PSI + rainfall overlays refresh every 60 s; OneMap hospitals + AEDs prefetched server-side.',
      'No noise: unverified citizen reports stay off the public map.',
    ],
  },
  'cz-brief': {
    lane: 'citizen',
    match: 'citizen-briefing',
    title: 'Briefing',
    desc: 'A short, scrollable summary of what is happening near you right now and what ops has officially confirmed.',
    comments: [
      'Rule-based, not AI: counts verified events + role-relevant notifications via a single deterministic selector (selectBriefingCounts in src/state/selectors.ts).',
      'The badge in the top bar shows the same number — one truth, two surfaces.',
    ],
  },
  'cz-alerts': {
    lane: 'citizen',
    match: 'citizen-alerts',
    title: 'Nearby alerts',
    desc: 'Active incidents and community events within walking / commuting distance, sorted by proximity.',
    comments: [
      'Rule-based: filters verified events + volunteer events within 5 km of the device GPS, sorted by haversine distance.',
      'Falls back to Singapore centroid (labelled) when GPS is off — no fake locations.',
    ],
  },
  'cz-report': {
    lane: 'citizen',
    match: 'citizen-report-compose',
    title: 'File a report',
    desc: 'Guided four-step report flow: pick a category, drop a pin, describe what you saw, review and submit.',
    comments: [
      'Goes to ops triage — citizens do not page responders directly except via SOS.',
      'Voice or photo capture both supported; transcript is read back before sending.',
    ],
  },
  'cz-sos': {
    lane: 'citizen',
    match: 'citizen-sos-draft',
    title: 'SOS · pick category',
    desc: 'One screen, one tap: medical, fire, trapped, threat, hazard, or other. Sent simultaneously to ops and any suitable responders nearby.',
    comments: [
      'Location banner makes the citizen aware whether the pin is exact (GPS) or approximate.',
    ],
  },
  'cz-sos-live': {
    lane: 'citizen',
    match: 'citizen-sos-draft',
    title: 'SOS live tracking',
    desc: 'After sending: a live status pill on the map and a step-by-step pipeline showing who is coming, when, and how to close the call safely.',
    comments: [
      'ETA is real — distance between responder and citizen ÷ a 35 km/h surface-mix estimate, recomputed each state change.',
      'Closure needs two acknowledgements (citizen safe + responder complete) — no silent resolves.',
    ],
  },
  'cz-ai': {
    lane: 'citizen',
    match: 'citizen-citizen-ai',
    title: 'AI Kaki',
    desc: 'A plain-language safety assistant the citizen can ask for guidance ("what should I do near the haze?", "where is the nearest AED?").',
    comments: [
      'Grounded in live public data; says "unavailable" rather than invent a number.',
    ],
    ai: {
      provider: 'OpenRouter',
      model: 'Dev: minimax/minimax-m2.5 · Production: openai/gpt-5.5 (swap via OPENROUTER_MODEL)',
      workspace: 'citizen_assistant',
      tools: ['live PSI (NEA)', 'rainfall (NEA)', 'nearest AED (OneMap)'],
      fallback:
        'When OpenRouter is unreachable, a deterministic responder built from the same tool results answers in the same shape.',
    },
  },

  // ── Responder ────────────────────────────────────────────────────
  'rp-band': {
    lane: 'responder',
    match: 'responder-liveband',
    title: 'Live ops band (in-app)',
    wide: true,
    desc: 'Same persistent band, same chips — but the AI entry on the right goes to Mission Copilot for the responder.',
    comments: [
      'Lets a responder eyeball provider health (PSI, rainfall, OneMap, LTA) without leaving the map.',
      'Right edge: "Ask Mission Copilot" jumps into the responder_mission prompt with the live position in context.',
    ],
  },
  'rp-home': {
    lane: 'responder',
    match: 'responder-home',
    title: 'Responder home',
    desc: 'Same map, fuller picture — adds active SOS pings, fellow responders, and case-room rooms in the side panel.',
    comments: [
      'Volunteers and professionals share one shell; visibility differs by role, not by app.',
    ],
  },
  'rp-mboard': {
    lane: 'responder',
    match: 'responder-mission-board',
    title: 'Mission board',
    desc: 'Single board with the responder\'s current job, queued assignments, and joinable work — all in one place.',
    comments: [
      'Designed to answer "what should I do next" in under three seconds.',
    ],
  },
  'rp-join': {
    lane: 'responder',
    match: 'responder-joinable-missions',
    title: 'Joinable missions',
    desc: 'Open SOS calls and ops-formed case rooms within reach, ranked by fit (skills, distance, availability).',
    comments: [
      'Same fit score the Mission Copilot uses, just without the natural-language wrapper — rule-based, not AI.',
      'Official-only operations show as "monitor only" so volunteers do not interfere with SCDF/SPF.',
    ],
  },
  'rp-copilot': {
    lane: 'responder',
    match: 'responder-mission-copilot',
    title: 'Mission copilot',
    desc: 'A responder-side AI that picks the best two missions for you right now and explains why.',
    comments: [
      'Pre-ranks options with a deterministic fit score (capability × distance × ready-status × severity) before asking the model — saves tokens and keeps reasoning auditable.',
      'Volunteer kit de-prioritises suppression-heavy fires; restricted ops cases never surface as joinable.',
    ],
    ai: {
      provider: 'OpenRouter',
      model: 'Dev: minimax/minimax-m2.5 · Production: openai/gpt-5.5 (swap via OPENROUTER_MODEL)',
      workspace: 'responder_mission',
      tools: ['live PSI (NEA)'],
      fallback:
        'When OpenRouter is unreachable, the same fit-scored list is returned with a plain-text summary.',
    },
  },
  'rp-groups': {
    lane: 'responder',
    match: 'responder-groups',
    title: 'Groups & rooms',
    desc: 'Org units (SCDF East), capability cadres (AED Responders, Fire Auxiliary), and the live case rooms you belong to.',
    comments: [
      'One tap to join or leave any group; case rooms come and go as ops opens them.',
    ],
  },
  'rp-events': {
    lane: 'responder',
    match: 'responder-volunteer-events',
    title: 'Volunteer events',
    desc: 'Non-emergency community work — drills, cleanups, food distribution, elderly care — that citizens or ops have posted.',
    comments: [
      'Same app, different rhythm: keeps volunteers engaged between live incidents.',
    ],
  },
  'rp-log': {
    lane: 'responder',
    match: 'responder-activity-log',
    title: 'Activity log',
    desc: 'A timestamped record of what happened on the responder\'s missions — for handover, debrief, and after-action.',
    comments: [
      'Same record ops sees; nothing hidden between roles.',
    ],
  },

  // ── Ops ──────────────────────────────────────────────────────────
  'ops-home': {
    lane: 'ops',
    match: 'ops-home',
    title: 'Ops home',
    desc: 'The full map: every report, SOS, case, and responder position. Drawing toolbox on the right for declaring zones.',
    comments: [
      'Only ops gets a polygon / lasso. Citizens and responders cannot draw their own areas.',
    ],
  },
  'ops-reports': {
    lane: 'ops',
    match: 'ops-report-queue',
    title: 'Report queue',
    desc: 'Incoming citizen reports awaiting triage. Verify to publish them; dismiss to close the loop with the reporter.',
    comments: [
      'No public map item exists until ops has signed off — keeps misinformation out.',
    ],
  },
  'ops-distress': {
    lane: 'ops',
    match: 'ops-distress',
    title: 'Distress oversight',
    desc: 'All live SOS calls. Single click jumps to dispatch for that specific call.',
    comments: [
      'SOS bypass the verification queue — they go to ops and responders at once.',
    ],
  },
  'ops-cases': {
    lane: 'ops',
    match: 'ops-case-overview',
    title: 'Case overview',
    desc: 'Every active case room with severity, lifecycle state, member count, and captain.',
    comments: [
      'Lifecycle: forming → staging → active → consolidating → resolved.',
    ],
  },
  'ops-roster': {
    lane: 'ops',
    match: 'ops-responder-roster',
    title: 'Responder roster',
    desc: 'The available workforce — who is on duty, who is busy, who is en route. Manual retasking happens here.',
    comments: [
      'Professionals and volunteers share one roster, tagged by org.',
    ],
  },
  'ops-dispatch': {
    lane: 'ops',
    match: 'ops-dispatch',
    title: 'Dispatch',
    desc: 'Picks the nearest available responder for the selected SOS or case. One tap to assign.',
    comments: [
      'Rule-based ranking — Euclidean distance × 111 km/deg to the call\'s coordinates. No AI in this loop; assignments must be auditable.',
      'Assigning also patches the responder to en_route and the SOS to ack in the same transaction.',
    ],
  },
  'ops-declare': {
    lane: 'ops',
    match: 'ops-declare',
    title: 'Declare incident',
    desc: 'Manual incident declaration when ops wants to get ahead of citizens: severity, kind, optional polygon area.',
    comments: [
      'Severity ≥ 4 raises an urgent push to citizens, responders, and ops together.',
    ],
  },
  'ops-copilot': {
    lane: 'ops',
    match: 'ops-command-copilot',
    title: 'Command copilot',
    desc: 'An ops-side AI that watches the whole picture and suggests the next move — who to send where, what to broadcast.',
    comments: [
      'Context packet ships the live report queue + active SOS (each with nearest ready responder + real ETA) + cases + source health + PSI to the model.',
      'Suggestions cite the data they came from; ETAs are derived (m:ss), never invented.',
    ],
    ai: {
      provider: 'OpenRouter',
      model: 'Dev: minimax/minimax-m2.5 · Production: openai/gpt-5.5 (swap via OPENROUTER_MODEL)',
      workspace: 'ops_command',
      tools: ['live PSI (NEA)', 'rainfall (NEA)'],
      fallback:
        'When OpenRouter is unreachable, a deterministic responder summarises queue depth + PSI in the same shape.',
    },
  },
  'ops-broadcast': {
    lane: 'ops',
    match: 'ops-broadcast',
    title: 'Broadcast',
    desc: 'Compose a short, geo-bounded public message: title, body, audience scope (citizens only, or citizens + responders).',
    comments: [
      'Reach is reported as polygon area, not a fake device count.',
    ],
  },
  'ops-sources': {
    lane: 'ops',
    match: 'ops-source-health',
    title: 'Source health',
    desc: 'Status board for every external data provider Kampung Kaki depends on (NEA, OneMap, LTA, MOH, etc.).',
    comments: [
      'States: fresh · stale · down · shell_only · not_configured · unavailable. The Host AI server reads this same array — if a tool is down, the AI is told so and answers "unavailable".',
    ],
  },
  'ops-log': {
    lane: 'ops',
    match: 'ops-ops-activity-log',
    title: 'Activity log',
    desc: 'Append-only system of record. Every verify, dismiss, dispatch, declare, broadcast is captured for audit.',
    comments: [
      'Visibility is per-role: citizens see citizen-relevant lines; ops sees everything.',
    ],
  },

  // ── God Mode (demo, not part of the production flow) ────────────
  'god-csot': {
    lane: 'godmode',
    match: 'godmode-csot',
    title: 'CSOT inspector',
    desc: 'Live counts per data cluster (citizen intake, incidents, operations, network, intel). Lets a presenter prove the map and the records match.',
    comments: [
      'Read-only view of the in-memory store; same data the real screens read from.',
    ],
  },
  'god-seed': {
    lane: 'godmode',
    match: 'godmode-seed',
    title: 'Seed scenarios',
    desc: 'Two preset demos (minor + major) plus "send SOS as me" so the pitch can show a real flow in seconds. Reset wipes the seeded state.',
    comments: [
      'Seeds are tagged actor=godmode in the audit log so the demo never looks like real data.',
    ],
  },
  'god-sources': {
    lane: 'godmode',
    match: 'godmode-sources',
    title: 'Source state cycler',
    desc: 'Click any data source to cycle its state (fresh → stale → down → not_configured). Demonstrates how the UI degrades honestly when a provider goes dark.',
    comments: [
      'Same source list ops sees. Useful for the "what happens when NEA goes down?" pitch beat.',
    ],
  },
  'god-matrix': {
    lane: 'godmode',
    match: 'godmode-ai-matrix',
    title: 'AI dispatch matrix',
    desc: 'Lists every role × workspace → system-prompt pairing the Host AI supports, so the team can audit which screens talk to the model and how.',
    comments: [
      'Five active modes: citizen_alert · citizen_assistant · responder_case · responder_mission · ops_command.',
    ],
  },
  'god-seeded': {
    lane: 'godmode',
    match: 'godmode-csot-seeded',
    title: 'CSOT after seed',
    desc: 'The CSOT inspector right after a major seed — counts move, source health stays honest. The proof that "shared truth" is one store, not five.',
    comments: [
      'Pitch beat: open this side-by-side with the citizen, responder, and ops home tabs and seed something new.',
    ],
  },
};

// Each lane is a linear flow. order[] declares the user journey; tiles wrap
// every `wrapEvery` screens onto a new row. EDGES are auto-derived to be
// strictly forward (i → i+1), so arrows never cross tiles.
const LANES = [
  {
    id: 'auth',
    title: '1 · Auth',
    blurb: 'Demo accounts gate the shell. Real sign-in is stubbed in this section.',
    wrapEvery: 4,
    order: ['auth-login'],
  },
  {
    id: 'citizen',
    title: '2 · Citizen',
    blurb: 'Map → briefing → alerts → report → SOS. AI Kaki is an on-demand side branch from home.',
    wrapEvery: 4,
    order: ['cz-home', 'cz-band', 'cz-brief', 'cz-alerts', 'cz-report', 'cz-sos', 'cz-sos-live', 'cz-ai'],
  },
  {
    id: 'responder',
    title: '3 · Responder',
    blurb: 'Home → mission board → join → copilot. Groups, events, log are side surfaces.',
    wrapEvery: 4,
    order: ['rp-home', 'rp-band', 'rp-mboard', 'rp-join', 'rp-copilot', 'rp-groups', 'rp-events', 'rp-log'],
  },
  {
    id: 'ops',
    title: '4 · Ops',
    blurb: 'Triage (reports → distress → cases → roster) → dispatch → declare/broadcast → audit (sources → log). Command copilot sits between dispatch and declare.',
    wrapEvery: 4,
    order: [
      'ops-home',
      'ops-reports',
      'ops-distress',
      'ops-cases',
      'ops-roster',
      'ops-dispatch',
      'ops-copilot',
      'ops-declare',
      'ops-broadcast',
      'ops-sources',
      'ops-log',
    ],
  },
  {
    id: 'godmode',
    kind: 'demo',
    title: 'D · God Mode · demo dock (not in production)',
    blurb: 'Presenter-only tooling, off by default, lives outside the real user journey. Seeds scenarios, flips source states, swaps roles — so a pitch can drive the citizen / responder / ops flows without waiting for live data.',
    wrapEvery: 4,
    order: ['god-csot', 'god-seed', 'god-sources', 'god-matrix', 'god-seeded'],
  },
];

// EDGES = consecutive pairs from each lane.order, with kind hint so the
// renderer knows whether to draw a same-row arrow or a row-wrap arrow.
const EDGES = [];
for (const lane of LANES) {
  for (let i = 0; i < lane.order.length - 1; i++) {
    const fromCol = (i % lane.wrapEvery) + 1;
    const fromRow = Math.floor(i / lane.wrapEvery) + 1;
    const toCol = ((i + 1) % lane.wrapEvery) + 1;
    const toRow = Math.floor((i + 1) / lane.wrapEvery) + 1;
    EDGES.push({
      from: lane.order[i],
      to: lane.order[i + 1],
      kind: toRow === fromRow ? 'next' : 'wrap',
    });
  }
}

async function main() {
  await mkdir(DOCS_DIR, { recursive: true });

  const files = (await readdir(SHOTS_DIR)).filter((f) => f.endsWith('.png'));
  const byMatch = new Map();
  const byMatchDrawer = new Map();
  for (const f of files) {
    const trimmed = f.replace(/^\d+-/, '').replace(/\.png$/, '');
    if (trimmed.endsWith('-drawer')) {
      byMatchDrawer.set(trimmed.replace(/-drawer$/, ''), f);
    } else {
      byMatch.set(trimmed, f);
    }
  }
  function pickFile(match) {
    // Prefer the drawer crop when one exists — that's where the actual
    // workspace content lives. Fall back to the full screenshot for homes
    // (which have no drawer open) and God Mode (which is its own dock).
    return byMatchDrawer.get(match) ?? byMatch.get(match);
  }

  const dataUriCache = new Map();
  async function asDataUri(filename) {
    if (dataUriCache.has(filename)) return dataUriCache.get(filename);
    const buf = await readFile(join(SHOTS_DIR, filename));
    const uri = `data:image/png;base64,${buf.toString('base64')}`;
    dataUriCache.set(filename, uri);
    return uri;
  }

  // Build per-lane screen cards
  async function renderLane(lane) {
    const cards = [];
    for (let i = 0; i < lane.order.length; i++) {
      const id = lane.order[i];
      const s = SCREENS[id];
      if (!s) continue;
      const col = (i % lane.wrapEvery) + 1;
      const row = Math.floor(i / lane.wrapEvery) + 1;
      const file = pickFile(s.match);
      const img = file
        ? `<img src="${await asDataUri(file)}" alt="${escape(s.title)}" />`
        : `<div class="placeholder">missing ${s.match}</div>`;
      const comments = s.comments.map((c) => `<li>${escape(c)}</li>`).join('');
      const aiBlock = s.ai
        ? `<aside class="ai-credit">
            <strong>AI · ${escape(s.ai.provider)}</strong>
            <dl>
              <dt>Model</dt><dd>${escape(s.ai.model)}</dd>
              <dt>Prompt</dt><dd><code>${escape(s.ai.workspace)}</code></dd>
              <dt>Live tools</dt><dd>${s.ai.tools.map((t) => `<span class="pill">${escape(t)}</span>`).join(' ')}</dd>
              <dt>Fallback</dt><dd>${escape(s.ai.fallback)}</dd>
            </dl>
          </aside>`
        : '';
      const wideClass = s.wide ? ' wide' : '';
      cards.push(`
        <article class="screen${wideClass}" id="${id}" style="grid-column:${col};grid-row:${row}">
          <header><span class="num">${id}</span><h3>${escape(s.title)}</h3>${s.ai ? '<span class="ai-tag">AI</span>' : ''}</header>
          ${img}
          <p class="desc">${escape(s.desc)}</p>
          ${comments ? `<ul class="comments">${comments}</ul>` : ''}
          ${aiBlock}
        </article>
      `);
    }
    const isDemo = lane.kind === 'demo';
    return `
      <section class="lane lane-${lane.id} ${isDemo ? 'lane-demo' : ''}" data-lane="${lane.id}">
        <header class="lane-head">
          <h2><span class="lane-pill">${escape(lane.title)}</span></h2>
          <p>${escape(lane.blurb)}</p>
        </header>
        <div class="lane-canvas">
          <div class="grid">${cards.join('\n')}</div>
        </div>
      </section>
    `;
  }

  const lanesHtml = [];
  for (const lane of LANES) lanesHtml.push(await renderLane(lane));

  const edgeData = JSON.stringify(EDGES);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1480" />
  <title>Kampung Kaki · Wireframe (CODE_EXP 2026)</title>
  <style>
    :root {
      --ink: #1a1a1a;
      --paper: #f4f4f1;
      --paper-2: #ebebe6;
      --paper-3: #ddddd6;
      --accent: #facc15;
      --critical: #dc2626;
      --info: #2563eb;
      --success: #22c55e;
    }
    * { box-sizing: border-box; }
    html { background: var(--paper); }
    body {
      margin: 0;
      padding: 40px 32px 64px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--ink);
      min-width: 1720px;
    }
    header.hero {
      border: 2.5px solid var(--ink);
      background: var(--paper);
      padding: 22px 24px;
      margin-bottom: 28px;
      box-shadow: 8px 8px 0 var(--ink);
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 24px;
      align-items: start;
    }
    header.hero h1 {
      margin: 0 0 6px;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    header.hero .tagline {
      margin: 0 0 12px;
      font-size: 13px;
      color: #444;
    }
    header.hero .meta {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
    }
    header.hero .meta span {
      border: 1.5px solid var(--ink);
      padding: 3px 8px;
      background: var(--paper-2);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 800;
    }
    .clusters {
      border: 1.5px solid var(--ink);
      background: var(--paper-2);
      padding: 10px 12px;
    }
    .clusters h3 {
      margin: 0 0 8px;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 900;
    }
    .cluster-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
    }
    .cluster-grid div {
      font-size: 11px;
      line-height: 1.4;
    }
    .cluster-grid strong {
      display: inline-block;
      background: var(--ink);
      color: var(--paper);
      padding: 1px 6px;
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-right: 6px;
    }
    .legend {
      border: 1.5px solid var(--ink);
      background: var(--paper);
      padding: 8px 12px;
      margin-top: 8px;
      font-size: 11px;
      display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    }
    .legend .swatch {
      display: inline-block; width: 14px; height: 8px; border: 1px solid var(--ink); vertical-align: middle;
    }

    .lane {
      margin-bottom: 32px;
      border: 2.5px solid var(--ink);
      background: var(--paper);
      box-shadow: 8px 8px 0 var(--ink);
    }
    .lane-head {
      padding: 14px 20px;
      border-bottom: 2px solid var(--ink);
      background: var(--paper-2);
      display: flex; flex-direction: column; gap: 6px;
    }
    .lane-head h2 { margin: 0; }
    .lane-pill {
      display: inline-block;
      padding: 5px 12px;
      background: var(--ink);
      color: var(--paper);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      box-shadow: 3px 3px 0 var(--accent);
    }
    .lane-head p { margin: 0; font-size: 12px; color: #444; max-width: 100ch; }

    .lane-canvas { padding: 24px 24px 28px; }
    .grid {
      display: flex;
      flex-wrap: wrap;
      gap: 40px 24px;
      position: relative;
      z-index: 2;
      align-items: stretch;
    }

    .screen {
      border: 2px solid var(--ink);
      background: var(--paper);
      box-shadow: 4px 4px 0 var(--ink);
      display: flex; flex-direction: column;
      position: relative;
      width: 360px;
      flex: 0 0 360px;
    }
    /* Short forward arrow between consecutive tiles in the same row. */
    .screen + .screen::before {
      content: '';
      position: absolute;
      left: -22px;
      top: 50%;
      width: 18px;
      height: 2px;
      background: var(--ink);
      transform: translateY(-50%);
      pointer-events: none;
    }
    .screen + .screen::after {
      content: '';
      position: absolute;
      left: -8px;
      top: 50%;
      width: 0; height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 9px solid var(--ink);
      transform: translateY(-50%);
      pointer-events: none;
    }
    .screen.wraps::before, .screen.wraps::after { display: none; }
    .screen header {
      padding: 6px 10px;
      border-bottom: 1.5px solid var(--ink);
      background: var(--paper-2);
      display: flex; align-items: center; gap: 8px;
    }
    .screen .num {
      background: var(--accent);
      border: 1.5px solid var(--ink);
      padding: 2px 6px;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      box-shadow: 2px 2px 0 var(--ink);
    }
    .screen h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .screen img {
      width: 100%; height: auto; max-height: 460px; object-fit: contain; object-position: top center;
      border-bottom: 1.5px solid var(--ink);
      display: block;
      background: var(--paper-2);
    }

    /* Wide tiles (e.g. the in-app horizontal band) take the full lane width so
       the captured strip renders at readable scale. */
    .screen.wide {
      width: 100%;
      flex-basis: 100%;
    }
    .screen.wide img {
      max-height: none;
      object-fit: fill;
    }
    .screen.wide .desc,
    .screen.wide .comments,
    .screen.wide .ai-credit {
      max-width: 80ch;
    }
    /* Wide tile sits on its own row inside the flex flow; no arrow before it
       and no arrow after the previous tile pointing at it. */
    .screen.wide::before,
    .screen.wide::after,
    .screen.wide + .screen::before,
    .screen.wide + .screen::after { display: none; }
    .placeholder {
      width: 100%; height: 180px;
      background: repeating-linear-gradient(45deg, transparent 0 8px, rgba(0,0,0,0.04) 8px 16px);
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #999;
      border-bottom: 1.5px solid var(--ink);
    }
    .screen .desc {
      margin: 0;
      padding: 8px 10px 6px;
      font-size: 11.5px;
      line-height: 1.45;
    }
    .screen .comments {
      margin: 0;
      padding: 0 10px 10px 24px;
      font-size: 10.5px;
      line-height: 1.45;
      color: #555;
    }
    .screen .comments li { margin-bottom: 2px; }

    .ai-tag {
      margin-left: auto;
      background: var(--ink);
      color: var(--accent);
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.14em;
      padding: 2px 6px;
      border: 1.5px solid var(--ink);
    }
    .ai-credit {
      margin: 8px 10px 10px;
      border: 1.5px dashed var(--ink);
      background: var(--paper-2);
      padding: 8px 10px;
      font-size: 10.5px;
      line-height: 1.4;
    }
    .ai-credit strong {
      display: block;
      font-size: 9.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 5px;
      color: var(--ink);
    }
    .ai-credit dl {
      margin: 0;
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 3px 8px;
    }
    .ai-credit dt {
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #666;
    }
    .ai-credit dd { margin: 0; font-size: 10.5px; }
    .ai-credit code {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      background: var(--paper);
      border: 1px solid var(--ink);
      padding: 0 4px;
    }
    .ai-credit .pill {
      display: inline-block;
      background: var(--paper);
      border: 1px solid var(--ink);
      padding: 1px 6px;
      font-size: 9.5px;
      margin: 1px 2px 1px 0;
    }

    .band {
      display: grid;
      grid-template-columns: 0.85fr 1.15fr;
      gap: 24px;
      margin-bottom: 32px;
    }
    .band-col {
      border: 2.5px solid var(--ink);
      background: var(--paper);
      box-shadow: 8px 8px 0 var(--ink);
      padding: 16px 20px;
    }
    .band-col header h2 {
      margin: 0 0 4px;
      font-size: 14px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 900;
    }
    .band-sub {
      display: inline-block;
      margin-left: 8px;
      font-size: 10px;
      letter-spacing: 0.08em;
      color: #555;
      text-transform: none;
      font-weight: 700;
    }
    .band-col header p { margin: 0 0 12px; font-size: 11.5px; color: #444; line-height: 1.5; }
    .band-col header p code {
      font-family: ui-monospace, monospace;
      font-size: 10.5px;
      background: var(--paper-2);
      border: 1px solid var(--ink);
      padding: 0 4px;
    }

    .prov { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .prov li {
      border: 1.5px solid var(--ink);
      background: var(--paper-2);
      padding: 6px 8px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 2px;
    }
    .prov-name {
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.04em;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .prov-meta {
      font-family: ui-monospace, monospace;
      font-size: 9.5px;
      font-weight: 700;
      color: #666;
      background: var(--paper);
      border: 1px solid var(--ink);
      padding: 1px 6px;
      letter-spacing: 0;
    }
    .prov-where { font-size: 10.5px; color: #444; line-height: 1.4; }

    .bot-grid { display: grid; gap: 10px; }
    .bot {
      border: 1.5px solid var(--ink);
      background: var(--paper-2);
      padding: 8px 10px;
      border-left: 5px solid var(--ink);
    }
    .bot strong {
      display: block;
      font-size: 12px;
      font-weight: 900;
      margin-bottom: 4px;
    }
    .bot .for {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      background: var(--accent);
      border: 1px solid var(--ink);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .bot p { margin: 2px 0; font-size: 11px; line-height: 1.45; }
    .bot .bot-meta { font-size: 10px; color: #555; }
    .bot .bot-meta code {
      font-family: ui-monospace, monospace;
      font-size: 9.5px;
      background: var(--paper);
      border: 1px solid var(--ink);
      padding: 0 4px;
      margin: 0 1px;
    }
    .bot-cz { border-left-color: #2563eb; }
    .bot-rp { border-left-color: #22c55e; }
    .bot-ops { border-left-color: #dc2626; }

    .lane-demo {
      border-style: dashed;
      box-shadow: 6px 6px 0 var(--accent), 6px 6px 0 1px var(--ink);
      background: repeating-linear-gradient(135deg, var(--paper) 0 18px, var(--paper-2) 18px 19px);
    }
    .lane-demo .lane-head {
      background: var(--accent);
      border-bottom-style: dashed;
    }
    .lane-demo .lane-pill {
      box-shadow: 3px 3px 0 #fff;
    }
    .lane-demo .lane-head::after {
      content: 'NOT PART OF PRODUCTION USER JOURNEY';
      display: inline-block;
      margin-left: 10px;
      padding: 2px 8px;
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: 0.14em;
      background: var(--ink);
      color: var(--paper);
      vertical-align: middle;
    }


    footer.matrix {
      border: 2.5px solid var(--ink);
      background: var(--paper);
      padding: 18px 20px;
      box-shadow: 8px 8px 0 var(--ink);
      margin-top: 32px;
    }
    footer.matrix h2 {
      margin: 0 0 10px;
      font-size: 14px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 900;
    }
    .matrix-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
    }
    .matrix-cell {
      border: 1.5px solid var(--ink);
      background: var(--paper-2);
      padding: 8px 10px;
      font-size: 11px;
    }
    .matrix-cell strong {
      display: block;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .matrix-cell code {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 10.5px;
      background: var(--paper);
      border: 1px solid var(--ink);
      padding: 1px 4px;
    }
    .tools {
      margin-top: 10px;
      font-size: 11px;
    }
    .tools code {
      font-family: ui-monospace, monospace;
      background: var(--paper-2);
      padding: 1px 6px;
      border: 1px solid var(--ink);
      margin-right: 4px;
      display: inline-block;
      margin-bottom: 3px;
    }
    .note {
      margin-top: 14px;
      font-size: 11px;
      color: #555;
      border-left: 3px solid var(--accent);
      padding-left: 10px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <header class="hero">
    <div>
      <h1>Kampung Kaki · Wireframe</h1>
      <p class="tagline">A live, role-aware map of Singapore for everyday people, trained responders, and operations staff. One map, three views, one shared truth.</p>
      <div class="meta">
        <span>CODE_EXP 2026</span>
        <span>Citizen · Responder · Ops</span>
        <span>Real OneMap SG basemap</span>
        <span>Live NEA / OneMap / LTA data</span>
      </div>
      <p style="font-size:12px;margin:0;line-height:1.55;">
        Citizens get a clean, trustworthy view of what is happening near them and a one-tap SOS.
        Trained responders see the same map with active calls, missions to join, and an AI copilot
        that ranks the best mission for them. Operations staff get the full picture — incoming reports,
        live distress calls, the responder roster, and tools to declare incidents and broadcast to the
        public. Everything published to a citizen has been verified; nothing on the map is invented.
      </p>
    </div>
    <div class="clusters">
      <h3>What each role sees</h3>
      <div class="cluster-grid">
        <div><strong>Citizen</strong>Verified alerts near them. Report or send SOS in seconds.</div>
        <div><strong>Responder</strong>Active SOS, ops-formed cases, joinable missions ranked by fit.</div>
        <div><strong>Ops</strong>Triage, dispatch, declare, broadcast — with full audit trail.</div>
        <div><strong>Shared truth</strong>One map; what one role does shows up for the others instantly.</div>
      </div>
    </div>
  </header>

  ${lanesHtml.join('\n')}

  <footer class="matrix">
    <h2>Design principles</h2>
    <div class="matrix-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="matrix-cell">
        <strong>One map, three views</strong>
        Citizens, responders, and operations all stand on the same OneMap SG basemap with the same live overlays. What changes is who can see what, not which app you opened.
      </div>
      <div class="matrix-cell">
        <strong>Verified by humans, broadcast by software</strong>
        Citizens cannot push noise to the public map. Reports go to ops; only after a human verifies do they appear as incidents. SOS bypasses verification — that is the contract.
      </div>
      <div class="matrix-cell">
        <strong>Honest about what is unknown</strong>
        Distances, ETAs, and air-quality numbers come from real measurements. When a data source is down, the UI says so plainly instead of filling the gap with plausible-looking numbers.
      </div>
    </div>
    <h2 style="margin-top:18px;">AI stack credits</h2>
    <div class="matrix-grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="matrix-cell">
        <strong>Provider · model</strong>
        OpenRouter, one serverless endpoint <code>/api/host/ask</code> serving every AI surface. Dev build runs <code>minimax/minimax-m2.5</code>; production switches to <code>openai/gpt-5.5</code> via <code>OPENROUTER_MODEL</code> (no code change).
      </div>
      <div class="matrix-cell">
        <strong>Five role × workspace prompts</strong>
        <code>citizen_alert</code> · <code>citizen_assistant</code> (AI Kaki) · <code>responder_case</code> (case-room slash bot) · <code>responder_mission</code> (Mission Copilot) · <code>ops_command</code> (Command Copilot). Each prompt is purpose-built and bounded.
      </div>
      <div class="matrix-cell">
        <strong>Server-prefetched live tools</strong>
        <code>getLivePsi</code> · <code>getLiveRainfall</code> · <code>getNearestAed</code> · <code>getNearestHospital</code>. Tools run before the model is called and their results are injected into the context — the model never invents PSI or AED locations.
      </div>
      <div class="matrix-cell">
        <strong>Deterministic fallback</strong>
        When OpenRouter is unreachable or returns an incomplete answer, the same endpoint replies in the same shape using only the tool results. The user sees consistent guidance whether or not the LLM is up.
      </div>
    </div>
  </footer>

  <!-- No arrow JS: tiles are laid out in order via flex-wrap;
       short → glyphs between consecutive tiles via CSS ::before. -->
  <script>
    // After layout, hide the → glyph on tiles that wrap to the start of a new
    // row, so we don't get a phantom arrow at the left edge.
    function hideWrapArrows() {
      document.querySelectorAll('.grid').forEach((grid) => {
        const screens = grid.querySelectorAll('.screen');
        let lastTop = null;
        screens.forEach((el) => {
          const top = el.offsetTop;
          el.classList.toggle('wraps', lastTop !== null && top !== lastTop);
          lastTop = top;
        });
      });
    }
    if (document.readyState === 'complete') hideWrapArrows();
    else window.addEventListener('load', hideWrapArrows);
    window.addEventListener('resize', hideWrapArrows);
  </script>
</body>
</html>
`;

  await writeFile(HTML_OUT, html);
  await writeFile(NOJEKYLL, '');
  console.log('Wrote', HTML_OUT);

  // Render to single PNG.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1.4 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(HTML_OUT).href, { waitUntil: 'load' });
  // Wait for fonts + images, then re-draw arrows so they catch the final layout.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const fn = window.dispatchEvent;
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: PNG_OUT, fullPage: true });
  await browser.close();
  console.log('Wrote', PNG_OUT);
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
