import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';
import { tickUser } from '@/lib/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để chạy worker.');
  const limit = await hitLimit(`worker:${user.id}`, 60, 60);
  if (!limit.ok) return fail(429, 'rate_limited', 'Worker chạy quá thường xuyên.');

  const db = await getDb();
  const processed = await tickUser(db, user.id, 5);
  await saveState();
  return Response.json({ processed });
});
