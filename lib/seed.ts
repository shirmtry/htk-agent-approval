import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { hashPassword } from './password';

export const DEMO_EMAIL = 'demo@htk.dev';
export const DEMO_PASSWORD = 'Demo12345!';

export async function seedDemo(db: PGlite) {
  const existing = await db.query<{ count: number }>('select count(*)::int as count from users');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;
  await db.query('insert into users (id, email, name, password_hash) values ($1,$2,$3,$4)', [
    randomUUID(),
    DEMO_EMAIL,
    'Agent Reviewer',
    await hashPassword(DEMO_PASSWORD),
  ]);
}
