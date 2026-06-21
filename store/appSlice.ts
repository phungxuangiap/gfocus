import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AppMode = 'plan' | 'focus';
export type BottomTab = 'profile';

type AppState = {
  activeTab: BottomTab;
  mode: AppMode;
};

const initialState: AppState = {
  activeTab: 'profile',
  mode: 'plan',
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setActiveTab(state, action: PayloadAction<BottomTab>) {
      state.activeTab = action.payload;
    },
    setAppMode(state, action: PayloadAction<AppMode>) {
      state.mode = action.payload;
    },
    toggleAppMode(state) {
      state.mode = state.mode === 'plan' ? 'focus' : 'plan';
    },
  },
});

export const { setActiveTab, setAppMode, toggleAppMode } = appSlice.actions;
export const appReducer = appSlice.reducer;
