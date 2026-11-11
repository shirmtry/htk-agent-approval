import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { clientIp, fail, route } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(2, 'Tên cần ít nhất 2 ký tự').max(60),
  email: z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Email không hợp lệ').max(120),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự').max(100),
});

export const POST = route(async (req) => {
  const limit = await hitLimit(`register:${clientIp(req)}`, 5, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều lần đăng ký. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }

  const { name, email, password } = parsed.data;
  const db = await getDb();
  const existing = await db.query('select id from users where email = $1', [email]);
  if (existing.rows.length) {
    return fail(409, 'email_taken', 'Email này đã được đăng ký.');
  }

  const id = randomUUID();
  await db.query('insert into users (id, email, name, password_hash) values ($1,$2,$3,$4)', [
    id,
    email,
    name,
    await hashPassword(password),
  ]);
  await createSession(id);
  await saveState();

  return Response.json({ user: { id, email, name } }, { status: 201 });
});
