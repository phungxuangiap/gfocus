alter table public.user_settings
alter column block_duration_minutes set default 5;

update public.user_settings
set block_duration_minutes = 5,
    updated_at = now()
where block_duration_minutes = 30;

update public.sessions
set block_count = greatest(
      1,
      ceil(extract(epoch from (planned_end_time - planned_start_time)) / 60 / 5)::int
    ),
    updated_at = now();

delete from public.time_blocks;

notify pgrst, 'reload schema';
