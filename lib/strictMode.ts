import { blockDurationMinutes, blocksPerDay } from '../constants/timeBlocks';
import { supabase } from './supabase';

const strictBusyMinPercent = 80;

type SessionStatRow = {
  actual_end_time: string | null;
  checked_in: boolean | null;
  session_type: 'immutable' | 'mutable' | null;
  planned_end_time: string;
  planned_start_time: string;
};

export async function refreshStrictModeForDate(userId: string, date = new Date()) {
  if (!supabase) {
    return false;
  }

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const currentTime = isSameDay(date, new Date()) ? new Date() : dayStart;
  const totalRemainingBlocks = getBlockCountBetween(currentTime, nextDayStart);

  const { data, error } = await supabase
    .from('sessions')
    .select('actual_end_time, checked_in, planned_end_time, planned_start_time, session_type')
    .eq('user_id', userId)
    .gt('planned_end_time', currentTime.toISOString())
    .lt('planned_start_time', nextDayStart.toISOString());

  if (error) {
    console.log('[strict-mode] session stat load failed', { message: error.message });
    return false;
  }

  const unfinishedRows = ((data ?? []) as SessionStatRow[]).filter((session) => {
    return !session.actual_end_time || session.checked_in === false || session.checked_in === null;
  });
  const plannedBlocks = clampBlocks(
    unfinishedRows.reduce((total, session) => total + getRemainingSessionBlocks(session, currentTime, nextDayStart), 0),
    totalRemainingBlocks,
  );
  const immutableBlocks = clampBlocks(
    unfinishedRows
      .filter((session) => session.session_type === 'immutable')
      .reduce((total, session) => total + getRemainingSessionBlocks(session, currentTime, nextDayStart), 0),
    totalRemainingBlocks,
  );
  const mutableBlocks = clampBlocks(
    unfinishedRows
      .filter((session) => session.session_type === 'mutable')
      .reduce((total, session) => total + getRemainingSessionBlocks(session, currentTime, nextDayStart), 0),
    totalRemainingBlocks,
  );
  const blankBlocks = Math.max(totalRemainingBlocks - plannedBlocks, 0);
  const busyPercent = totalRemainingBlocks > 0 ? (plannedBlocks / totalRemainingBlocks) * 100 : 0;
  const strictModeEnabled = busyPercent >= strictBusyMinPercent;

  const { error: upsertError } = await supabase.from('daily_statistics').upsert(
    {
      blank_blocks: blankBlocks,
      immutable_blocks: immutableBlocks,
      mutable_blocks: mutableBlocks,
      planned_blocks: plannedBlocks,
      stat_date: toDateInput(dayStart),
      strict_mode_enable: strictModeEnabled,
      total_blocks: totalRemainingBlocks,
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

function getRemainingSessionBlocks(session: SessionStatRow, currentTime: Date, endTime: Date) {
  const overlapStart = new Date(Math.max(new Date(session.planned_start_time).getTime(), currentTime.getTime()));
  const overlapEnd = new Date(Math.min(new Date(session.planned_end_time).getTime(), endTime.getTime()));

  return getBlockCountBetween(overlapStart, overlapEnd);
}

function getBlockCountBetween(start: Date, end: Date) {
  const durationMs = Math.max(end.getTime() - start.getTime(), 0);
  return Math.min(Math.ceil(durationMs / (blockDurationMinutes * 60 * 1000)), blocksPerDay);
}

function clampBlocks(value: number, maxBlocks: number) {
  return Math.min(Math.max(value, 0), maxBlocks);
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
