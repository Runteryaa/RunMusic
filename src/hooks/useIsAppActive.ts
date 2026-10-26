import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Current AppState value, shared by the activity/background helpers below. */
export function useAppState(): AppStateStatus {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setState);
    return () => subscription.remove();
  }, []);

  return state;
}

/**
 * Returns true while the app is in the foreground.
 *
 * Useful for throttling high-frequency UI work (progress polling, marquee
 * animations, etc.) while the app is in the background and nothing is visible.
 */
export function useIsAppActive(): boolean {
  return useAppState() === 'active';
}

/**
 * Android reports `background` only after the window is really hidden. We use
 * this (rather than `!active`) for the heavy player unmount so transient
 * `inactive` states such as a permission dialog do not tear down the UI.
 */
export function useIsAppBackgrounded(): boolean {
  return useAppState() === 'background';
}
