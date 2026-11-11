import Link from 'next/link';
import { getUser } from '@/lib/auth';

export default async function LandingPage() {
  const user = await getUser();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-10 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">HTK Agent Approval</p>
          <h1 className="mt-1 text-xl font-semibold">Human-in-the-loop cho thay đổi hạ tầng</h1>
        </div>
        <nav className="flex gap-3">
          {user ? (
            <Link className="btn-primary" href="/workspace">
              Mở workspace
            </Link>
          ) : (
            <>
              <Link className="btn-ghost" href="/login">
                Đăng nhập
              </Link>
              <Link className="btn-primary" href="/register">
                Tạo tài khoản
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mt-16 grid gap-10 lg:grid-cols-[1.1fr,0.9fr] lg:items-center">
        <div>
          <p className="badge">Agentic pattern · safety engineering</p>
          <h2 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl">
            Agent đề xuất.
            <br />
            Con người quyết định.
            <span className="text-accent"> Hệ thống không quên.</span>
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">
            Mỗi bước validate, simulate, apply, verify được ghi xuống DB. Agent dừng ở bước duyệt,
            sống sót qua restart, chạy lại không tạo hiệu ứng trùng lặp.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn-primary" href={user ? '/workspace' : '/login'}>
              Thử tài khoản demo
            </Link>
            <a className="btn-ghost" href="#flow">
              Xem state machine
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Demo: <code className="text-slate-200">demo@htk.dev</code> /{' '}
            <code className="text-slate-200">Demo12345!</code>
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-slate-200">State machine bền vững</p>
          <ol id="flow" className="mt-4 space-y-3 text-sm text-slate-300">
            <li className="flex gap-3"><span className="badge shrink-0">validate</span>Kiểm tra payload, allowlist config, giới hạn người nhận.</li>
            <li className="flex gap-3"><span className="badge shrink-0">simulate</span>Dry-run trong workspace DB, không gọi shell, không gửi email thật.</li>
            <li className="flex gap-3"><span className="badge shrink-0">await</span>Dừng chờ người duyệt, hiển thị diff; hết 24h thì expired.</li>
            <li className="flex gap-3"><span className="badge shrink-0">apply</span>Tool call idempotent theo run id, transaction với tool_calls.</li>
            <li className="flex gap-3"><span className="badge shrink-0">verify</span>Đọc lại trạng thái; fail thì retry tối đa 3 lần rồi dừng.</li>
          </ol>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          ['Resume sau restart', 'Mỗi bước là một row trong run_steps. Worker đọc current_step từ DB, không giữ tiến trình trong RAM.'],
          ['Không duplicate', 'Apply có idempotency key duy nhất; nếu đã chạy thì trả kết quả cũ với cờ skipped.'],
          ['Audit đầy đủ', 'Ai tạo, ai duyệt, worker chạy lúc nào, retry bao nhiêu lần — tất cả nằm trong audit_logs.'],
        ].map(([title, body]) => (
          <article key={title} className="card">
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-slate-300">{body}</p>
          </article>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-sm text-slate-500">
        HTK 0396241674 · Next.js + PostgreSQL (PGlite) + Vercel Blob · 2026
      </footer>
    </main>
  );
}
