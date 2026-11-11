import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem audit log.');
  const db = await getDb();
  const logs = await db.query<{
    id: string;
    run_id: string | null;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  }>(
    `select id, run_id, actor, action, detail, created_at
     from audit_logs where user_id = $1 order by created_at desc limit 50`,
    [user.id],
  );
  return Response.json({ logs: logs.rows });
});
