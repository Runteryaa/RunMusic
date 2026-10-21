import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Returns true while the app is in the foreground.
 *
 * Useful for throttling high-frequency UI work (progress polling, marquee
 * animations, etc.) while the app is in the background and nothing is visible.
 */
export function useIsAppActive(): boolean {
  const [isActive, setIsActive] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsActive(state === 'active');
    });

    return () => subscription.remove();
  }, []);

  return isActive;
}
