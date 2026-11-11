import { destroySession } from '@/lib/auth';
import { saveState } from '@/lib/db';
import { route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async () => {
  await destroySession();
  await saveState();
  return Response.json({ ok: true });
});
