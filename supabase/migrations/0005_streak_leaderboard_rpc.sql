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
