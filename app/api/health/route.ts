import { getUser } from '@/lib/auth';
import { getDb, usingBlob } from '@/lib/db';
import { route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  try {
    const db = await getDb();
    await db.query('select 1');
    return Response.json({
      ok: true,
      db: 'ok',
      persistence: usingBlob() ? 'vercel-blob' : 'local-file',
      auth: (await getUser()) ? 'session' : 'anonymous',
      ts: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, db: 'error', message: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
});
