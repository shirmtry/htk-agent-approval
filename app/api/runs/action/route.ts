import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';
import { decideRun, setPaused } from '@/lib/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  id: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'pause', 'resume']),
});

export const POST = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để phê duyệt.');
  const limit = await hitLimit(`run-action:${user.id}`, 30, 60);
  if (!limit.ok) return fail(429, 'rate_limited', 'Thao tác quá nhanh. Thử lại sau.');

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(400, 'invalid_input', 'Hành động không hợp lệ.');

  const db = await getDb();
  const { id, action } = parsed.data;
  const run =
    action === 'approve' || action === 'reject'
      ? await decideRun(db, user.id, id, action)
      : await setPaused(db, user.id, id, action === 'pause');

  if (!run) return fail(404, 'not_found', 'Không tìm thấy đề xuất.');
  await saveState();
  return Response.json({ run: { id: run.id, status: run.status, currentStep: run.current_step } });
});
