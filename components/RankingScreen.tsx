import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { blockDurationMinutes } from '../constants/timeBlocks';
import { colors, shadowHard } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAppSelector } from '../store/hooks';

type SessionStatRow = {
  actual_end_time: string | null;
  block_count: number;
  planned_end_time: string;
  planned_start_time: string;
  tasks: {
    title: string;
    task_types: {
      color: string | null;
      name: string;
    } | Array<{
      color: string | null;
      name: string;
    }> | null;
  } | Array<{
    title: string;
    task_types: {
      color: string | null;
      name: string;
    } | Array<{
      color: string | null;
      name: string;
    }> | null;
  }> | null;
};

type DailyStatisticRow = {
  skipped_blocks: number | null;
  stat_date: string;
};

type LeaderboardRow = {
  rank: number;
  streak_days: number;
  user_id: string;
  username: string;
};

export function RankingScreen() {
  const insets = useSafeAreaInsets();
  const session = useAppSelector((state) => state.auth.session);
  const strictModeEnabled = useAppSelector((state) => state.app.strictModeEnabled);
  const [loading, setLoading] = useState(true);
  const [completedSessions, setCompletedSessions] = useState<SessionStatRow[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStatisticRow[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const userId = session?.user.id;
  const weekDays = useMemo(() => getWeekDays(new Date()), []);

  const loadRankingData = useCallback(async () => {
    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const weekStart = weekDays[0];
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    const statsStart = new Date();
    statsStart.setDate(statsStart.getDate() - 90);
    statsStart.setHours(0, 0, 0, 0);

    const [
      { data: sessionRows, error: sessionError },
      { data: statRows, error: statError },
      { data: leaderboardData, error: leaderboardError },
    ] = await Promise.all([
      supabase
        .from('sessions')
        .select('planned_start_time, planned_end_time, actual_end_time, block_count, tasks(title, task_types(name, color))')
        .eq('user_id', userId)
        .not('actual_end_time', 'is', null)
        .gte('planned_start_time', weekStart.toISOString())
        .lt('planned_start_time', weekEnd.toISOString()),
      supabase
        .from('daily_statistics')
        .select('stat_date, skipped_blocks')
        .eq('user_id', userId)
        .gte('stat_date', toDateInput(statsStart))
        .lte('stat_date', toDateInput(new Date()))
        .order('stat_date', { ascending: false }),
      supabase.rpc('get_streak_leaderboard', { limit_count: 50 }),
    ]);

    setLoading(false);

    if (sessionError || statError || leaderboardError) {
      Alert.alert('Ranking load failed', sessionError?.message ?? statError?.message ?? leaderboardError?.message);
      return;
    }

    setCompletedSessions((sessionRows ?? []) as SessionStatRow[]);
    setDailyStats((statRows ?? []) as DailyStatisticRow[]);
    setLeaderboardRows((leaderboardData ?? []) as LeaderboardRow[]);
  }, [userId, weekDays]);

  useEffect(() => {
    loadRankingData();
  }, [loadRankingData]);

  const weeklyDoneByDay = useMemo(() => {
    const statsByDate = new Map(dailyStats.map((item) => [item.stat_date, item]));
    return weekDays.map((day) => {
      const stat = statsByDate.get(toDateInput(day));
      return stat ? Number(stat.skipped_blocks ?? 0) === 0 : false;
    });
  }, [dailyStats, weekDays]);

  const completedCount = completedSessions.length;
  const deepWorkHours = completedSessions.reduce((total, item) => {
    const start = new Date(item.planned_start_time).getTime();
    const end = new Date(item.planned_end_time).getTime();
    return total + Math.max(end - start, 0);
  }, 0) / (60 * 60 * 1000);
  const currentStreak = useMemo(() => calculateSkippedBlockStreak(dailyStats, new Date()), [dailyStats]);
  const currentUserRank = leaderboardRows.find((row) => row.user_id === userId)?.rank ?? 0;
  const visibleLeaderboardRows = leaderboardRows.slice(0, 20);
  const weeklyBreakdown = useMemo(() => buildWeeklyBreakdown(completedSessions), [completedSessions]);

  if (loading) {
    return (
      <View style={[styles.loadingPanel, strictModeEnabled && styles.screenStrict]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 132 + insets.bottom }]} style={[styles.screen, strictModeEnabled && styles.screenStrict]}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>MISSION{'\n'}ACCOMPLISHED</Text>
      </View>

      <View style={styles.statGrid}>
        <StatBox label="THIS WEEK'S WORK" value={`${completedCount}`} suffix="SESSIONS DONE" />
        <StatBox label="DEEP WORK" value={deepWorkHours.toFixed(1)} suffix="HOURS" />
      </View>

      <View style={styles.streakRow}>
        <View style={styles.streakCard}>
          <View style={styles.iconTile}>
            <Ionicons color={colors.paper} name="flame" size={24} />
          </View>
          <Text style={styles.streakValue}>{currentStreak} DAYS</Text>
          <Text style={styles.streakLabel}>NO-SKIP STREAK</Text>
        </View>
        <View style={styles.rankGlyph}>
          <View style={styles.glyphSquare} />
          <View style={[styles.glyphSquare, styles.glyphLight]} />
          <View style={[styles.glyphSquare, styles.glyphWide]} />
        </View>
      </View>

      <View style={styles.weekCard}>
        <View style={styles.weekHeader}>
          <Text style={styles.weekTitle}>NO-SKIP WEEK</Text>
          <Text style={styles.weekRange}>{formatWeekRange(weekDays)}</Text>
        </View>
        <View style={styles.weekBlocks}>
          {weekDays.map((day, index) => (
            <View key={day.toISOString()} style={styles.weekDay}>
              <View style={[styles.weekMark, weeklyDoneByDay[index] && styles.weekMarkDone]}>
                {weeklyDoneByDay[index] ? <Text style={styles.weekMarkText}>X</Text> : null}
              </View>
              <Text style={styles.weekDayLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.breakdownCard}>
        <View style={styles.breakdownHeader}>
          <View>
            <Text style={styles.weekTitle}>WEEKLY BLOCK MIX</Text>
            <Text style={styles.breakdownMeta}>
              {weeklyBreakdown.totalBlocks} BLOCKS · {(weeklyBreakdown.totalBlocks * blockDurationMinutes / 60).toFixed(1)} HOURS
            </Text>
          </View>
          <Ionicons color={colors.text} name="analytics-outline" size={24} />
        </View>
        <BreakdownSection emptyLabel="NO CATEGORY BLOCKS YET" items={weeklyBreakdown.categories} title="CATEGORIES" />
        <BreakdownSection emptyLabel="NO TASK BLOCKS YET" items={weeklyBreakdown.tasks} title="TASKS" />
      </View>

      <Text style={styles.sectionTitle}>GLOBAL RANKING</Text>
      <View style={styles.rankingTable}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderText}>RANK</Text>
          <Text style={[styles.tableHeaderText, styles.tableUserHeader]}>USER</Text>
          <Text style={styles.tableHeaderText}>STREAK</Text>
        </View>
        {visibleLeaderboardRows.length === 0 ? (
          <View style={styles.emptyRankRow}>
            <Text style={styles.emptyRankText}>NO RANKING DATA YET</Text>
          </View>
        ) : null}
        {visibleLeaderboardRows.map((row) => (
          row.user_id === userId ? (
            <YouRankRow
              currentStreak={currentStreak}
              key={row.user_id}
              rank={row.rank}
              username={row.username}
            />
          ) : (
            <RankRow key={row.user_id} row={row} />
          )
        ))}
        {currentUserRank > 20 ? (
          <YouRankRow currentStreak={currentStreak} rank={currentUserRank} username="YOU" />
        ) : null}
      </View>
    </ScrollView>
  );
}

type BreakdownItem = {
  blocks: number;
  color: string;
  label: string;
  percent: number;
};

function BreakdownSection({ emptyLabel, items, title }: { emptyLabel: string; items: BreakdownItem[]; title: string }) {
  return (
    <View style={styles.breakdownSection}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      {items.length === 0 ? <Text style={styles.breakdownEmpty}>{emptyLabel}</Text> : null}
      {items.map((item) => (
        <View key={`${title}-${item.label}`} style={styles.breakdownRow}>
          <View style={styles.breakdownRowTop}>
            <Text numberOfLines={1} style={styles.breakdownLabel}>{item.label.toUpperCase()}</Text>
            <Text style={styles.breakdownPercent}>{Math.round(item.percent)}%</Text>
          </View>
          <View style={styles.breakdownTrack}>
            <View style={[styles.breakdownFill, { backgroundColor: item.color, width: `${Math.max(item.percent, 3)}%` }]} />
          </View>
          <Text style={styles.breakdownBlocks}>{item.blocks} BLOCKS</Text>
        </View>
      ))}
    </View>
  );
}

function StatBox({ label, suffix, value }: { label: string; suffix: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSuffix}>{suffix}</Text>
    </View>
  );
}

function RankRow({ row }: { row: LeaderboardRow }) {
  return (
    <View style={styles.rankRow}>
      <Text style={styles.rankNumber}>#{row.rank}</Text>
      <View style={styles.avatarBox}>
        <Ionicons color={colors.paper} name="person-outline" size={20} />
      </View>
      <Text style={styles.rankUser}>{row.username.toUpperCase()}</Text>
      <Text style={styles.rankPoints}>{row.streak_days}D</Text>
    </View>
  );
}

function YouRankRow({ currentStreak, rank, username }: { currentStreak: number; rank: number; username: string }) {
  return (
    <View style={styles.youRow}>
      <Text style={styles.youRank}>#{rank || '-'}</Text>
      <View style={styles.youAvatar}>
        <Ionicons color={colors.text} name="person" size={22} />
      </View>
      <View style={styles.youCopy}>
        <Text style={styles.youName}>YOU</Text>
        <Text style={styles.youMeta}>{username.toUpperCase()} · NO SKIPPED BLOCKS</Text>
      </View>
      <Text style={styles.youPoints}>{currentStreak}D</Text>
      <View style={styles.climbingTag}>
        <Text style={styles.climbingText}>CLIMBING!</Text>
      </View>
    </View>
  );
}

function getWeekDays(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + index);
    return next;
  });
}

function formatWeekRange(days: Date[]) {
  const first = days[0];
  const last = days[6];
  return `${formatShortDate(first)} - ${formatShortDate(last)}`;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }).toUpperCase();
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calculateSkippedBlockStreak(stats: DailyStatisticRow[], baseDate: Date) {
  const statsByDate = new Map(stats.map((item) => [item.stat_date, item]));
  let streak = 0;

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() - offset);
    const stat = statsByDate.get(toDateInput(date));

    if (!stat || Number(stat.skipped_blocks ?? 0) > 0) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function buildWeeklyBreakdown(sessions: SessionStatRow[]) {
  const totalBlocks = sessions.reduce((total, item) => total + Number(item.block_count ?? 0), 0);
  const categoryMap = new Map<string, { blocks: number; color: string; label: string }>();
  const taskMap = new Map<string, { blocks: number; color: string; label: string }>();

  sessions.forEach((item) => {
    const blocks = Number(item.block_count ?? 0);
    const task = firstOrValue(item.tasks);
    const taskType = firstOrValue(task?.task_types);
    const categoryLabel = taskType?.name ?? 'No category';
    const taskLabel = task?.title ?? 'Untitled task';
    const categoryColor = taskType?.color || colors.primary;
    const taskColor = taskType?.color || colors.surface;

    upsertBreakdown(categoryMap, categoryLabel, blocks, categoryColor);
    upsertBreakdown(taskMap, taskLabel, blocks, taskColor);
  });

  return {
    categories: toBreakdownItems(categoryMap, totalBlocks),
    tasks: toBreakdownItems(taskMap, totalBlocks).slice(0, 6),
    totalBlocks,
  };
}

function upsertBreakdown(map: Map<string, { blocks: number; color: string; label: string }>, label: string, blocks: number, color: string) {
  const current = map.get(label);

  if (current) {
    current.blocks += blocks;
    return;
  }

  map.set(label, { blocks, color, label });
}

function toBreakdownItems(map: Map<string, { blocks: number; color: string; label: string }>, totalBlocks: number): BreakdownItem[] {
  return [...map.values()]
    .filter((item) => item.blocks > 0)
    .sort((left, right) => right.blocks - left.blocks)
    .map((item) => ({
      ...item,
      percent: totalBlocks > 0 ? (item.blocks / totalBlocks) * 100 : 0,
    }));
}

function firstOrValue<Value>(value: Value | Value[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surfaceMuted,
    flex: 1,
  },
  screenStrict: {
    backgroundColor: colors.strictBg,
  },
  loadingPanel: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: 18,
  },
  hero: {
    backgroundColor: colors.text,
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    ...shadowHard,
  },
  heroTitle: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 32,
    lineHeight: 36,
  },
  statGrid: {
    borderColor: colors.border,
    borderWidth: 3,
    flexDirection: 'row',
    marginBottom: 28,
  },
  statBox: {
    backgroundColor: colors.paper,
    flex: 1,
    padding: 16,
  },
  statLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  statValue: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 30,
    lineHeight: 36,
    marginTop: 4,
  },
  statSuffix: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 26,
    lineHeight: 30,
  },
  streakRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 28,
  },
  streakCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    padding: 16,
    ...shadowHard,
  },
  iconTile: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  streakValue: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 48,
    lineHeight: 56,
    marginTop: 8,
  },
  streakLabel: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
  },
  rankGlyph: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderColor: colors.border,
    borderWidth: 3,
    gap: 0,
    justifyContent: 'center',
    width: 86,
  },
  glyphSquare: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 2,
    height: 28,
    width: 28,
  },
  glyphLight: {
    backgroundColor: colors.paper,
    marginLeft: 28,
    marginTop: -28,
  },
  glyphWide: {
    backgroundColor: colors.primary,
    marginTop: 0,
    width: 56,
  },
  weekCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 26,
    padding: 14,
    ...shadowHard,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  weekTitle: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
  },
  weekRange: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
  },
  weekBlocks: {
    flexDirection: 'row',
    gap: 0,
  },
  weekDay: {
    flex: 1,
  },
  weekMark: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
  },
  weekMarkDone: {
    backgroundColor: colors.primary,
  },
  weekMarkText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
  weekDayLabel: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    marginTop: 8,
    textAlign: 'center',
  },
  breakdownCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 26,
    padding: 14,
    ...shadowHard,
  },
  breakdownHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 12,
  },
  breakdownMeta: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 4,
  },
  breakdownSection: {
    marginTop: 12,
  },
  breakdownTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
    lineHeight: 30,
    marginBottom: 8,
  },
  breakdownEmpty: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
    paddingVertical: 8,
  },
  breakdownRow: {
    marginBottom: 12,
  },
  breakdownRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    color: colors.text,
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  breakdownPercent: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 20,
    lineHeight: 24,
  },
  breakdownTrack: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    height: 18,
    marginTop: 5,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
  },
  breakdownBlocks: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 36,
    lineHeight: 42,
    marginBottom: 10,
  },
  rankingTable: {
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 16,
    ...shadowHard,
  },
  tableHeader: {
    alignItems: 'center',
    backgroundColor: colors.text,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tableHeaderText: {
    color: colors.paper,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  tableUserHeader: {
    flex: 1,
  },
  rankRow: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderTopColor: colors.border,
    borderTopWidth: 2,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
  },
  rankNumber: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 25,
    width: 42,
  },
  avatarBox: {
    alignItems: 'center',
    backgroundColor: colors.text,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  rankUser: {
    color: colors.text,
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  rankPoints: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  emptyRankRow: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderTopColor: colors.border,
    borderTopWidth: 2,
    minHeight: 62,
    justifyContent: 'center',
    padding: 14,
  },
  emptyRankText: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  youRow: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: -10,
    minHeight: 76,
    paddingHorizontal: 14,
    position: 'relative',
    ...shadowHard,
  },
  youRank: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 29,
    width: 50,
  },
  youAvatar: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  youCopy: {
    flex: 1,
  },
  youName: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
    lineHeight: 28,
  },
  youMeta: {
    color: colors.surfaceMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
  },
  youPoints: {
    color: colors.paper,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  climbingTag: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    right: -10,
    top: -14,
    transform: [{ rotate: '10deg' }],
  },
  climbingText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 9,
  },
});
