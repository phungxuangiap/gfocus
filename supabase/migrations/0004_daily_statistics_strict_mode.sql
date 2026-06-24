alter table public.daily_statistics
add column if not exists strict_mode_enable boolean default false;

notify pgrst, 'reload schema';
