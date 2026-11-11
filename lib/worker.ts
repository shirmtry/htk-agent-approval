import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { MAX_ATTEMPTS, stepAfter, type StepName } from './engine';

export type RunRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  diff: string;
  status: string;
  current_step: string;
  attempts: number;
  last_error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

async function audit(
  db: PGlite,
  userId: string,
  runId: string | null,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await db.query(
    'insert into audit_logs (id, run_id, user_id, actor, action, detail) values ($1,$2,$3,$4,$5,$6::jsonb)',
    [randomUUID(), runId, userId, actor, action, JSON.stringify(detail)],
  );
}

async function ensureStep(db: PGlite, runId: string, step: StepName) {
  await db.query(
    `insert into run_steps (id, run_id, step, status, attempt) values ($1,$2,$3,'pending',0)
     on conflict (run_id, step) do nothing`,
    [randomUUID(), runId, step],
  );
  const result = await db.query<{ attempt: number; status: string }>(
    'select attempt, status from run_steps where run_id = $1 and step = $2',
    [runId, step],
  );
  return result.rows[0];
}

async function markStep(
  db: PGlite,
  runId: string,
  step: StepName,
  status: string,
  output: Record<string, unknown> | null,
) {
  await db.query(
    `update run_steps set status = $3, output = $4::jsonb,
       started_at = coalesce(started_at, now()), finished_at = case when $3 in ('done','failed','waiting') then now() else null end
     where run_id = $1 and step = $2`,
    [runId, step, status, output ? JSON.stringify(output) : null],
  );
}

async function idempotentApply(db: PGlite, run: RunRow): Promise<Record<string, unknown>> {
  const key = `apply:${run.id}`;
  const existing = await db.query<{ result: Record<string, unknown> }>(
    'select result from tool_calls where idempotency_key = $1',
    [key],
  );
  if (existing.rows.length) {
    return { ...existing.rows[0].result, skipped: true };
  }

  const payload = run.payload;
  let result: Record<string, unknown> = {};

  await db.exec('begin');
  try {
    if (run.type === 'dependency_bump') {
      const packageName = String(payload.packageName);
      const toVersion = String(payload.toVersion);
      const current = await db.query<{ value: string }>(
        "select value from sandbox_state where user_id = $1 and key = 'package.json'",
        [run.user_id],
      );
      const manifest = current.rows[0]?.value ? JSON.parse(current.rows[0].value) : {};
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [packageName]: toVersion };
      await db.query(
        `insert into sandbox_state (user_id, key, value, updated_at) values ($1,'package.json',$2,now())
         on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
        [run.user_id, JSON.stringify(manifest)],
      );
      result = { packageName, toVersion };
    } else if (run.type === 'config_change') {
      const configKey = String(payload.key);
      const value = String(payload.value);
      const current = await db.query<{ value: string }>(
        "select value from sandbox_state where user_id = $1 and key = 'config.json'",
        [run.user_id],
      );
      const config = current.rows[0]?.value ? JSON.parse(current.rows[0].value) : {};
      config[configKey] = value;
      await db.query(
        `insert into sandbox_state (user_id, key, value, updated_at) values ($1,'config.json',$2,now())
         on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
        [run.user_id, JSON.stringify(config)],
      );
      result = { key: configKey, value };
    } else {
      const recipients = (payload.recipients as string[]) ?? [];
      const subject = String(payload.subject);
      const body = String(payload.body);
      for (const recipient of recipients) {
        await db.query(
          'insert into outbox (id, run_id, recipient, subject, body) values ($1,$2,$3,$4,$5)',
          [randomUUID(), run.id, recipient, subject, body],
        );
      }
      result = { sent: recipients.length, sandbox: true };
    }

    await db.query(
      'insert into tool_calls (id, run_id, step, idempotency_key, result) values ($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), run.id, 'apply', key, JSON.stringify(result)],
    );
    await db.exec('commit');
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
  return result;
}

async function verifyApply(db: PGlite, run: RunRow): Promise<{ verified: boolean; detail: string }> {
  const payload = run.payload;
  if (run.type === 'dependency_bump') {
    const current = await db.query<{ value: string }>(
      "select value from sandbox_state where user_id = $1 and key = 'package.json'",
      [run.user_id],
    );
    const manifest = current.rows[0]?.value ? JSON.parse(current.rows[0].value) : {};
    const actual = manifest.dependencies?.[String(payload.packageName)];
    return {
      verified: actual === String(payload.toVersion),
      detail: `package.json ${String(payload.packageName)}=${String(actual)}`,
    };
  }
  if (run.type === 'config_change') {
    const current = await db.query<{ value: string }>(
      "select value from sandbox_state where user_id = $1 and key = 'config.json'",
      [run.user_id],
    );
    const config = current.rows[0]?.value ? JSON.parse(current.rows[0].value) : {};
    return {
      verified: config[String(payload.key)] === String(payload.value),
      detail: `config ${String(payload.key)}=${String(config[String(payload.key)])}`,
    };
  }
  const expected = (payload.recipients as string[])?.length ?? 0;
  const count = await db.query<{ count: number }>(
    'select count(*)::int as count from outbox where run_id = $1',
    [run.id],
  );
  const actual = Number(count.rows[0]?.count ?? 0);
  return { verified: actual === expected, detail: `outbox ${actual}/${expected}` };
}

async function advanceOnce(db: PGlite, run: RunRow) {
  if (run.status === 'queued') {
    await db.query("update runs set status = 'running', updated_at = now() where id = $1", [run.id]);
    await audit(db, run.user_id, run.id, 'worker', 'run_started', {});
    run.status = 'running';
  }

  const step = run.current_step as StepName | 'completed';
  if (step === 'completed') return;
  if (step === 'await_approval') {
    await ensureStep(db, run.id, 'await_approval');
    await markStep(db, run.id, 'await_approval', 'waiting', { diff: run.diff });
    await db.query(
      "update runs set status = 'awaiting_approval', updated_at = now() where id = $1",
      [run.id],
    );
    await audit(db, run.user_id, run.id, 'worker', 'approval_requested', { diff: run.diff });
    return;
  }

  const stepRow = await ensureStep(db, run.id, step);
  const attempt = Number(stepRow?.attempt ?? 0) + 1;
  await db.query(
    "update run_steps set status = 'running', attempt = $3, started_at = now(), finished_at = null where run_id = $1 and step = $2",
    [run.id, step, attempt],
  );
  await db.query(
    'update runs set status = $2, attempts = attempts + 1, last_error = null, updated_at = now() where id = $1',
    [run.id, run.status === 'paused' ? 'paused' : 'running'],
  );

  try {
    let output: Record<string, unknown> = {};
    if (step === 'validate') {
      output = { payloadKeys: Object.keys(run.payload), ok: true };
    } else if (step === 'simulate') {
      await new Promise((resolve) => setTimeout(resolve, 60));
      output = { sandbox: 'isolated-db-workspace', executedShell: false, diffLines: run.diff.split('\n').length };
    } else if (step === 'apply') {
      const approval = await db.query<{ status: string }>(
        "select status from run_steps where run_id = $1 and step = 'await_approval'",
        [run.id],
      );
      if (approval.rows[0]?.status !== 'done') {
        throw new Error('Chưa có phê duyệt của con người.');
      }
      output = await idempotentApply(db, run);
    } else if (step === 'verify') {
      const result = await verifyApply(db, run);
      if (!result.verified) throw new Error(`Verify thất bại: ${result.detail}`);
      output = result;
    }

    await markStep(db, run.id, step, 'done', output);
    const next = stepAfter(step);
    await db.query('update runs set current_step = $2, updated_at = now() where id = $1', [run.id, next]);
    if (next === 'completed') {
      await db.query("update runs set status = 'completed', updated_at = now() where id = $1", [run.id]);
      await audit(db, run.user_id, run.id, 'worker', 'run_completed', output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt >= MAX_ATTEMPTS) {
      await markStep(db, run.id, step, 'failed', { error: message, attempt });
      await db.query(
        "update runs set status = 'failed', last_error = $2, updated_at = now() where id = $1",
        [run.id, message],
      );
      await audit(db, run.user_id, run.id, 'worker', 'run_failed', { message, attempt });
    } else {
      await markStep(db, run.id, step, 'pending', { error: message, attempt });
      await db.query('update runs set last_error = $2, updated_at = now() where id = $1', [run.id, message]);
      await audit(db, run.user_id, run.id, 'worker', 'step_retry', { step, attempt, message });
    }
  }
}

export async function tickUser(db: PGlite, userId: string, limit = 5): Promise<number> {
  const runs = await db.query<RunRow>(
    `select * from runs
     where user_id = $1 and status in ('queued','running','approved') and expires_at > now()
     order by created_at asc limit $2`,
    [userId, limit],
  );
  for (const initial of runs.rows) {
    for (let i = 0; i < 6; i++) {
      const current = await db.query<RunRow>('select * from runs where id = $1', [initial.id]);
      const run = current.rows[0];
      if (!run) break;
      if (['awaiting_approval', 'paused', 'completed', 'rejected', 'failed', 'expired'].includes(run.status)) {
        break;
      }
      const before = `${run.status}:${run.current_step}`;
      await advanceOnce(db, run);
      const after = await db.query<RunRow>('select * from runs where id = $1', [initial.id]);
      const updated = after.rows[0];
      if (!updated || `${updated.status}:${updated.current_step}` === before) break;
    }
  }

  const expired = await db.query<{ id: string }>(
    `update runs set status = 'expired', updated_at = now()
     where user_id = $1 and status in ('queued','running','awaiting_approval','approved','paused')
       and expires_at <= now() returning id`,
    [userId],
  );
  for (const row of expired.rows) {
    await audit(db, userId, row.id, 'worker', 'run_expired', {});
  }
  return runs.rows.length + expired.rows.length;
}

export async function decideRun(
  db: PGlite,
  userId: string,
  runId: string,
  decision: 'approve' | 'reject',
): Promise<RunRow | null> {
  const result = await db.query<RunRow>(
    'select * from runs where id = $1 and user_id = $2',
    [runId, userId],
  );
  const run = result.rows[0];
  if (!run) return null;
  if (run.status !== 'awaiting_approval') return run;
  if (new Date(run.expires_at).getTime() < Date.now()) {
    await db.query("update runs set status = 'expired', updated_at = now() where id = $1", [run.id]);
    await audit(db, userId, run.id, 'user', 'run_expired', {});
    return { ...run, status: 'expired' };
  }

  if (decision === 'approve') {
    await db.query(
      "update runs set status = 'approved', current_step = 'apply', updated_at = now() where id = $1",
      [run.id],
    );
    await db.query(
      "update run_steps set status = 'done', finished_at = now() where run_id = $1 and step = 'await_approval'",
      [run.id],
    );
    await audit(db, userId, run.id, 'user', 'approved', {});
    return { ...run, status: 'approved', current_step: 'apply' };
  }

  await db.query("update runs set status = 'rejected', updated_at = now() where id = $1", [run.id]);
  await db.query(
    "update run_steps set status = 'done', output = $2::jsonb, finished_at = now() where run_id = $1 and step = 'await_approval'",
    [run.id, JSON.stringify({ rejected: true })],
  );
  await audit(db, userId, run.id, 'user', 'rejected', {});
  return { ...run, status: 'rejected' };
}

export async function setPaused(
  db: PGlite,
  userId: string,
  runId: string,
  paused: boolean,
): Promise<RunRow | null> {
  const result = await db.query<RunRow>('select * from runs where id = $1 and user_id = $2', [
    runId,
    userId,
  ]);
  const run = result.rows[0];
  if (!run) return null;
  if (paused && ['queued', 'running', 'approved'].includes(run.status)) {
    await db.query("update runs set status = 'paused', updated_at = now() where id = $1", [run.id]);
    await audit(db, userId, run.id, 'user', 'paused', {});
    return { ...run, status: 'paused' };
  }
  if (!paused && run.status === 'paused') {
    await db.query("update runs set status = 'running', updated_at = now() where id = $1", [run.id]);
    await audit(db, userId, run.id, 'user', 'resumed', { currentStep: run.current_step });
    return { ...run, status: 'running' };
  }
  return run;
}
