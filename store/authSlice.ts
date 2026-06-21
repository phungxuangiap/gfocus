import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Session } from '@supabase/supabase-js';

export type AuthMode = 'sign-in' | 'sign-up';

type AuthState = {
  booting: boolean;
  loading: boolean;
  mode: AuthMode;
  session: Session | null;
  signupSuccessVisible: boolean;
  suppressSignUpSession: boolean;
};

const initialState: AuthState = {
  booting: true,
  loading: false,
  mode: 'sign-in',
  session: null,
  signupSuccessVisible: false,
  suppressSignUpSession: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setBooting(state, action: PayloadAction<boolean>) {
      state.booting = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setMode(state, action: PayloadAction<AuthMode>) {
      state.mode = action.payload;
    },
    setSession(state, action: PayloadAction<Session | null>) {
      state.session = action.payload;
    },
    beginSignUpWithoutAutoLogin(state) {
      state.suppressSignUpSession = true;
    },
    endSignUpWithoutAutoLogin(state) {
      state.suppressSignUpSession = false;
    },
    showSignupSuccess(state) {
      state.signupSuccessVisible = true;
    },
    hideSignupSuccess(state) {
      state.signupSuccessVisible = false;
    },
  },
});

export const {
  beginSignUpWithoutAutoLogin,
  endSignUpWithoutAutoLogin,
  hideSignupSuccess,
  setBooting,
  setLoading,
  setMode,
  setSession,
  showSignupSuccess,
} = authSlice.actions;

export const authReducer = authSlice.reducer;
