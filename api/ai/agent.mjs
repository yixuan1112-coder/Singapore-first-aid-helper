// The generic agent loop — the mothership shared by all three KampungKaki agents
// (Pelita, Bekal, Pondok). An agent is just a CONFIG: a name, the skills it may
// call, and a narrative system prompt (the "box"). This file owns the LLM
// tool-calling loop; agents own who they are.
//
// LLM = minimax-m2.5 on Ollama Cloud via the local daemon (localhost:11434/api/chat,
// the :cloud tag routes to ollama.com). No OpenRouter fee. Skills run cache-only.

import { toolSpecsFor, runSkill } from './registry.mjs';
import { demoBekalReply } from './demo-bekal.mjs';

const OLLAMA_URL = (process.env.OLLAMA_BASE_URL?.replace(/\/v1\/?$/, '') ?? 'http://localhost:11434') + '/api/chat';
const MODEL = process.env.KK_AI_MODEL ?? 'minimax-m2.5:cloud';
const MAX_ROUNDS = 4;

async function ollamaChat(messages, tools, attempt = 0) {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: false, messages, tools, options: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).message;
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (attempt < 1 && msg.includes('timeout')) {
      return ollamaChat(messages, tools, attempt + 1);
    }
    throw err;
  }
}

/**
 * Run one turn of any agent.
 * @param {{id:string,name:string,allowedSkills:string[]|'*',systemPrompt:(role:string,location:any,context:any)=>string}} agent
 * @param {{role?:string, location?:any, message:string, history?:{role:string,content:string}[], context?:any}} turn
 * @returns {Promise<{state:'live'|'unavailable', agent:string, reply:string, directives:object[], skillsUsed:string[]}>}
 */
export async function runAgent(agent, { role = 'citizen', location = null, message, history = [], context = {} } = {}) {
  if (!message || !String(message).trim()) {
    return { state: 'unavailable', agent: agent.id, reply: 'Ask me something.', directives: [], skillsUsed: [] };
  }
  if (agent.id === 'bekal') {
    const demo = demoBekalReply(message);
    if (demo) return demo;
  }
  const quick = quickReply(agent.id, message);
  if (quick) {
    return { state: 'live', agent: agent.id, reply: quick, directives: [], skillsUsed: [] };
  }
  // Skills read the live picture; make sure location is in the context.
  const ctx = { ...context, location: location ?? context.location ?? null };

  const specs = await toolSpecsFor(agent.allowedSkills);
  const tools = specs.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: s.input_schema } }));

  const messages = [
    { role: 'system', content: agent.systemPrompt(role, ctx.location, ctx) },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: String(message).slice(0, 1200) },
  ];

  const directives = [];
  const skillsUsed = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const msg = await ollamaChat(messages, tools);
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return { state: 'live', agent: agent.id, reply: normalizeReply(msg.content), directives, skillsUsed };
      }
      for (const call of calls) {
        const name = call.function?.name;
        const args = typeof call.function?.arguments === 'string' ? safeParse(call.function.arguments) : (call.function?.arguments ?? {});
        const result = await runSkill(name, args, ctx);
        skillsUsed.push(name);
        if (result?.status === 'ok' && Array.isArray(result.metadata?.marks)) directives.push(...result.metadata.marks);
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result).slice(0, 4000) });
      }
    }
    const finalMsg = await ollamaChat([...messages, { role: 'user', content: 'Answer now from what the skills returned. No more tool calls.' }], []);
    return { state: 'live', agent: agent.id, reply: normalizeReply(finalMsg.content), directives, skillsUsed };
  } catch (err) {
    return { state: 'unavailable', agent: agent.id, reply: `${agent.name} is unavailable right now (${String(err?.message ?? err).slice(0, 120)}).`, directives, skillsUsed };
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

function quickReply(agentId, message) {
  const text = String(message).trim().toLowerCase();
  const asksRole = /\b(hi|hello|hey|what do you offer|what can you do|how can you help|who are you)\b/.test(text);
  if (!asksRole || text.length > 120) return null;
  if (agentId === 'pelita') return 'I read the live neighbourhood picture: rain, PSI, temperature, wind, dengue, traffic, and what looks good or risky nearby.';
  if (agentId === 'bekal') return 'I help inside an SOS: nearest AEDs and hospitals, safety guidance, and map pins for what matters.';
  if (agentId === 'pondok') return 'I help ops see the whole picture: responders on duty, active SOS cases, open reports, and factual fit suggestions.';
  return null;
}

// minimax answers in markdown; the app chat is plain text. Strip the markup,
// keep structure (bullets → "• ").
export function normalizeReply(text) {
  if (!text) return 'unavailable';
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_row, cells) => {
      const parts = String(cells).split('|').map((cell) => cell.trim()).filter(Boolean);
      return parts.length ? `• ${parts.join(': ')}` : '';
    })
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*[-—]{3,}\s*$/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || 'unavailable';
}
