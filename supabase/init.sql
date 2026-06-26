create extension if not exists "pgcrypto";

do $$ begin
  create type public.session_type as enum ('immutable', 'mutable');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('done', 'canceled', 'happending');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_type as enum (
    'session_start',
    'checkin_late',
    'session_completed',
    'strict_mode',
    'plan_reminder',
    'auto_reorder',
    'mascot_message'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_severity as enum ('soft', 'normal', 'strict');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.reorder_reason as enum (
    'late_checkin',
    'missed_session',
    'user_reschedule',
    'conflict_detected',
    'strict_mode_push'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.strict_mode_status as enum ('inactive', 'active');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email varchar unique not null,
  username varchar not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  block_duration_minutes int not null default 5,
  strict_threshold_percent int default 80,
  blank_block_min_percent int default 20,
  enable_auto_reorder boolean default true,
  enable_mascot boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name varchar not null,
  description text,
  color varchar,
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists task_types_user_id_idx on public.task_types(user_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title varchar not null,
  description text,
  task_type_id uuid references public.task_types(id) on delete set null,
  priority public.task_priority default 'medium',
  status public.task_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_type_idx on public.tasks(user_id, task_type_id);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title varchar not null,
  description text,
  session_type public.session_type not null,
  planned_start_time timestamptz not null,
  planned_end_time timestamptz not null,
  actual_start_time timestamptz,
  actual_end_time timestamptz,
  block_count int not null,
  checked_in boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_planned_start_idx on public.sessions(user_id, planned_start_time);
create index if not exists sessions_planned_start_idx on public.sessions(planned_start_time);
create index if not exists sessions_task_id_idx on public.sessions(task_id);

create table if not exists public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  block_date date not null,
  block_index int not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  session_id uuid references public.sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, block_date, block_index)
);

create index if not exists time_blocks_block_index_idx on public.time_blocks(block_index);
create index if not exists time_blocks_user_date_idx on public.time_blocks(user_id, block_date);

create table if not exists public.session_reorder (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  original_start_time timestamptz not null,
  original_end_time timestamptz not null,
  new_start_time timestamptz,
  new_end_time timestamptz,
  reason public.reorder_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_reorder_user_created_idx on public.session_reorder(user_id, created_at);
create index if not exists session_reorder_session_id_idx on public.session_reorder(session_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  type public.notification_type not null,
  severity public.notification_severity default 'normal',
  title varchar not null,
  message text not null,
  scheduled_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_scheduled_idx on public.notifications(user_id, scheduled_at);
create index if not exists notifications_session_id_idx on public.notifications(session_id);
create index if not exists notifications_type_idx on public.notifications(type);

create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  current_streak int default 0,
  longest_streak int default 0,
  last_completed_date date,
  last_missed_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_statistics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stat_date date not null,
  total_blocks int not null,
  planned_blocks int default 0,
  blank_blocks int default 0,
  immutable_blocks int default 0,
  mutable_blocks int default 0,
  skipped_blocks int default 0,
  strict_mode_enable boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stat_date)
);

create table if not exists public.weekly_statistics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  total_blocks int not null,
  planned_blocks int default 0,
  blank_blocks int default 0,
  immutable_blocks int default 0,
  mutable_blocks int default 0,
  completed_blocks int default 0,
  missed_blocks int default 0,
  strict_mode_triggered_count int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start_date)
);

alter table public.users enable row level security;
alter table public.user_settings enable row level security;
alter table public.task_types enable row level security;
alter table public.tasks enable row level security;
alter table public.sessions enable row level security;
alter table public.time_blocks enable row level security;
alter table public.session_reorder enable row level security;
alter table public.notifications enable row level security;
alter table public.streaks enable row level security;
alter table public.daily_statistics enable row level security;
alter table public.weekly_statistics enable row level security;

drop policy if exists "Users can view own profile" on public.users;
create policy "Users can view own profile"
on public.users for select
using (auth.uid() = id);

drop policy if exists "Users can create own profile" on public.users;
create policy "Users can create own profile"
on public.users for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
on public.users for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users manage own settings" on public.user_settings;
create policy "Users manage own settings"
on public.user_settings for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own task types" on public.task_types;
create policy "Users manage own task types"
on public.task_types for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own tasks" on public.tasks;
create policy "Users manage own tasks"
on public.tasks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own sessions" on public.sessions;
create policy "Users manage own sessions"
on public.sessions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own time blocks" on public.time_blocks;
create policy "Users manage own time blocks"
on public.time_blocks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own session reorder" on public.session_reorder;
create policy "Users manage own session reorder"
on public.session_reorder for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own notifications" on public.notifications;
create policy "Users manage own notifications"
on public.notifications for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own streaks" on public.streaks;
create policy "Users manage own streaks"
on public.streaks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own daily statistics" on public.daily_statistics;
create policy "Users manage own daily statistics"
on public.daily_statistics for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own weekly statistics" on public.weekly_statistics;
create policy "Users manage own weekly statistics"
on public.weekly_statistics for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_task_types_updated_at on public.task_types;
create trigger set_task_types_updated_at
before update on public.task_types
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_sessions_updated_at on public.sessions;
create trigger set_sessions_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_time_blocks_updated_at on public.time_blocks;
create trigger set_time_blocks_updated_at
before update on public.time_blocks
for each row execute function public.set_updated_at();

drop trigger if exists set_session_reorder_updated_at on public.session_reorder;
create trigger set_session_reorder_updated_at
before update on public.session_reorder
for each row execute function public.set_updated_at();

drop trigger if exists set_streaks_updated_at on public.streaks;
create trigger set_streaks_updated_at
before update on public.streaks
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_statistics_updated_at on public.daily_statistics;
create trigger set_daily_statistics_updated_at
before update on public.daily_statistics
for each row execute function public.set_updated_at();

drop trigger if exists set_weekly_statistics_updated_at on public.weekly_statistics;
create trigger set_weekly_statistics_updated_at
before update on public.weekly_statistics
for each row execute function public.set_updated_at();

create or replace function public.get_streak_leaderboard(limit_count int default 50)
returns table (
  rank int,
  user_id uuid,
  username varchar,
  streak_days int
)
language sql
security definer
set search_path = public
as $$
  with recursive streak_scan as (
    select
      users.id as user_id,
      users.username,
      current_date as check_date,
      0 as streak_days
    from public.users

    union all

    select
      streak_scan.user_id,
      streak_scan.username,
      streak_scan.check_date - 1,
      streak_scan.streak_days + 1
    from streak_scan
    join public.daily_statistics
      on daily_statistics.user_id = streak_scan.user_id
      and daily_statistics.stat_date = streak_scan.check_date
      and coalesce(daily_statistics.skipped_blocks, 0) = 0
    where streak_scan.check_date > current_date - 365
  ),
  current_streaks as (
    select
      streak_scan.user_id,
      streak_scan.username,
      max(streak_scan.streak_days)::int as streak_days
    from streak_scan
    group by streak_scan.user_id, streak_scan.username
  ),
  ranked as (
    select
      dense_rank() over (order by current_streaks.streak_days desc, current_streaks.username asc)::int as rank,
      current_streaks.user_id,
      current_streaks.username,
      current_streaks.streak_days
    from current_streaks
  )
  select ranked.rank, ranked.user_id, ranked.username, ranked.streak_days
  from ranked
  order by ranked.rank asc, ranked.username asc
  limit greatest(limit_count, 1);
$$;

grant execute on function public.get_streak_leaderboard(int) to authenticated;

notify pgrst, 'reload schema';
