// cases-summary — a lossless-ish digest of the active SOS cases. Reads the
// client's live picture (context.sos). Cache-only.

export async function run(_inputs = {}, context = {}) {
  const sos = (Array.isArray(context?.sos) ? context.sos : []).filter((s) => !['resolved', 'cancelled'].includes(s.status));
  const list = sos.map((s) => ({
    category: s.category,
    status: s.status,
    responders: s.memberCount ?? 0,
    waitedMin: Math.max(0, Math.round((Date.now() - (s.startedAt || Date.now())) / 60000)),
  }));
  return {
    status: 'ok',
    summary: list.length
      ? list.map((c) => `${c.category} · ${c.responders} responding · ${c.waitedMin}m · ${c.status}`).join('; ')
      : 'No active cases.',
    metadata: { cases: list, active: list.length },
  };
}
