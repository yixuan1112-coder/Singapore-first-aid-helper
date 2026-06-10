// POST /api/ai/ask — one endpoint for all three agents. Dispatches on body.agent
// (pelita | bekal | pondok). The model orchestrates cache-only skills via the
// local ollama daemon. Reply is markdown-normalised.
//   body: { agent, role, location:{lng,lat}|null, message, history[], context }
//   → { state, agent, reply, directives[], skillsUsed[] }

import { AGENTS } from './agents.mjs';
import { runAgent } from './agent.mjs';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ state: 'unavailable', reply: 'method not allowed', directives: [], skillsUsed: [] }));
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : await readJson(req);
  const agent = AGENTS[String(body?.agent ?? 'bekal')] ?? AGENTS.bekal;
  const loc = body?.location;
  const out = await runAgent(agent, {
    role: String(body?.role ?? 'citizen'),
    location: loc && Number.isFinite(loc.lng) && Number.isFinite(loc.lat) ? { lng: loc.lng, lat: loc.lat } : null,
    message: String(body?.message ?? ''),
    history: Array.isArray(body?.history) ? body.history.slice(-8) : [],
    context: body?.context && typeof body.context === 'object' ? body.context : {},
  });
  res.statusCode = 200;
  res.end(JSON.stringify(out));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 96_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
