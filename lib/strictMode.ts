import { supabase } from './supabase';

const blockDurationMinutes = 5;
const totalBlocksPerDay = (24 * 60) / blockDurationMinutes;
const strictBlankMinPercent = 10;
const strictBlankMaxPercent = 20;

type SessionStatRow = {
  block_count: number | null;
  session_type: 'immutable' | 'mutable' | null;
};

export async function refreshStrictModeForDate(userId: string, date = new Date()) {
  if (!supabase) {
    return false;
  }

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

  const { data, error } = await supabase
    .from('sessions')
    .select('block_count, session_type')
    .eq('user_id', userId)
    .gte('planned_start_time', dayStart.toISOString())
    .lt('planned_start_time', nextDayStart.toISOString());

  if (error) {
    console.log('[strict-mode] session stat load failed', { message: error.message });
    return false;
  }

  const rows = (data ?? []) as SessionStatRow[];
  const plannedBlocks = clampBlocks(rows.reduce((total, session) => total + Number(session.block_count ?? 0), 0));
  const immutableBlocks = clampBlocks(
    rows
      .filter((session) => session.session_type === 'immutable')
      .reduce((total, session) => total + Number(session.block_count ?? 0), 0),
  );
  const mutableBlocks = clampBlocks(
    rows
      .filter((session) => session.session_type === 'mutable')
      .reduce((total, session) => total + Number(session.block_count ?? 0), 0),
  );
  const blankBlocks = Math.max(totalBlocksPerDay - plannedBlocks, 0);
  const blankPercent = (blankBlocks / totalBlocksPerDay) * 100;
  const strictModeEnabled = blankPercent >= strictBlankMinPercent && blankPercent <= strictBlankMaxPercent;

  const { error: upsertError } = await supabase.from('daily_statistics').upsert(
    {
      blank_blocks: blankBlocks,
      immutable_blocks: immutableBlocks,
      mutable_blocks: mutableBlocks,
      planned_blocks: plannedBlocks,
      skipped_blocks: 0,
      stat_date: toDateInput(dayStart),
      strict_mode_enable: strictModeEnabled,
      total_blocks: totalBlocksPerDay,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    { onConflict: 'user_id,stat_date' },
  );

  if (upsertError) {
    console.log('[strict-mode] daily statistic upsert failed', { message: upsertError.message });
  }

  return strictModeEnabled;
}

function clampBlocks(value: number) {
  return Math.min(Math.max(value, 0), totalBlocksPerDay);
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
