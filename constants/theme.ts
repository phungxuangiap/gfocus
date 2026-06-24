export const colors = {
  bg: '#eeeeea',
  surface: '#b6b56b',
  surfaceMuted: '#cac999',
  paper: '#f2f1e8',
  primary: '#4b5c24',
  primaryDark: '#39451e',
  text: '#161712',
  textMuted: '#646452',
  textSoft: '#a8a99f',
  border: '#161712',
  danger: '#b91a1a',
  strictBg: '#e3c4c0',
  strictPaper: '#e7c6bf',
} as const;

export const shadowHard = {
  shadowColor: colors.border,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
} as const;
