// Prerecorded Bekal answer for the live + quick demos. When the presenter asks
// the exact scripted SOS question, skip the LLM round-trip and return the same
// reply text + map directives every time (smooth, sellable pacing).

const DEMO_PROMPTS = new Set([
  normalize(
    'Elderly man collapsed after e-bike smoke at Nicoll Highway MRT Exit B. I am the witness; he is the casualty. Which AED and A&E hospital should bystanders use, and what should I do while Aisha is coming?',
  ),
]);

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Bundled-data nearest picks for Nicoll Highway MRT Exit B (~103.8644, 1.3022). */
const DIRECTIVES = [
  { kind: 'aed', label: 'Golden Mile Food Centre', lng: 103.86391, lat: 1.30287, km: 0.09, best: true },
  { kind: 'aed', label: 'St John Headquarter', lng: 103.86315, lat: 1.30173, km: 0.15, best: false },
  { kind: 'hospital', label: 'Raffles Hospital', lng: 103.858, lat: 1.301, km: 0.72, best: true },
  { kind: 'hospital', label: 'Farrer Park Hospital', lng: 103.854, lat: 1.312, km: 1.59, best: false },
];

const REPLY = `For bystanders at Nicoll Highway MRT Exit B:

• Nearest AED: Golden Mile Food Centre (about 0.1 km) — open 24/7
• A&E hospital: Raffles Hospital (about 0.7 km)

While Aisha is on the way:
• Call 995 now and stay on the line
• Check breathing; start CPR if he is not breathing normally
• Send someone safe to fetch the AED — follow the marked pin on your map
• Keep the area clear of smoke; do not move him unless the spot is unsafe

I have dropped the nearest AED and hospital on your map.`;

export function matchesDemoBekalPrompt(message) {
  const n = normalize(message);
  if (DEMO_PROMPTS.has(n)) return true;
  return n.includes('nicoll highway mrt exit b')
    && (n.includes('aed') || n.includes('a&e'))
    && n.includes('collapsed');
}

/** @returns {{state:'live', agent:'bekal', reply:string, directives:object[], skillsUsed:string[]}|null} */
export function demoBekalReply(message) {
  if (!matchesDemoBekalPrompt(message)) return null;
  return {
    state: 'live',
    agent: 'bekal',
    reply: REPLY,
    directives: DIRECTIVES,
    skillsUsed: ['aed-nearest', 'hospitals-nearest'],
  };
}
