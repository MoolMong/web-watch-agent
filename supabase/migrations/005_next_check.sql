-- 005: per-watch schedule. Run once in Supabase → SQL Editor (safe to run again).
-- The agent sets next_check_at after every run (last check + the watch's interval);
-- the dashboard clears it to null when you add or edit a watch so it runs soon.
alter table public.watches add column if not exists next_check_at timestamptz;
create index if not exists watches_next on public.watches (enabled, next_check_at);

update public.watches
set next_check_at = coalesce(last_checked_at, now()) + make_interval(hours => coalesce((config->>'intervalHours')::int, 3))
where next_check_at is null and last_checked_at is not null;
