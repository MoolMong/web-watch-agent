-- 004: alert events. Run once in Supabase → SQL Editor (safe to run again).
-- The agent writes a row when a watch changes state in a way worth telling you about
-- (turned to "buy", reached the target price, new lowest fare). The dashboard lists them
-- and can show a browser notification for new rows.

create table if not exists public.watch_events (
  id         bigint generated always as identity primary key,
  watch_id   bigint references public.watches (id) on delete cascade,
  kind       text not null check (kind in ('buy', 'target', 'lowest')),
  title      text not null,
  body       text,
  url        text,
  created_at timestamptz not null default now()
);
create index if not exists watch_events_recent on public.watch_events (created_at desc);

revoke all on public.watch_events from anon;
grant select on public.watch_events to authenticated;
grant all on public.watch_events to service_role;
alter table public.watch_events enable row level security;
drop policy if exists "owner reads events" on public.watch_events;
create policy "owner reads events" on public.watch_events for select to authenticated using (true);
do $$ begin
  alter publication supabase_realtime add table public.watch_events;
exception when duplicate_object then null; end $$;
