import { getDb } from './db';

export async function runsWithSteps(userId: string) {
  const db = await getDb();
  const runs = await db.query<Record<string, unknown>>(
    `select id, type, title, payload, diff, status, current_step, attempts, last_error,
            expires_at, created_at, updated_at
     from runs where user_id = $1 order by created_at desc limit 30`,
    [userId],
  );
  const steps = await db.query<Record<string, unknown>>(
    `select s.run_id, s.step, s.status, s.attempt, s.output, s.started_at, s.finished_at
     from run_steps s join runs r on r.id = s.run_id
     where r.user_id = $1 order by s.started_at nulls last limit 400`,
    [userId],
  );
  const byRun = new Map<string, Record<string, unknown>[]>();
  for (const step of steps.rows) {
    const key = String(step.run_id);
    byRun.set(key, [...(byRun.get(key) ?? []), step]);
  }
  return runs.rows.map((run) => ({
    id: run.id,
    type: run.type,
    title: run.title,
    payload: run.payload,
    diff: run.diff,
    status: run.status,
    currentStep: run.current_step,
    attempts: Number(run.attempts),
    lastError: run.last_error,
    expiresAt: run.expires_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    steps: byRun.get(String(run.id)) ?? [],
  }));
}
