/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export interface PresetThemeColor {
  id: string;
  label: string;
  color: string;
}

export const PRESET_THEME_COLORS: PresetThemeColor[] = [
  { id: 'blue', label: 'Okyanus Mavisi', color: '#3b82f6' },
  { id: 'violet', label: 'Elektrik Menekşe', color: '#8b5cf6' },
  { id: 'emerald', label: 'Zümrüt Yeşili', color: '#10b981' },
  { id: 'cyan', label: 'Camgöbeği', color: '#06b6d4' },
  { id: 'amber', label: 'Kehribar', color: '#f59e0b' },
  { id: 'orange', label: 'Gün Batımı', color: '#f97316' },
  { id: 'rose', label: 'Gül Pembesi', color: '#ec4899' },
  { id: 'red', label: 'Yakut Kırmızısı', color: '#ef4444' },
  { id: 'lime', label: 'Fıstık Yeşili', color: '#84cc16' },
  { id: 'indigo', label: 'Gece Mavisi', color: '#6366f1' },
];
