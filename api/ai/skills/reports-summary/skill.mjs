// reports-summary — open civilian reports digest. Reads the client's live
// picture (context.reports). Cache-only.

export async function run(_inputs = {}, context = {}) {
  const reports = (Array.isArray(context?.reports) ? context.reports : []).filter((r) => !['resolved', 'dismissed'].includes(r.status));
  const list = reports.map((r) => ({ kind: r.kind, title: r.title, status: r.status }));
  return {
    status: 'ok',
    summary: list.length
      ? `${list.length} open report(s): ${list.map((r) => `${r.kind} "${r.title}" (${r.status})`).join('; ')}`
      : 'No open reports.',
    metadata: { reports: list, open: list.length },
  };
}
