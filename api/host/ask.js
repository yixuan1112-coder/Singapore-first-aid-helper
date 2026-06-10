// Host AI endpoint.
// Dispatches on (role, workspace) → dedicated system prompt + per-workspace
// live tool prefetch (api/host/tools.js). Reply contract:
//   { state: 'live' | 'not_configured' | 'unavailable', text, chips }
// Honest absence beats invention — see ./systemPrompts.js.

import { systemPromptFor, WORKSPACE_TOOLS } from './systemPrompts.js';
import { runTools } from './tools.js';

const MAX_PROMPT_CHARS = 1600;
const MAX_CONTEXT_CHARS = 6400;

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const body = await readJson(req);
  const prompt = String(body?.prompt ?? '').slice(0, MAX_PROMPT_CHARS).trim();
  const role = String(body?.role ?? 'unknown');
  const workspace = String(body?.workspace ?? 'unknown');
  const clientContext = body?.context ?? {};

  if (!prompt) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'missing_prompt' }));
    return;
  }

  // Prefetch live tools for this workspace. Failures degrade per-tool to
  // {state:'unavailable'} so the LLM (or fallback) can be honest about gaps.
  const origin = pickOrigin(clientContext);
  const toolList = WORKSPACE_TOOLS[workspace] ?? [];
  const tools = await runTools(toolList, { origin });

  const enrichedContext = { ...clientContext, tools };
  const serialised = JSON.stringify(enrichedContext).slice(0, MAX_CONTEXT_CHARS);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        state: 'not_configured',
        text: fallbackText(role, workspace, prompt, tools, enrichedContext),
        chips: [
          { label: 'tool: openrouter', ref: 'not_configured' },
          ...toolChips(tools),
        ],
      }),
    );
    return;
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://quick-aid-sg.vercel.app',
        'x-title': 'Quick Aid SG',
      },
      body: JSON.stringify({
        model:
          process.env.OPENROUTER_MODEL ||
          process.env.OPENROUTER_MODEL_DEV ||
          'minimax/minimax-m2.5',
        messages: [
          { role: 'system', content: systemPromptFor(role, workspace) },
          { role: 'user', content: `context=${serialised}\n\nrequest=${prompt}` },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
    });

    if (!upstream.ok) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          state: 'unavailable',
          text: `Host AI unavailable from provider: HTTP ${upstream.status}. ${fallbackText(role, workspace, prompt, tools, enrichedContext)}`,
          chips: [{ label: 'tool: openrouter', ref: 'unavailable' }, ...toolChips(tools)],
        }),
      );
      return;
    }

    const data = await upstream.json();
    const rawText = data?.choices?.[0]?.message?.content?.trim();
    const text = normalizeHostText(rawText);
    const usable = text && text.length >= 40 && !looksLikeDump(text);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        state: 'live',
        text: usable ? text : fallbackText(role, workspace, prompt, tools, enrichedContext),
        chips: [
          { label: 'tool: openrouter', ref: 'live' },
          ...(usable ? [] : [{ label: 'tool: safety_fallback', ref: 'ai_output_incomplete' }]),
          ...toolChips(tools),
        ],
      }),
    );
  } catch (error) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        state: 'unavailable',
        text: `Host AI unavailable: ${error?.message ?? 'provider request failed'}. ${fallbackText(role, workspace, prompt, tools, enrichedContext)}`,
        chips: [{ label: 'tool: openrouter', ref: 'unavailable' }, ...toolChips(tools)],
      }),
    );
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 32_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function pickOrigin(ctx) {
  const loc =
    ctx?.userStatus?.location ??
    ctx?.selfLocation ??
    ctx?.case?.centroid ??
    ctx?.event?.location ??
    ctx?.currentAlert?.location ??
    null;
  if (!loc) return null;
  if (Number.isFinite(loc.lng) && Number.isFinite(loc.lat)) return { lng: loc.lng, lat: loc.lat };
  return null;
}

function toolChips(tools) {
  const out = [];
  for (const [name, value] of Object.entries(tools ?? {})) {
    out.push({ label: `tool: ${name}`, ref: value?.state ?? 'unavailable' });
  }
  return out;
}

function normalizeHostText(text) {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeDump(text) {
  const tableLines = text.split('\n').filter((line) => line.includes('|')).length;
  return tableLines >= 2 || text.includes('```');
}

// ──────────────────────────────────────────────────────────────────────
// Fallback: deterministic, honest text when OpenRouter is missing or
// returns an incomplete answer. Uses prefetched tools + client context.
// ──────────────────────────────────────────────────────────────────────
function fallbackText(role, workspace, prompt, tools, ctx) {
  const q = prompt.toLowerCase();
  const psiNat = tools?.psi?.psi24h?.national;
  const psiState = tools?.psi?.state;
  const nearestAed = tools?.nearestAed?.nearest?.[0];
  const nearestHospital = tools?.nearestHospital?.nearest?.[0];

  if (workspace === 'citizen_alert' || workspace === 'incident_guidance') {
    const alert = ctx?.currentAlert;
    return [
      'Situation',
      `- ${alert?.title ?? 'Current alert'} · ${alert?.distanceKm ? alert.distanceKm + ' km away' : 'distance unavailable'} · severity ${alert?.severity ?? 'unavailable'}.`,
      `- Live: ${alert?.liveValue ?? 'unavailable'}. Location basis: ${ctx?.userStatus?.location?.source ?? 'fallback'}.`,
      '',
      'Do now',
      `- ${actionForKind(alert?.kind).primary}`,
      `- ${actionForKind(alert?.kind).secondary}`,
      '',
      'If worse',
      `- ${actionForKind(alert?.kind).escalate}`,
      '- Call 995 for fire/ambulance, 999 for police threats.',
    ].join('\n');
  }

  if (workspace === 'citizen_assistant' || workspace === 'citizen_ai') {
    const lines = [];
    if (psiState === 'live') {
      lines.push(`PSI national: ${psiNat ?? 'unavailable'}.`);
    } else {
      lines.push('PSI: unavailable on this deployment.');
    }
    if (nearestAed) {
      lines.push(`Nearest AED: ${nearestAed.name} · ${nearestAed.distanceKm} km.`);
    } else {
      lines.push('Nearest AED: unavailable (OneMap not configured).');
    }
    if (nearestHospital) {
      lines.push(`Nearest A&E: ${nearestHospital.name} · ${nearestHospital.distanceKm} km.`);
    }
    lines.push('For immediate danger call 995 (fire/ambulance) or 999 (police).');
    return lines.join('\n');
  }

  if (workspace === 'responder_case' || workspace === 'case_lobby') {
    const caseRoom = ctx?.case;
    const responders = ctx?.responders ?? [];
    if (q.includes('status') && caseRoom) {
      const onScene = responders.filter((r) => r.status === 'on_scene').length;
      const enRoute = responders.filter((r) => r.status === 'en_route').length;
      return `${caseRoom.name} · ${caseRoom.state} · sev ${caseRoom.severity} · ${responders.length} members · ${onScene} on scene · ${enRoute} en route.`;
    }
    if (q.includes('aed')) {
      return nearestAed
        ? `Nearest AED: ${nearestAed.name} · ${nearestAed.distanceKm} km.`
        : 'Nearest AED: unavailable (OneMap not configured server-side).';
    }
    if (q.includes('hospital')) {
      return nearestHospital
        ? `Nearest A&E: ${nearestHospital.name} · ${nearestHospital.distanceKm} km.`
        : 'Hospital load: unavailable. No live MOH/hospital load source.';
    }
    if (q.includes('weather') || q.includes('psi')) {
      return psiState === 'live'
        ? `PSI national ${psiNat ?? 'unavailable'} (NEA live).`
        : 'NEA PSI: unavailable.';
    }
    if (q.includes('escalate')) {
      const openSos = (ctx?.sos ?? []).length;
      const sev = caseRoom?.severity ?? 0;
      const yes = sev >= 4 || openSos >= 3;
      return `${yes ? 'YES' : 'NO'}. Severity ${sev} · ${openSos} open SOS pings.`;
    }
    return 'Try: /host status · /host nearest aed · /host hospital load · /host weather · /host escalate? · /host help.';
  }

  if (workspace === 'responder_mission') {
    const joinable = ctx?.joinableSos ?? [];
    const cases = ctx?.joinableCases ?? [];
    const lines = [];
    if (joinable[0]) {
      lines.push(
        `Open SOS · ${joinable[0].id} · ${joinable[0].category} · ${joinable[0].distanceKm} km · fit ${joinable[0].fit}%.`,
      );
    }
    if (cases[0]) {
      lines.push(
        `${cases[0].restricted ? 'Monitor-only · ' : 'Case · '}${cases[0].name} · sev ${cases[0].severity} · ${cases[0].distanceKm} km.`,
      );
    }
    if (lines.length === 0) lines.push('No joinable missions within range.');
    return lines.join('\n');
  }

  if (workspace === 'ops_command') {
    const rq = ctx?.reportQueue?.length ?? 0;
    const sos = ctx?.activeSos?.length ?? 0;
    const cs = ctx?.cases?.length ?? 0;
    const lines = [
      `Queue · ${rq} reports · ${sos} active SOS · ${cs} cases.`,
      psiState === 'live'
        ? `PSI national ${psiNat ?? 'unavailable'}.`
        : 'PSI: unavailable on this deployment.',
    ];
    return lines.join('\n');
  }

  return 'Host AI fallback: workspace not configured. Try /host help.';
}

function actionForKind(kind) {
  if (kind === 'flood') {
    return {
      primary: 'Stay out of floodwater and avoid underpasses, drains, canals, and low roads.',
      secondary: 'Move to higher ground or remain indoors if your route crosses standing water.',
      escalate: 'If water is rising near you or someone is trapped, leave early if safe and request rescue.',
    };
  }
  if (kind === 'crash' || kind === 'traffic') {
    return {
      primary: 'Stay off live lanes and keep behind a barrier or inside a safe building.',
      secondary: 'Do not approach vehicles unless emergency services instruct you and it is safe.',
      escalate: 'If there are injuries, fire, fuel leaks, or blocked traffic creating danger, call 995.',
    };
  }
  if (kind === 'fire') {
    return {
      primary: 'Move away from smoke and heat; use stairs, not lifts, if evacuation is safe.',
      secondary: 'Close doors behind you and stay low if smoke is present.',
      escalate: 'If trapped, call 995, state your exact location, and signal from a window if possible.',
    };
  }
  if (kind === 'medical') {
    return {
      primary: 'Check responsiveness and breathing from a safe position.',
      secondary: 'Call 995 and follow dispatcher instructions; start CPR only if trained and safe.',
      escalate: 'Send someone for an AED if cardiac arrest is suspected.',
    };
  }
  if (kind === 'hazard') {
    return {
      primary: 'Move upwind and uphill from smoke, spills, fallen wires, or unstable debris.',
      secondary: 'Do not touch unknown substances, cables, or damaged structures.',
      escalate: 'If people are exposed, trapped, or the hazard is spreading, call 995.',
    };
  }
  return {
    primary: 'Increase distance from the alert area and observe from a safe place.',
    secondary: 'Follow official instructions and avoid entering restricted or unstable areas.',
    escalate: 'If there is immediate danger, injury, fire, or threat, contact emergency services.',
  };
}
