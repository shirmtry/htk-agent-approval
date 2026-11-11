import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function percentile(values: number[], p: number): number | null {
  if (values.length < 5) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(1));
}

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem metrics.');
  const db = await getDb();

  const [statusRows, requestRows, retryRows, approvalRows] = await Promise.all([
    db.query<{ status: string; count: number }>(
      'select status, count(*)::int as count from runs where user_id = $1 group by status',
      [user.id],
    ),
    db.query<{ duration_ms: number }>(
      'select duration_ms from request_logs order by created_at desc limit 300',
    ),
    db.query<{ count: number }>(
      "select count(*)::int as count from audit_logs where user_id = $1 and action = 'step_retry'",
      [user.id],
    ),
    db.query<{ latency_ms: number }>(
      `select extract(epoch from (a.created_at - b.created_at)) * 1000 as latency_ms
       from audit_logs a
       join audit_logs b on b.run_id = a.run_id and b.action = 'approval_requested'
       where a.user_id = $1 and a.action = 'approved'`,
      [user.id],
    ),
  ]);

  const statuses: Record<string, number> = {};
  for (const row of statusRows.rows) statuses[row.status] = Number(row.count);
  const latencies = approvalRows.rows.map((r) => Number(r.latency_ms)).filter(Number.isFinite);

  return Response.json({
    runs: {
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
      byStatus: statuses,
    },
    retries: Number(retryRows.rows[0]?.count ?? 0),
    approvalLatencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      samples: latencies.length,
    },
    requestLatencyMs: {
      p50: percentile(requestRows.rows.map((r) => Number(r.duration_ms)), 50),
      p95: percentile(requestRows.rows.map((r) => Number(r.duration_ms)), 95),
      samples: requestRows.rows.length,
    },
  });
});
