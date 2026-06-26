import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AppMode = 'plan' | 'focus';
export type BottomTab = 'calendar' | 'task' | 'ranking' | 'profile';
export type CalendarView = 'day' | 'week' | 'month';

export type FocusSessionEvent = {
  categoryName?: string | null;
  notificationId: string;
  notificationRecordId?: string;
  plannedEndTime?: string;
  plannedStartTime?: string;
  sessionId?: string;
  taskTitle?: string | null;
  title?: string;
  userId?: string;
};

type AppState = {
  activeTab: BottomTab;
  calendarView: CalendarView;
  focusSession: FocusSessionEvent | null;
  mode: AppMode;
  strictModeEnabled: boolean;
};

const initialState: AppState = {
  activeTab: 'calendar',
  calendarView: 'week',
  focusSession: null,
  mode: 'plan',
  strictModeEnabled: false,
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setActiveTab(state, action: PayloadAction<BottomTab>) {
      state.activeTab = action.payload;
    },
    setCalendarView(state, action: PayloadAction<CalendarView>) {
      state.calendarView = action.payload;
    },
    setFocusSession(state, action: PayloadAction<FocusSessionEvent | null>) {
      state.focusSession = action.payload;
    },
    setAppMode(state, action: PayloadAction<AppMode>) {
      state.mode = action.payload;
    },
    setStrictModeEnabled(state, action: PayloadAction<boolean>) {
      state.strictModeEnabled = action.payload;
    },
    toggleAppMode(state) {
      state.mode = state.mode === 'plan' ? 'focus' : 'plan';
    },
  },
});

export const { setActiveTab, setAppMode, setCalendarView, setFocusSession, setStrictModeEnabled, toggleAppMode } = appSlice.actions;
export const appReducer = appSlice.reducer;
