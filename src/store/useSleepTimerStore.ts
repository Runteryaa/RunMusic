import { create } from 'zustand';
import TrackPlayer from 'react-native-track-player';
import { AppState, AppStateStatus } from 'react-native';

export type SleepTimerDuration = 15 | 30 | 45 | 60 | 'track' | 'custom';

interface SleepTimerState {
  isActive: boolean;
  endTime: number | null;
  durationOption: SleepTimerDuration | null;
  
  startTimer: (durationMinutes: number, option: SleepTimerDuration) => void;
  startTrackTimer: () => void;
  stopTimer: () => void;
}

export const useSleepTimerStore = create<SleepTimerState>((set, get) => ({
  isActive: false,
  endTime: null,
  durationOption: null,

  startTimer: (durationMinutes, option) => {
    const endTime = Date.now() + durationMinutes * 60 * 1000;
    set({ isActive: true, endTime, durationOption: option });
    startBackgroundChecker();
  },
  
  startTrackTimer: () => {
    set({ isActive: true, endTime: null, durationOption: 'track' });
    startBackgroundChecker();
  },

  stopTimer: () => {
    set({ isActive: false, endTime: null, durationOption: null });
    stopBackgroundChecker();
  }
}));

let intervalId: ReturnType<typeof setInterval> | null = null;
let isFadingOut = false;

const checkTimer = async () => {
  const state = useSleepTimerStore.getState();
  if (!state.isActive) {
    stopBackgroundChecker();
    return;
  }

  try {
    if (state.durationOption === 'track') {
      const progress = await TrackPlayer.getProgress();
      if (progress.duration > 0 && progress.position >= progress.duration - 1.5) {
        executeFadeOut();
      }
    } else if (state.endTime && Date.now() >= state.endTime) {
      executeFadeOut();
    }
  } catch (e) {
    console.warn('Sleep timer check failed', e);
  }
};

const executeFadeOut = async () => {
  if (isFadingOut) return;
  isFadingOut = true;
  useSleepTimerStore.getState().stopTimer();
  
  try {
    const currentVolume = await TrackPlayer.getVolume();
    let vol = currentVolume;
    
    // Simulate fade out over 2 seconds (10 steps)
    for (let i = 0; i < 10; i++) {
      vol = Math.max(0, vol - currentVolume / 10);
      await TrackPlayer.setVolume(vol);
      await new Promise(r => setTimeout(r, 200));
    }
    
    await TrackPlayer.pause();
    await TrackPlayer.setVolume(currentVolume); // restore volume
  } catch (e) {
    console.warn('Fade out failed', e);
    await TrackPlayer.pause();
  } finally {
    isFadingOut = false;
  }
};

const startBackgroundChecker = () => {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(checkTimer, 1000);
};

const stopBackgroundChecker = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

let appStateSub: any = null;
export const initSleepTimerService = () => {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      const state = useSleepTimerStore.getState();
      if (state.isActive) {
        startBackgroundChecker();
      }
    }
  });
};
