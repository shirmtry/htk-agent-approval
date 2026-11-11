'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'login' | 'register';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(mode === 'login' ? 'demo@htk.dev' : '');
  const [password, setPassword] = useState(mode === 'login' ? 'Demo12345!' : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(credentials?: { email: string; password: string }) {
    setPending(true);
    setError(null);
    try {
      const payload =
        mode === 'register'
          ? { name, email, password }
          : credentials ?? { email, password };
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { user?: unknown; error?: { message: string } }
        | null;
      if (!response.ok) {
        setError(data?.error?.message ?? `Không thể ${mode === 'login' ? 'đăng nhập' : 'đăng ký'}.`);
        return;
      }
      router.push('/workspace');
      router.refresh();
    } catch {
      setError('Không kết nối được server. Kiểm tra mạng rồi thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card w-full max-w-md">
      <h1 className="text-2xl font-semibold">
        {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {mode === 'login'
          ? 'Dùng tài khoản demo hoặc tài khoản bạn đã tạo.'
          : 'Mỗi tài khoản có không gian đề xuất và audit log riêng.'}
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'register' && (
          <div>
            <label className="label" htmlFor="name">
              Tên hiển thị
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              minLength={2}
              maxLength={60}
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mật khẩu
          </label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={8}
          />
        </div>

        <div aria-live="polite" role="status">
          {error && (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}
        </div>

        <button className="btn-primary w-full" type="submit" disabled={pending}>
          {pending ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
      </form>

      {mode === 'login' && (
        <button
          className="btn-ghost mt-3 w-full"
          type="button"
          disabled={pending}
          onClick={() => void submit({ email: 'demo@htk.dev', password: 'Demo12345!' })}
        >
          Đăng nhập tài khoản demo
        </button>
      )}

      <p className="mt-5 text-sm text-slate-400">
        {mode === 'login' ? (
          <>
            Chưa có tài khoản?{' '}
            <Link className="link" href="/register">
              Đăng ký
            </Link>
          </>
        ) : (
          <>
            Đã có tài khoản?{' '}
            <Link className="link" href="/login">
              Đăng nhập
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
