export type Migration = { version: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      create table if not exists users (
        id text primary key,
        email text not null unique,
        name text not null,
        password_hash text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists sessions (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );
      create index if not exists sessions_user_idx on sessions(user_id);

      create table if not exists runs (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        type text not null,
        title text not null,
        payload jsonb not null,
        diff text not null,
        status text not null,
        current_step text not null,
        attempts integer not null default 0,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
      create index if not exists runs_user_idx on runs(user_id);

      create table if not exists run_steps (
        id text primary key,
        run_id text not null references runs(id) on delete cascade,
        step text not null,
        status text not null,
        attempt integer not null default 0,
        output jsonb,
        started_at timestamptz,
        finished_at timestamptz,
        unique (run_id, step)
      );

      create table if not exists tool_calls (
        id text primary key,
        run_id text not null references runs(id) on delete cascade,
        step text not null,
        idempotency_key text not null unique,
        result jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists sandbox_state (
        user_id text not null references users(id) on delete cascade,
        key text not null,
        value text not null,
        updated_at timestamptz not null default now(),
        primary key (user_id, key)
      );

      create table if not exists outbox (
        id text primary key,
        run_id text not null references runs(id) on delete cascade,
        recipient text not null,
        subject text not null,
        body text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists audit_logs (
        id text primary key,
        run_id text,
        user_id text not null,
        actor text not null,
        action text not null,
        detail jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists rate_limits (
        key text primary key,
        window_start bigint not null,
        count integer not null
      );

      create table if not exists request_logs (
        id text primary key,
        method text not null,
        path text not null,
        status integer not null,
        duration_ms integer not null,
        created_at timestamptz not null default now()
      );
    `,
  },
];
