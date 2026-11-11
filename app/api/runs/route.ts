import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { planRun, RUN_TYPES, STEP_ORDER } from '@/lib/engine';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';
import { runsWithSteps } from '@/lib/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  type: z.enum(RUN_TYPES),
  payload: z.record(z.string(), z.unknown()),
});

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem đề xuất.');
  return Response.json({ runs: await runsWithSteps(user.id) });
});

export const POST = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để tạo đề xuất.');
  const limit = await hitLimit(`create-run:${user.id}`, 10, 60);
  if (!limit.ok) return fail(429, 'rate_limited', 'Bạn tạo đề xuất quá nhanh. Thử lại sau.');

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(400, 'invalid_input', 'Loại thay đổi hoặc payload không hợp lệ.');

  const plan = planRun(parsed.data.type, parsed.data.payload);
  if (!plan.ok) return fail(422, 'invalid_change', plan.errors.join(' '));

  const db = await getDb();
  const runId = randomUUID();
  await db.query(
    `insert into runs (id, user_id, type, title, payload, diff, status, current_step, expires_at)
     values ($1,$2,$3,$4,$5::jsonb,$6,'queued','validate', now() + interval '24 hours')`,
    [runId, user.id, parsed.data.type, plan.title, JSON.stringify(plan.payload), plan.diff],
  );
  for (const step of STEP_ORDER) {
    await db.query(
      "insert into run_steps (id, run_id, step, status) values ($1,$2,$3,'pending')",
      [randomUUID(), runId, step],
    );
  }
  await db.query(
    'insert into audit_logs (id, run_id, user_id, actor, action, detail) values ($1,$2,$3,$4,$5,$6::jsonb)',
    [randomUUID(), runId, user.id, 'user', 'run_created', JSON.stringify({ type: parsed.data.type, risk: plan.risk })],
  );
  await saveState();
  return Response.json({ id: runId, risk: plan.risk, diff: plan.diff }, { status: 201 });
});
