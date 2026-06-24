import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AppMode = 'plan' | 'focus';
export type BottomTab = 'calendar' | 'task' | 'profile';
export type CalendarView = 'day' | 'week' | 'month';

type AppState = {
  activeTab: BottomTab;
  calendarView: CalendarView;
  mode: AppMode;
  strictModeEnabled: boolean;
};

const initialState: AppState = {
  activeTab: 'profile',
  calendarView: 'week',
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

export const { setActiveTab, setAppMode, setCalendarView, setStrictModeEnabled, toggleAppMode } = appSlice.actions;
export const appReducer = appSlice.reducer;
