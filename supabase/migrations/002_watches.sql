-- 002: many watches per watcher. Run once in Supabase → SQL Editor (safe to run again).
-- Each row in `watches` is one saved search (its own config, on/off switch, history).
-- The dashboard edits watches directly (owner only); the PC agent runs them.

create table if not exists public.watches (
  id              bigint generated always as identity primary key,
  watcher         text not null,
  config          jsonb not null,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_checked_at timestamptz,
  last_summary    jsonb,                  -- copy of the latest check's summary, for the list view
  last_error      text
);
create index if not exists watches_due on public.watches (watcher, enabled, last_checked_at);

alter table public.watch_checks   add column if not exists watch_id bigint references public.watches (id) on delete cascade;
alter table public.watch_requests add column if not exists watch_id bigint references public.watches (id) on delete cascade;
create index if not exists watch_checks_by_watch on public.watch_checks (watch_id, checked_at desc);

revoke all on public.watches from anon;
grant select, insert, update, delete on public.watches to authenticated;
grant all on public.watches to service_role;

alter table public.watches enable row level security;
drop policy if exists "owner manages watches" on public.watches;
create policy "owner manages watches" on public.watches for all to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table public.watches;
exception when duplicate_object then null; end $$;

-- Move the single saved config (and its history) into the first watch.
insert into public.watches (watcher, config)
select c.watcher, c.config from public.watch_configs c
where not exists (select 1 from public.watches w where w.watcher = c.watcher);

update public.watch_checks k set watch_id = w.id
from (select watcher, min(id) as id from public.watches group by watcher) w
where k.watch_id is null and k.watcher = w.watcher;

update public.watch_requests r set watch_id = w.id
from (select watcher, min(id) as id from public.watches group by watcher) w
where r.watch_id is null and r.watcher = w.watcher;

update public.watches w set
  last_checked_at = k.checked_at,
  last_summary = k.summary
from (
  select distinct on (watch_id) watch_id, checked_at, summary
  from public.watch_checks where watch_id is not null order by watch_id, checked_at desc
) k
where k.watch_id = w.id and w.last_checked_at is null;
