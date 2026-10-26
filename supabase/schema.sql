-- web-watch-agent schema. Paste into Supabase → SQL Editor → Run (safe to run again),
-- then run supabase/migrations/002_watches.sql (multiple saved watches per watcher).
--
-- Access model: sign-ups are disabled, so the only "authenticated" user is the owner.
--   * Dashboard (publishable key + owner login): read everything, insert search requests.
--   * PC agent (secret key, bypasses RLS): validates requests, writes configs and checks.

create table if not exists public.watch_configs (
  watcher    text primary key,
  config     jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.watch_requests (
  id          bigint generated always as identity primary key,
  watcher     text not null,
  config      jsonb,                      -- null = re-run with the saved config
  status      text not null default 'pending'
              check (status in ('pending', 'running', 'done', 'error')),
  message     text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

create table if not exists public.watch_checks (
  id         bigint generated always as identity primary key,
  watcher    text not null,
  checked_at timestamptz not null default now(),
  config_key text,                        -- checks with the same trip conditions share a key
  summary    jsonb not null,              -- small numbers for charts and history
  snapshot   jsonb,                       -- full result for the latest view
  request_id bigint references public.watch_requests (id) on delete set null
);
create index if not exists watch_checks_recent on public.watch_checks (watcher, checked_at desc);
create index if not exists watch_requests_pending on public.watch_requests (status, created_at);

-- Table privileges (needed when "Automatically expose new tables" is off); RLS below narrows them.
revoke all on public.watch_configs, public.watch_requests, public.watch_checks from anon;
grant select on public.watch_configs, public.watch_checks to authenticated;
grant select, insert on public.watch_requests to authenticated;
grant all on public.watch_configs, public.watch_requests, public.watch_checks to service_role;

alter table public.watch_configs  enable row level security;
alter table public.watch_requests enable row level security;
alter table public.watch_checks   enable row level security;

drop policy if exists "owner reads configs" on public.watch_configs;
create policy "owner reads configs" on public.watch_configs for select to authenticated using (true);

drop policy if exists "owner reads requests" on public.watch_requests;
create policy "owner reads requests" on public.watch_requests for select to authenticated using (true);

drop policy if exists "owner creates requests" on public.watch_requests;
create policy "owner creates requests" on public.watch_requests for insert to authenticated
  with check (status = 'pending' and message is null and started_at is null and finished_at is null);

drop policy if exists "owner reads checks" on public.watch_checks;
create policy "owner reads checks" on public.watch_checks for select to authenticated using (true);

-- Live updates on the dashboard (request status, new checks).
do $$ begin
  alter publication supabase_realtime add table public.watch_requests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.watch_checks;
exception when duplicate_object then null; end $$;
