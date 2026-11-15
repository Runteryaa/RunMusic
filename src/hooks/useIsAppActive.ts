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

/**
 * Uzun süredir arka planda mıyız?
 *
 * Oynatıcı ağacını (mini oynatıcı + tam ekran oynatıcı + tüm Animated
 * düğümleri) tamamen sökmek bellek için doğru, ancak **kısa** arka plan
 * gezilerinde yıkıcı: paylaşım sayfası, sistem izin penceresi veya galeri
 * seçicisi açıldığında uygulama `background` durumuna geçiyor ve ağaç hemen
 * sökülürse ekran siyaha düşüp oynatıcı yeniden kuruluyordu.
 *
 * Bu kanca yalnızca `delayMs` boyunca arka planda kalındığında `true` döner;
 * kısa dönüşlerde ağaç yerinde kalır.
 */
export function useIsAppLongBackgrounded(delayMs = 8000): boolean {
  const isBackground = useAppState() === 'background';
  const [longBackgrounded, setLongBackgrounded] = useState(false);

  useEffect(() => {
    if (!isBackground) {
      setLongBackgrounded(false);
      return;
    }
    const timer = setTimeout(() => setLongBackgrounded(true), delayMs);
    return () => clearTimeout(timer);
  }, [isBackground, delayMs]);

  return longBackgrounded;
}
