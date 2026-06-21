do $$ begin
  create type public.session_type as enum ('immutable', 'mutable');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('done', 'canceled', 'happending');
exception
  when duplicate_object then null;
end $$;

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

alter table public.task_types enable row level security;
alter table public.tasks enable row level security;
alter table public.sessions enable row level security;
alter table public.time_blocks enable row level security;

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

notify pgrst, 'reload schema';
