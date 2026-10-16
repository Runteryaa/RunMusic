import { useProgress } from 'react-native-track-player';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';

export interface ActiveProgress {
  position: number;
  duration: number;
}

/**
 * Dedicated high-frequency (4Hz / 250ms) progress hook.
 *
 * IMPORTANT FOR PERFORMANCE:
 * Because this hook re-renders 4 times per second while playing,
 * it must ONLY be consumed by progress-sensitive UI components:
 * - SeekBar slider
 * - Time labels (current time / remaining time)
 * - Synchronized lyrics view (LyricsView)
 *
 * Buttons, list items, and modals must NEVER import this hook;
 * they should import `useActivePlayer()` instead.
 */
export function useActiveProgress(): ActiveProgress {
  const isRemote = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );

  const localProgress = useProgress(isRemote ? 3000 : 250);
  const interpolatedRemotePosition = useRemoteConnectStore((s) => s.interpolatedPosition);
  const remoteDuration = useRemoteConnectStore(
    (s) => s.remoteState.activeTrack?.duration ?? 0
  );

  if (isRemote) {
    return {
      position: interpolatedRemotePosition,
      duration: remoteDuration,
    };
  }

  return {
    position: localProgress.position,
    duration: localProgress.duration,
  };
}
