// responders-roster — who is on duty right now, with status + declared skills.
// Reads the client's live operating picture (context.responders). Cache-only.

export async function run(_inputs = {}, context = {}) {
  const responders = Array.isArray(context?.responders) ? context.responders : [];
  const onDuty = responders.filter((r) => r.onDuty && r.status !== 'offline');
  const list = onDuty.map((r) => ({
    name: r.name || 'Responder',
    status: r.status,
    skills: Array.isArray(r.proficiencies) ? r.proficiencies : [],
  }));
  return {
    status: 'ok',
    summary: `${onDuty.length}/${responders.length} on duty`
      + (list.length ? `: ${list.map((r) => `${r.name} [${r.skills.join('/') || 'no skills'}] ${r.status}`).join('; ')}` : '.'),
    metadata: { onDuty: list, total: responders.length, available: onDuty.length },
  };
}
