-- 003: PC agent heartbeat + per-watch price trend. Run once in Supabase → SQL Editor (safe to run again).

-- The agent writes one row here every ~30 s so the dashboard can show whether the PC is online.
create table if not exists public.agent_status (
  id            text primary key,          -- 'pc'
  last_seen     timestamptz not null default now(),
  started_at    timestamptz,
  busy_watch_id bigint,                    -- watch being checked right now, if any
  queue         int not null default 0     -- pending requests the agent knows about
);
revoke all on public.agent_status from anon;
grant select on public.agent_status to authenticated;
grant all on public.agent_status to service_role;
alter table public.agent_status enable row level security;
drop policy if exists "owner reads agent status" on public.agent_status;
create policy "owner reads agent status" on public.agent_status for select to authenticated using (true);
do $$ begin
  alter publication supabase_realtime add table public.agent_status;
exception when duplicate_object then null; end $$;

-- Trend fields kept on each watch for the list view.
alter table public.watches add column if not exists prev_summary jsonb;     -- summary of the check before the latest
alter table public.watches add column if not exists lowest_price integer;   -- lowest fare seen for the current conditions

-- Backfill from existing checks (same config_key as the latest check).
with latest as (
  select distinct on (watch_id) watch_id, config_key from public.watch_checks
  where watch_id is not null order by watch_id, checked_at desc
), prev as (
  select watch_id, summary from (
    select k.watch_id, k.summary, row_number() over (partition by k.watch_id order by k.checked_at desc) as n
    from public.watch_checks k where k.watch_id is not null
  ) t where n = 2
), low as (
  select k.watch_id, min((k.summary->>'minPrice')::int) as lowest
  from public.watch_checks k join latest l on l.watch_id = k.watch_id and l.config_key = k.config_key
  group by k.watch_id
)
update public.watches w set
  prev_summary = coalesce(w.prev_summary, prev.summary),
  lowest_price = coalesce(w.lowest_price, low.lowest)
from latest
left join prev on prev.watch_id = latest.watch_id
left join low on low.watch_id = latest.watch_id
where latest.watch_id = w.id;
