// Client for the KampungKaki agents (POST /api/ai/ask). One endpoint, the agent
// id selects the box (pelita | bekal | pondok).

export interface AgentMark { kind: string; label: string; lng: number; lat: number; km?: number; best?: boolean }

export interface AgentReply {
  state: 'live' | 'unavailable';
  agent: string;
  reply: string;
  directives: AgentMark[];
  skillsUsed: string[];
}

export interface AgentTurn {
  agent: 'pelita' | 'bekal' | 'pondok';
  role: string;
  location: { lng: number; lat: number } | null;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  context?: Record<string, unknown>;
}

export async function askAgent(turn: AgentTurn): Promise<AgentReply> {
  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(turn),
    });
    if (!res.ok) return { state: 'unavailable', agent: turn.agent, reply: `Agent unavailable (HTTP ${res.status}).`, directives: [], skillsUsed: [] };
    return (await res.json()) as AgentReply;
  } catch (e) {
    return { state: 'unavailable', agent: turn.agent, reply: `Agent unreachable (${e instanceof Error ? e.message : 'network'}).`, directives: [], skillsUsed: [] };
  }
}
