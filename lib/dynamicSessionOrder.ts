import { blockDurationMinutes, blocksPerDay } from '../constants/timeBlocks';
import { supabase } from './supabase';

type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
type SessionType = 'immutable' | 'mutable';

type ReorderSessionRow = {
  actual_end_time: string | null;
  block_count: number;
  checked_in: boolean | null;
  description: string | null;
  id: string;
  planned_end_time: string;
  planned_start_time: string;
  session_type: SessionType;
  task_id: string;
  title: string;
  tasks: {
    priority: TaskPriority | null;
    title: string;
    task_types: {
      name: string;
    } | null;
  } | null;
};

type PositionedSession = ReorderSessionRow & {
  originalEnd: Date;
  originalStart: Date;
  priorityRank: number;
};

type Interval = {
  end: number;
  start: number;
};

type MovePlan = {
  nextEnd: Date;
  nextStart: Date;
  reason: 'late_checkin' | 'conflict_detected' | 'strict_mode_push';
  session: PositionedSession;
};

export type ReorderedSessionSchedule = {
  categoryName: string | null;
  plannedEndTime: string;
  plannedStartTime: string;
  sessionId: string;
  taskTitle: string | null;
  title: string;
};

export type DynamicSessionOrderResult = {
  canceledNextDayMoveCount: number;
  completedSessionIds: string[];
  changed: boolean;
  movedSessionSchedules: ReorderedSessionSchedule[];
  skippedSessionCount: number;
};

export type NextDayMoveOption = {
  end: string;
  label: string;
  start: string;
};

export type NextDayMoveRequest = {
  blockCount: number;
  options: NextDayMoveOption[];
  originalEndTime: string;
  originalStartTime: string;
  priority: TaskPriority;
  sessionId: string;
  targetDate: string;
  taskTitle: string | null;
  title: string;
};

export type NextDayMoveDecision = {
  confirmed: boolean;
  plannedStartTime?: string;
};

type DynamicSessionOrderOptions = {
  abortOnCanceledNextDayMove?: boolean;
  confirmNextDayMove?: (request: NextDayMoveRequest) => Promise<NextDayMoveDecision>;
  excludedSessionIds?: string[];
  reservedIntervals?: Array<{ end: Date; start: Date }>;
};

const priorityRank: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export async function reorderTodaySessions(
  userId: string,
  date = new Date(),
  options: DynamicSessionOrderOptions = {},
): Promise<DynamicSessionOrderResult> {
  const emptyResult: DynamicSessionOrderResult = {
    canceledNextDayMoveCount: 0,
    changed: false,
    completedSessionIds: [],
    movedSessionSchedules: [],
    skippedSessionCount: 0,
  };

  if (!supabase) {
    return emptyResult;
  }

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const currentTime = isSameDay(date, new Date()) ? new Date() : dayStart;

  const { data, error } = await supabase
    .from('sessions')
    .select('id, task_id, title, description, session_type, planned_start_time, planned_end_time, actual_end_time, block_count, checked_in, tasks(title, priority, task_types(name))')
    .eq('user_id', userId)
    .gte('planned_start_time', dayStart.toISOString())
    .lt('planned_start_time', nextDayStart.toISOString())
    .order('planned_start_time', { ascending: true });

  if (error) {
    console.log('[dynamic-order] session load failed', { message: error.message });
    return emptyResult;
  }

  const excludedSessionIds = new Set(options.excludedSessionIds ?? []);
  const sessions = ((data ?? []) as unknown as ReorderSessionRow[])
    .filter((session) => !excludedSessionIds.has(session.id))
    .map((session) => ({
      ...session,
      originalEnd: new Date(session.planned_end_time),
      originalStart: new Date(session.planned_start_time),
      priorityRank: priorityRank[session.tasks?.priority ?? 'medium'],
    }));

  const completedSessions = sessions.filter((session) => session.actual_end_time && session.session_type !== 'immutable');
  if (completedSessions.length > 0) {
    const { error: completeError } = await supabase
      .from('sessions')
      .update({ session_type: 'immutable' })
      .eq('user_id', userId)
      .in('id', completedSessions.map((session) => session.id));

    if (completeError) {
      console.log('[dynamic-order] completed session lock failed', { message: completeError.message });
    }
  }

  const reservedIntervals = (options.reservedIntervals ?? []).map((interval) => ({
    start: clampBlockIndex(Math.floor((interval.start.getTime() - dayStart.getTime()) / blockMs())),
    end: clampBlockIndex(Math.ceil((interval.end.getTime() - dayStart.getTime()) / blockMs())),
  }));

  const lockedIntervals = [
    ...sessions
      .filter((session) => isLockedSession(session))
      .map((session) => toInterval(session, dayStart)),
    ...reservedIntervals,
  ].sort((left, right) => left.start - right.start);

  const movableSessions = sessions
    .filter((session) => isMovableSession(session))
    .filter((session) => session.originalStart < nextDayStart)
    .sort((left, right) => left.originalStart.getTime() - right.originalStart.getTime());

  const lateSessions = movableSessions.filter((session) => session.originalStart < currentTime);
  const shouldReorder = lateSessions.length > 0 || reservedIntervals.length > 0;
  if (!shouldReorder) {
    return {
      canceledNextDayMoveCount: 0,
      changed: completedSessions.length > 0,
      completedSessionIds: sessions.filter((session) => Boolean(session.actual_end_time)).map((session) => session.id),
      movedSessionSchedules: [],
      skippedSessionCount: 0,
    };
  }

  const currentIndex = clampBlockIndex(Math.ceil((currentTime.getTime() - dayStart.getTime()) / blockMs()));
  const { movePlans, skippedSessions } = planMovableSessions({
    currentIndex,
    currentTime,
    dayStart,
    lockedIntervals,
    movableSessions,
  });
  const movedSessionSchedules: ReorderedSessionSchedule[] = [];

  const nextDayIntervals = await loadDayIntervals(userId, nextDayStart);
  let confirmedSkippedCount = 0;
  let canceledNextDayMoveCount = 0;

  for (const session of skippedSessions) {
    const moveOptions = getNextDayMoveOptions(nextDayStart, session, nextDayIntervals);

    if (moveOptions.length === 0) {
      console.log('[dynamic-order] no next-day slot found', { sessionId: session.id });
      continue;
    }

    const decision = options.confirmNextDayMove
      ? await options.confirmNextDayMove(toNextDayMoveRequest(session, nextDayStart, moveOptions))
      : { confirmed: true, plannedStartTime: moveOptions[0]?.start };

    if (!decision.confirmed) {
      canceledNextDayMoveCount += 1;
      continue;
    }

    const nextStart = decision.plannedStartTime ? new Date(decision.plannedStartTime) : new Date(moveOptions[0].start);
    const nextEnd = addBlocks(nextStart, session.block_count);
    movePlans.push({
      nextEnd,
      nextStart,
      reason: 'strict_mode_push',
      session,
    });
    nextDayIntervals.push(toIntervalFromDate(nextStart, session.block_count, nextDayStart));
    confirmedSkippedCount += 1;
  }

  if (options.abortOnCanceledNextDayMove && canceledNextDayMoveCount > 0) {
    return {
      canceledNextDayMoveCount,
      changed: completedSessions.length > 0,
      completedSessionIds: sessions.filter((session) => Boolean(session.actual_end_time)).map((session) => session.id),
      movedSessionSchedules: [],
      skippedSessionCount: 0,
    };
  }

  for (const plan of movePlans) {
    await moveSession(userId, plan.session, plan.nextStart, plan.nextEnd, plan.reason);
    movedSessionSchedules.push(toSchedule(plan.session, plan.nextStart, plan.nextEnd));
  }

  if (confirmedSkippedCount > 0) {
    await incrementSkippedBlocks(userId, dayStart, confirmedSkippedCount);
  }

  return {
    canceledNextDayMoveCount,
    changed: completedSessions.length > 0 || movedSessionSchedules.length > 0,
    completedSessionIds: sessions.filter((session) => Boolean(session.actual_end_time)).map((session) => session.id),
    movedSessionSchedules,
    skippedSessionCount: confirmedSkippedCount,
  };
}

function isLockedSession(session: PositionedSession) {
  return Boolean(session.actual_end_time) || session.checked_in === true || session.session_type === 'immutable';
}

function isMovableSession(session: PositionedSession) {
  return !session.actual_end_time && session.checked_in !== true && session.session_type === 'mutable';
}

function planMovableSessions({
  currentIndex,
  currentTime,
  dayStart,
  lockedIntervals,
  movableSessions,
}: {
  currentIndex: number;
  currentTime: Date;
  dayStart: Date;
  lockedIntervals: Interval[];
  movableSessions: PositionedSession[];
}) {
  const skippedSessions: PositionedSession[] = [];
  const skippedIds = new Set<string>();

  while (true) {
    const placedIntervals = [...lockedIntervals];
    const movePlans: MovePlan[] = [];
    let failedSession: PositionedSession | null = null;

    for (const session of movableSessions.filter((item) => !skippedIds.has(item.id))) {
      const originalStartIndex = toInterval(session, dayStart).start;
      const earliestStart = Math.max(currentIndex, session.originalStart < currentTime ? currentIndex : originalStartIndex);
      const nextIndex = findFreeStartIndex(earliestStart, session.block_count, placedIntervals);

      if (nextIndex === null) {
        failedSession = session;
        break;
      }

      const nextStart = addBlocks(dayStart, nextIndex);
      const nextEnd = addBlocks(nextStart, session.block_count);
      placedIntervals.push({ start: nextIndex, end: nextIndex + session.block_count });
      placedIntervals.sort((left, right) => left.start - right.start);

      if (nextStart.getTime() !== session.originalStart.getTime() || nextEnd.getTime() !== session.originalEnd.getTime()) {
        movePlans.push({
          nextEnd,
          nextStart,
          reason: session.originalStart < currentTime ? 'late_checkin' : 'conflict_detected',
          session,
        });
      }
    }

    if (!failedSession) {
      return { movePlans, skippedSessions };
    }

    const nextSkippedSession = chooseLowestPrioritySession(movableSessions.filter((session) => !skippedIds.has(session.id)));

    if (!nextSkippedSession) {
      return { movePlans, skippedSessions };
    }

    skippedIds.add(nextSkippedSession.id);
    skippedSessions.push(nextSkippedSession);
  }
}

function chooseLowestPrioritySession(sessions: PositionedSession[]) {
  return [...sessions].sort((left, right) => {
    if (left.priorityRank !== right.priorityRank) {
      return left.priorityRank - right.priorityRank;
    }

    return right.originalStart.getTime() - left.originalStart.getTime();
  })[0] ?? null;
}

function findFreeStartIndex(startIndex: number, blockCount: number, intervals: Interval[]) {
  for (let index = startIndex; index + blockCount <= blocksPerDay; index += 1) {
    const hasConflict = intervals.some((interval) => index < interval.end && index + blockCount > interval.start);
    if (!hasConflict) {
      return index;
    }
  }

  return null;
}

async function loadDayIntervals(userId: string, nextDayStart: Date) {
  if (!supabase) {
    return [];
  }

  const nextDayEnd = new Date(nextDayStart.getFullYear(), nextDayStart.getMonth(), nextDayStart.getDate() + 1);
  const { data } = await supabase
    .from('sessions')
    .select('planned_start_time, block_count')
    .eq('user_id', userId)
    .gte('planned_start_time', nextDayStart.toISOString())
    .lt('planned_start_time', nextDayEnd.toISOString());

  return ((data ?? []) as Array<{ planned_start_time: string; block_count: number }>).map((row) => {
    const start = new Date(row.planned_start_time);
    return toIntervalFromDate(start, Number(row.block_count), nextDayStart);
  });
}

function getNextDayMoveOptions(nextDayStart: Date, session: PositionedSession, intervals: Interval[]) {
  const moveOptions: NextDayMoveOption[] = [];

  for (let startIndex = 0; startIndex + session.block_count <= blocksPerDay; startIndex += 1) {
    const hasConflict = intervals.some((interval) => startIndex < interval.end && startIndex + session.block_count > interval.start);

    if (hasConflict) {
      continue;
    }

    const start = addBlocks(nextDayStart, startIndex);
    const end = addBlocks(start, session.block_count);

    moveOptions.push({
      end: end.toISOString(),
      label: `${formatClock(start)}-${formatClock(end)}`,
      start: start.toISOString(),
    });
  }

  return moveOptions;
}

function toNextDayMoveRequest(session: PositionedSession, nextDayStart: Date, options: NextDayMoveOption[]): NextDayMoveRequest {
  return {
    blockCount: session.block_count,
    options,
    originalEndTime: session.originalEnd.toISOString(),
    originalStartTime: session.originalStart.toISOString(),
    priority: session.tasks?.priority ?? 'medium',
    sessionId: session.id,
    targetDate: toDateInput(nextDayStart),
    taskTitle: session.tasks?.title ?? null,
    title: session.title,
  };
}

function toIntervalFromDate(start: Date, blockCount: number, dayStart: Date) {
  const startIndex = Math.floor((start.getTime() - dayStart.getTime()) / blockMs());
  return {
    start: clampBlockIndex(startIndex),
    end: clampBlockIndex(startIndex + blockCount),
  };
}

async function moveSession(
  userId: string,
  session: PositionedSession,
  nextStart: Date,
  nextEnd: Date,
  reason: 'late_checkin' | 'conflict_detected' | 'strict_mode_push',
) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from('sessions')
    .update({
      planned_end_time: nextEnd.toISOString(),
      planned_start_time: nextStart.toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', session.id);

  if (error) {
    console.log('[dynamic-order] session move failed', { message: error.message, sessionId: session.id });
    return;
  }

  await supabase.from('session_reorder').insert({
    user_id: userId,
    session_id: session.id,
    original_start_time: session.originalStart.toISOString(),
    original_end_time: session.originalEnd.toISOString(),
    new_start_time: nextStart.toISOString(),
    new_end_time: nextEnd.toISOString(),
    reason,
  });
}

async function incrementSkippedBlocks(userId: string, dayStart: Date, count: number) {
  if (!supabase) {
    return;
  }

  const statDate = toDateInput(dayStart);
  const { data } = await supabase
    .from('daily_statistics')
    .select('skipped_blocks')
    .eq('user_id', userId)
    .eq('stat_date', statDate)
    .maybeSingle();

  await supabase.from('daily_statistics').upsert(
    {
      skipped_blocks: Number(data?.skipped_blocks ?? 0) + count,
      stat_date: statDate,
      total_blocks: blocksPerDay,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    { onConflict: 'user_id,stat_date' },
  );
}

function toSchedule(session: PositionedSession, start: Date, end: Date): ReorderedSessionSchedule {
  return {
    categoryName: session.tasks?.task_types?.name ?? null,
    plannedEndTime: end.toISOString(),
    plannedStartTime: start.toISOString(),
    sessionId: session.id,
    taskTitle: session.tasks?.title ?? null,
    title: session.title,
  };
}

function toInterval(session: PositionedSession, dayStart: Date) {
  const start = Math.floor((session.originalStart.getTime() - dayStart.getTime()) / blockMs());
  return {
    start: clampBlockIndex(start),
    end: clampBlockIndex(start + session.block_count),
  };
}

function addBlocks(date: Date, blockCount: number) {
  return new Date(date.getTime() + blockCount * blockMs());
}

function blockMs() {
  return blockDurationMinutes * 60 * 1000;
}

function clampBlockIndex(value: number) {
  return Math.min(Math.max(value, 0), blocksPerDay);
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
