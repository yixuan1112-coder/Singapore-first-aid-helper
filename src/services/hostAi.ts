export interface HostAiChip {
  label: string;
  ref: string;
}

export interface HostAiResponse {
  state: 'live' | 'not_configured' | 'unavailable';
  text: string;
  chips?: HostAiChip[];
}

export interface HostAiRequest {
  role: string;
  workspace: string;
  prompt: string;
  context?: unknown;
}

export async function askHostAi(request: HostAiRequest): Promise<HostAiResponse> {
  const response = await fetch('/api/host/ask', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    return {
      state: 'unavailable',
      text: `Host AI unavailable: backend returned HTTP ${response.status}.`,
      chips: [{ label: 'tool: host_ai', ref: 'unavailable' }],
    };
  }

  return response.json();
}
