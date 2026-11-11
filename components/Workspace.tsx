'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type User = { id: string; email: string; name: string };
type Step = {
  step: string;
  status: string;
  attempt: number;
  output: Record<string, unknown> | null;
  started_at: string | null;
};
type Run = {
  id: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  diff: string;
  status: string;
  currentStep: string;
  attempts: number;
  lastError: string | null;
  expiresAt: string;
  createdAt: string;
  steps: Step[];
};
type Audit = { id: string; run_id: string | null; actor: string; action: string; detail: Record<string, unknown>; created_at: string };
type Metrics = {
  runs: { total: number; byStatus: Record<string, number> };
  retries: number;
  approvalLatencyMs: { p50: number | null; p95: number | null; samples: number };
  requestLatencyMs: { p50: number | null; p95: number | null; samples: number };
};

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  return data as T;
}

const STATUS_STYLE: Record<string, string> = {
  queued: 'border-slate-500/40 text-slate-300',
  running: 'border-sky-400/50 text-sky-200',
  awaiting_approval: 'border-amber-400/50 text-amber-200',
  approved: 'border-cyan-400/50 text-cyan-200',
  paused: 'border-violet-400/50 text-violet-200',
  completed: 'border-emerald-400/50 text-emerald-200',
  rejected: 'border-rose-400/50 text-rose-200',
  failed: 'border-rose-500/60 text-rose-200',
  expired: 'border-orange-400/50 text-orange-200',
};

export function Workspace({ user }: { user: User }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [type, setType] = useState('dependency_bump');
  const [packageName, setPackageName] = useState('next');
  const [fromVersion, setFromVersion] = useState('15.5.0');
  const [toVersion, setToVersion] = useState('16.0.0');
  const [subject, setSubject] = useState('Thông báo bảo trì');
  const [body, setBody] = useState('Hệ thống sẽ bảo trì vào 22:00 và trở lại sau 30 phút.');
  const [recipients, setRecipients] = useState('ops@example.com, cto@example.com');
  const [configKey, setConfigKey] = useState('checkout_enabled');
  const [configValue, setConfigValue] = useState('false');
  const [createError, setCreateError] = useState<string | null>(null);

  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsError(null);
    try {
      const data = await jsonFetch<{ runs: Run[] }>('/api/runs');
      setRuns(data.runs);
      setSelected((current) => current ?? data.runs[0]?.id ?? null);
    } catch (error) {
      if (error instanceof Error && error.message.includes('đăng nhập')) {
        router.push('/login');
        return;
      }
      setRunsError(error instanceof Error ? error.message : 'Không tải được đề xuất.');
    }
  }, [router]);

  const loadSide = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        jsonFetch<{ logs: Audit[] }>('/api/audit'),
        jsonFetch<Metrics>('/api/metrics'),
      ]);
      setAudit(a.logs);
      setMetrics(m);
    } catch {
      // Non-blocking: the run list still works if side panels fail.
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    void loadSide();
  }, [loadRuns, loadSide]);

  async function tick() {
    setBusy('tick');
    setNotice(null);
    try {
      const result = await jsonFetch<{ processed: number }>('/api/worker/tick', { method: 'POST' });
      setNotice(`Worker xử lý ${result.processed} run.`);
      await loadRuns();
      await loadSide();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Worker lỗi.');
    } finally {
      setBusy(null);
    }
  }

  async function createRun(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setBusy('create');
    let payload: Record<string, unknown>;
    if (type === 'dependency_bump') payload = { packageName, fromVersion, toVersion };
    else if (type === 'bulk_email')
      payload = { subject, body, recipients: recipients.split(',').map((r) => r.trim()) };
    else payload = { key: configKey, value: configValue };

    try {
      const created = await jsonFetch<{ id: string }>('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      });
      setSelected(created.id);
      await loadRuns();
      await jsonFetch('/api/worker/tick', { method: 'POST' });
      await loadRuns();
      await loadSide();
      setNotice('Đề xuất đã dừng ở bước chờ duyệt.');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Không tạo được đề xuất.');
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'pause' | 'resume') {
    setBusy(action + id);
    setNotice(null);
    try {
      await jsonFetch('/api/runs/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (action === 'approve' || action === 'resume') {
        await jsonFetch('/api/worker/tick', { method: 'POST' });
      }
      await loadRuns();
      await loadSide();
      setNotice(
        action === 'approve'
          ? 'Đã duyệt, worker chạy apply + verify.'
          : action === 'reject'
            ? 'Đã từ chối, không có thay đổi nào được áp dụng.'
            : action === 'pause'
              ? 'Đã tạm dừng. Bấm Resume để worker tiếp tục từ bước đã lưu.'
              : 'Đã resume từ bước đã lưu.',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Hành động thất bại.');
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const run = runs?.find((r) => r.id === selected) ?? null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">HTK Agent Approval</p>
          <h1 className="mt-1 text-xl font-semibold">Xin chào, {user.name}</h1>
          <p className="text-sm text-slate-400">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" type="button" onClick={() => void tick()} disabled={busy === 'tick'}>
            {busy === 'tick' ? 'Worker đang chạy…' : 'Chạy worker'}
          </button>
          <button className="btn-ghost" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <div aria-live="polite" role="status" className="mt-3">
        {notice && (
          <p className="rounded-xl border border-line bg-panel/70 px-3 py-2 text-sm text-slate-200">{notice}</p>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[390px,1fr]">
        <div className="space-y-5">
          <section className="card" aria-labelledby="create-heading">
            <h2 id="create-heading" className="text-base font-semibold">Tạo đề xuất</h2>
            <p className="mt-1 text-sm text-slate-400">Agent sẽ dừng trước khi áp dụng bất kỳ thay đổi nào.</p>
            <form className="mt-4 space-y-3" onSubmit={createRun}>
              <div>
                <label className="label" htmlFor="run-type">Loại thay đổi</label>
                <select id="run-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="dependency_bump">Dependency bump</option>
                  <option value="bulk_email">Bulk email</option>
                  <option value="config_change">Config change</option>
                </select>
              </div>

              {type === 'dependency_bump' && (
                <>
                  <div>
                    <label className="label" htmlFor="pkg">Package</label>
                    <input id="pkg" className="input" value={packageName} onChange={(e) => setPackageName(e.target.value)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label" htmlFor="from">Từ version</label>
                      <input id="from" className="input" value={fromVersion} onChange={(e) => setFromVersion(e.target.value)} required />
                    </div>
                    <div>
                      <label className="label" htmlFor="to">Đến version</label>
                      <input id="to" className="input" value={toVersion} onChange={(e) => setToVersion(e.target.value)} required />
                    </div>
                  </div>
                </>
              )}

              {type === 'bulk_email' && (
                <>
                  <div>
                    <label className="label" htmlFor="subject">Tiêu đề</label>
                    <input id="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="body">Nội dung</label>
                    <textarea id="body" className="input min-h-[90px]" value={body} onChange={(e) => setBody(e.target.value)} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="recipients">Người nhận (1–5, cách nhau dấu phẩy)</label>
                    <input id="recipients" className="input" value={recipients} onChange={(e) => setRecipients(e.target.value)} required />
                  </div>
                </>
              )}

              {type === 'config_change' && (
                <>
                  <div>
                    <label className="label" htmlFor="config-key">Config key (allowlist)</label>
                    <select id="config-key" className="input" value={configKey} onChange={(e) => setConfigKey(e.target.value)}>
                      <option value="checkout_enabled">checkout_enabled</option>
                      <option value="email_digest">email_digest</option>
                      <option value="maintenance_mode">maintenance_mode</option>
                      <option value="rate_limit_per_min">rate_limit_per_min</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="config-value">Giá trị mới</label>
                    <input id="config-value" className="input" value={configValue} onChange={(e) => setConfigValue(e.target.value)} required />
                  </div>
                </>
              )}

              <div aria-live="polite">
                {createError && (
                  <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{createError}</p>
                )}
              </div>
              <button className="btn-primary w-full" type="submit" disabled={busy === 'create'}>
                {busy === 'create' ? 'Đang chạy agent…' : 'Tạo và chạy đến bước duyệt'}
              </button>
            </form>
          </section>

          <section className="card" aria-labelledby="runs-heading">
            <h2 id="runs-heading" className="text-base font-semibold">Đề xuất ({runs?.length ?? 0})</h2>
            {runs === null && !runsError && <p className="mt-3 text-sm text-slate-400">Đang tải…</p>}
            {runsError && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <p>{runsError}</p>
                <button className="link mt-1" type="button" onClick={() => void loadRuns()}>Thử lại</button>
              </div>
            )}
            {runs && runs.length === 0 && (
              <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-slate-400">
                Chưa có đề xuất. Tạo một thay đổi ở form phía trên.
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {runs?.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected === item.id ? 'border-accent/60 bg-accent/5' : 'border-line bg-ink/40 hover:border-accent/40'
                    }`}
                    aria-pressed={selected === item.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className={`badge shrink-0 ${STATUS_STYLE[item.status] ?? ''}`}>{item.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      step {item.currentStep} · {item.attempts} lượt · {new Date(item.createdAt).toLocaleString('vi-VN')}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card" aria-labelledby="detail-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="detail-heading" className="text-base font-semibold">Chi tiết run</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {run ? `${run.title} · hết hạn ${new Date(run.expiresAt).toLocaleString('vi-VN')}` : 'Chọn một đề xuất bên trái.'}
                </p>
              </div>
              {run && <span className={`badge ${STATUS_STYLE[run.status] ?? ''}`}>{run.status}</span>}
            </div>

            {!run && (
              <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-slate-400">
                Chưa chọn đề xuất.
              </p>
            )}

            {run && (
              <div className="mt-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Diff đề xuất</h3>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-line bg-ink/70 p-3 text-xs text-emerald-200">{run.diff}</pre>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Các bước</h3>
                  <ol className="mt-2 space-y-1.5">
                    {run.steps.map((step) => (
                      <li key={step.step} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/70 px-3 py-2 text-sm">
                        <span className="badge shrink-0">{step.step}</span>
                        <span className="text-slate-300">{step.status}</span>
                        <span className="text-xs text-slate-500">attempt {step.attempt}</span>
                        {step.output && (
                          <details className="ml-auto">
                            <summary className="cursor-pointer text-xs text-accent">output</summary>
                            <pre className="mt-1 max-w-full overflow-auto text-xs text-slate-300">{JSON.stringify(step.output, null, 2)}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {run.lastError && (
                  <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Lỗi gần nhất: {run.lastError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  {run.status === 'awaiting_approval' && (
                    <>
                      <button className="btn-primary" type="button" onClick={() => void act(run.id, 'approve')} disabled={busy !== null}>
                        Duyệt và apply
                      </button>
                      <button className="btn-ghost" type="button" onClick={() => void act(run.id, 'reject')} disabled={busy !== null}>
                        Từ chối
                      </button>
                    </>
                  )}
                  {(run.status === 'running' || run.status === 'queued' || run.status === 'approved') && (
                    <button className="btn-ghost" type="button" onClick={() => void act(run.id, 'pause')} disabled={busy !== null}>
                      Pause (mô phỏng restart)
                    </button>
                  )}
                  {run.status === 'paused' && (
                    <button className="btn-primary" type="button" onClick={() => void act(run.id, 'resume')} disabled={busy !== null}>
                      Resume từ step đã lưu
                    </button>
                  )}
                  <button className="btn-ghost" type="button" onClick={() => void tick()} disabled={busy !== null}>
                    Worker tick
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Apply dùng idempotency key <code>apply:{run.id}</code>; worker không giữ state trong RAM.
                </p>
              </div>
            )}
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section className="card" aria-labelledby="metrics-heading">
              <h2 id="metrics-heading" className="text-base font-semibold">Metrics</h2>
              {!metrics ? (
                <p className="mt-3 text-sm text-slate-400">Đang tải…</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Tổng run" value={String(metrics.runs.total)} />
                  <Stat label="Đang chờ duyệt" value={String(metrics.runs.byStatus.awaiting_approval ?? 0)} />
                  <Stat label="Retry" value={String(metrics.retries)} />
                  <Stat
                    label="p95 duyệt"
                    value={metrics.approvalLatencyMs.p95 !== null ? `${metrics.approvalLatencyMs.p95}ms` : 'chưa đủ mẫu'}
                  />
                  <Stat
                    label="p95 request"
                    value={metrics.requestLatencyMs.p95 !== null ? `${metrics.requestLatencyMs.p95}ms` : 'chưa đủ mẫu'}
                  />
                  <Stat label="Hoàn tất" value={String(metrics.runs.byStatus.completed ?? 0)} />
                </div>
              )}
            </section>

            <section className="card" aria-labelledby="audit-heading">
              <h2 id="audit-heading" className="text-base font-semibold">Audit log</h2>
              {!audit ? (
                <p className="mt-3 text-sm text-slate-400">Đang tải…</p>
              ) : audit.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">Chưa có hoạt động.</p>
              ) : (
                <ul className="mt-3 max-h-56 space-y-1 overflow-auto text-xs">
                  {audit.map((log) => (
                    <li key={log.id} className="flex flex-wrap gap-x-2 border-b border-line/50 py-1.5">
                      <span className="text-slate-500">{new Date(log.created_at).toLocaleTimeString('vi-VN')}</span>
                      <span className="text-accent">{log.actor}</span>
                      <span className="text-slate-200">{log.action}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink/50 p-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold text-white">{value}</p>
    </div>
  );
}
