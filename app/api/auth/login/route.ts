import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { clientIp, fail, route } from '@/lib/http';
import { verifyPassword } from '@/lib/password';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().toLowerCase().max(120),
  password: z.string().min(1).max(100),
});

export const POST = route(async (req) => {
  const ip = clientIp(req);
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'invalid_input', 'Email hoặc mật khẩu không hợp lệ.');
  }
  const { email, password } = parsed.data;

  const limit = await hitLimit(`login:${ip}:${email}`, 10, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều lần đăng nhập. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const db = await getDb();
  const result = await db.query<{ id: string; email: string; name: string; password_hash: string }>(
    'select id, email, name, password_hash from users where email = $1',
    [email],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail(401, 'invalid_credentials', 'Email hoặc mật khẩu không đúng.');
  }

  await createSession(user.id);
  await saveState();
  return Response.json({ user: { id: user.id, email: user.email, name: user.name } });
});
