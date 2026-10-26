import { useProgress } from 'react-native-track-player';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { useIsAppActive } from './useIsAppActive';

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
 *
 * @param enabled Set to false while the consuming screen is hidden/mounted but
 *   not visible. Updates then drop to five minutes so a retained fullscreen
 *   player does not keep re-rendering behind the mini player.
 */
export function useActiveProgress(enabled = true): ActiveProgress {
  const isRemote = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );

  const optimisticTrack = useOptimisticPlayerStore((s) => s.optimisticTrack);
  const isAppActive = useIsAppActive();

  // The player UI is not visible in the background, so there is no reason to
  // re-render the (large) fullscreen player 4 times per second. Besides
  // wasting CPU, that churn recreates legacy Animated interpolation nodes and
  // can exhaust the native animated node heap over long background sessions.
  // The player tree is also unmounted while backgrounded; the long interval is
  // a second line of defence for any other progress consumer.
  const updateInterval = !enabled
    ? 300000
    : isAppActive
    ? isRemote
      ? 3000
      : 250
    : 600000;
  const localProgress = useProgress(updateInterval);
  // `enabled=false` must also silence the remote interpolation stream. The
  // remote store updates `interpolatedPosition` continuously; subscribing to it
  // while the player is hidden would keep this hook re-rendering anyway.
  const interpolatedRemotePosition = useRemoteConnectStore((s) =>
    enabled ? s.interpolatedPosition : 0
  );
  const remoteDuration = useRemoteConnectStore(
    (s) => s.remoteState.activeTrack?.duration ?? 0
  );

  if (optimisticTrack) {
    return {
      position: 0,
      duration: optimisticTrack.duration || 0,
    };
  }

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
