import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { RepeatMode } from 'react-native-track-player';
import type {
  DiscoveredHost,
  TrustedClient,
  RemoteTrackSummary,
  RemoteLyricsSummary,
  InitialStateMessage,
  PositionSyncMessage,
  StateChangeMessage,
  TrackChangeMessage,
  QueueSyncMessage,
} from '../services/remote/remoteTypes';
import type { ClientConnectionStatus } from '../services/remote/tcpClient';
import type { PendingPairChallenge } from '../services/remote/tcpHostServer';
import type { DiscoveredPeer } from '../services/remote/IRemoteTransport';

export interface RemotePlaybackState {
  activeTrack: RemoteTrackSummary | null;
  isPlaying: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  lyrics: RemoteLyricsSummary | null;
  queue: RemoteTrackSummary[];
  upNext: RemoteTrackSummary[];
  artworkUri: string | null;
}

interface RemoteConnectStoreState {
  // Persisted
  isServiceEnabled: boolean;
  customDeviceName: string;
  trustedDevices: TrustedClient[];
  lastConnectedHostIp: string | null;
  lastConnectedToken: string | null;

  // Runtime
  mode: 'idle' | 'host' | 'client';
  connectionStatus: ClientConnectionStatus;
  errorMessage: string | null;
  connectedDeviceName: string | null;
  discoveredHosts: DiscoveredHost[];
  discoveredBlePeers: DiscoveredPeer[];
  activeTransportTab: 'wifi' | 'ble';

  // Pairing Modals
  pendingPairChallenge: PendingPairChallenge | null;
  pendingPinVerification: ((pin: string) => void) | null;

  // Remote State
  remoteState: RemotePlaybackState;

  // Remote Library (Wi-Fi)
  remoteLibrary: RemoteTrackSummary[];
  isRemoteLibraryLoading: boolean;

  // Clock-Skew Immune Position Interpolation
  lastKnownPosition: number;
  clientSyncReceivedAt: number;
  interpolatedPosition: number;

  isRemoteConnected: () => boolean;
  setServiceEnabled: (enabled: boolean) => void;
  setCustomDeviceName: (name: string) => void;
  addTrustedDevice: (client: TrustedClient) => void;
  removeTrustedDevice: (deviceId: string) => void;
  setDiscoveredHosts: (hosts: DiscoveredHost[]) => void;
  setDiscoveredBlePeers: (peers: DiscoveredPeer[]) => void;
  setActiveTransportTab: (tab: 'wifi' | 'ble') => void;
  setMode: (mode: 'idle' | 'host' | 'client') => void;
  setConnectionStatus: (status: ClientConnectionStatus, error?: string) => void;
  setConnectedDeviceName: (name: string | null) => void;
  setPendingPairChallenge: (challenge: PendingPairChallenge | null) => void;
  setPendingPinVerification: (cb: ((pin: string) => void) | null) => void;

  // Sync setters
  setRemoteInitialState: (msg: InitialStateMessage) => void;
  setRemotePositionSync: (msg: PositionSyncMessage) => void;
  setRemoteTrackChange: (msg: TrackChangeMessage) => void;
  setRemoteStateChange: (msg: StateChangeMessage) => void;
  setRemoteQueueSync: (msg: QueueSyncMessage) => void;
  setRemoteArtworkUri: (uri: string | null) => void;
  setRemoteLyrics: (lyrics: RemoteLyricsSummary | null) => void;
  setRemoteLibrary: (tracks: RemoteTrackSummary[]) => void;
  setRemoteLibraryLoading: (loading: boolean) => void;

  // Optimistic setters
  setOptimisticIsPlaying: (playing: boolean) => void;
  setOptimisticPosition: (pos: number) => void;
  setOptimisticRepeatMode: (mode: RepeatMode) => void;
  setOptimisticShuffle: (shuffle: boolean) => void;

  resetRemoteState: () => void;
}

export const DEFAULT_DEVICE_NAME = Device.modelName || Device.deviceName || 'RunMusic Device';

const initialRemotePlaybackState: RemotePlaybackState = {
  activeTrack: null,
  isPlaying: false,
  playbackRate: 1.0,
  repeatMode: RepeatMode.Off,
  isShuffle: false,
  lyrics: null,
  queue: [],
  upNext: [],
  artworkUri: null,
};

let interpolationIntervalId: ReturnType<typeof setInterval> | null = null;

function ensureInterpolationRunning(get: () => RemoteConnectStoreState, set: (fn: (state: RemoteConnectStoreState) => Partial<RemoteConnectStoreState>) => void) {
  if (interpolationIntervalId !== null) return;

  interpolationIntervalId = setInterval(() => {
    const state = get();
    if (state.mode !== 'client' || state.connectionStatus !== 'connected' || !state.remoteState.isPlaying) {
      if (interpolationIntervalId !== null) {
        clearInterval(interpolationIntervalId);
        interpolationIntervalId = null;
      }
      return;
    }

    const duration = state.remoteState.activeTrack?.duration ?? 0;
    const now = Date.now();
    const elapsedSeconds = ((now - state.clientSyncReceivedAt) / 1000) * state.remoteState.playbackRate;
    const calculatedPos = Math.min(state.lastKnownPosition + elapsedSeconds, duration > 0 ? duration : 999999);

    set(() => ({
      interpolatedPosition: Math.max(0, calculatedPos),
    }));
  }, 250);
}

function stopInterpolation() {
  if (interpolationIntervalId !== null) {
    clearInterval(interpolationIntervalId);
    interpolationIntervalId = null;
  }
}

export const useRemoteConnectStore = create<RemoteConnectStoreState>()(
  persist(
    (set, get) => ({
      // Persisted defaults
      isServiceEnabled: false,
      customDeviceName: DEFAULT_DEVICE_NAME,
      trustedDevices: [],
      lastConnectedHostIp: null,
      lastConnectedToken: null,

      // Runtime defaults
      mode: 'idle',
      connectionStatus: 'idle',
      errorMessage: null,
      connectedDeviceName: null,
      discoveredHosts: [],
      discoveredBlePeers: [],
      activeTransportTab: 'wifi',
      pendingPairChallenge: null,
      pendingPinVerification: null,
      remoteState: { ...initialRemotePlaybackState },
      remoteLibrary: [],
      isRemoteLibraryLoading: false,

      lastKnownPosition: 0,
      clientSyncReceivedAt: 0,
      interpolatedPosition: 0,

      isRemoteConnected: () => {
        const s = get();
        return s.mode === 'client' && s.connectionStatus === 'connected';
      },
      setServiceEnabled: (enabled) => {
        set({ isServiceEnabled: enabled });
        if (!enabled) {
          set({ discoveredHosts: [], discoveredBlePeers: [] });
        }
      },
      setCustomDeviceName: (name) => set({ customDeviceName: name }),

      addTrustedDevice: (client) => {
        const filtered = get().trustedDevices.filter((c) => c.deviceId !== client.deviceId);
        set({ trustedDevices: [client, ...filtered] });
      },

      removeTrustedDevice: (deviceId) => {
        set({ trustedDevices: get().trustedDevices.filter((c) => c.deviceId !== deviceId) });
      },

      setDiscoveredHosts: (hosts) => set({ discoveredHosts: hosts }),
      setDiscoveredBlePeers: (peers) => set({ discoveredBlePeers: peers }),
      setActiveTransportTab: (tab) => set({ activeTransportTab: tab }),
      setMode: (mode) => set({ mode }),
      setConnectedDeviceName: (name) => set({ connectedDeviceName: name }),

      setConnectionStatus: (status, error) => {
        set({ connectionStatus: status, errorMessage: error || null });
        if (status !== 'connected') {
          stopInterpolation();
        }
      },

      setPendingPairChallenge: (challenge) => set({ pendingPairChallenge: challenge }),
      setPendingPinVerification: (cb) => set({ pendingPinVerification: cb }),

      setRemoteInitialState: (msg) => {
        const now = Date.now();
        set({
          remoteState: {
            activeTrack: msg.activeTrack,
            isPlaying: msg.isPlaying,
            playbackRate: msg.playbackRate || 1.0,
            repeatMode: msg.repeatMode,
            isShuffle: msg.isShuffle,
            lyrics: msg.lyrics,
            queue: msg.queue,
            upNext: msg.upNext,
            artworkUri: null,
          },
          lastKnownPosition: msg.position,
          clientSyncReceivedAt: now,
          interpolatedPosition: msg.position,
        });

        if (msg.isPlaying) {
          ensureInterpolationRunning(get, set);
        } else {
          stopInterpolation();
        }
      },

      setRemotePositionSync: (msg) => {
        const now = Date.now();
        const currentInterp = get().interpolatedPosition;
        // If drift is large (> 1.2s), snap immediately (scrubbing/seek). Otherwise smooth update.
        const shouldSnap = Math.abs(currentInterp - msg.position) > 1.2;

        set((state) => {
          const currentTrack = state.remoteState.activeTrack;
          const updatedTrack =
            currentTrack && msg.duration && msg.duration > 0 && currentTrack.duration !== msg.duration
              ? { ...currentTrack, duration: msg.duration }
              : currentTrack;

          return {
            lastKnownPosition: msg.position,
            clientSyncReceivedAt: now,
            interpolatedPosition: shouldSnap ? msg.position : state.interpolatedPosition,
            remoteState: {
              ...state.remoteState,
              activeTrack: updatedTrack,
              isPlaying: msg.isPlaying,
              playbackRate: msg.playbackRate || 1.0,
            },
          };
        });

        if (msg.isPlaying) {
          ensureInterpolationRunning(get, set);
        } else {
          stopInterpolation();
        }
      },

      setRemoteTrackChange: (msg) => {
        const now = Date.now();
        const currentActive = get().remoteState.activeTrack;
        const isSameTrack =
          (!!msg.track?.id && msg.track.id === currentActive?.id) ||
          (!!msg.track?.title && msg.track.title === currentActive?.title && msg.track.artist === currentActive?.artist);
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            activeTrack: msg.track,
            lyrics: isSameTrack ? (msg.lyrics ?? state.remoteState.lyrics) : (msg.lyrics ?? null),
            artworkUri: isSameTrack ? state.remoteState.artworkUri : null,
          },
          lastKnownPosition: 0,
          clientSyncReceivedAt: now,
          interpolatedPosition: 0,
        }));
      },

      setRemoteStateChange: (msg) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            isPlaying: msg.isPlaying !== undefined ? msg.isPlaying : state.remoteState.isPlaying,
            repeatMode: msg.repeatMode !== undefined ? msg.repeatMode : state.remoteState.repeatMode,
            isShuffle: msg.isShuffle !== undefined ? msg.isShuffle : state.remoteState.isShuffle,
            playbackRate: msg.playbackRate !== undefined ? msg.playbackRate : state.remoteState.playbackRate,
          },
        }));

        if (msg.isPlaying !== undefined) {
          if (msg.isPlaying) {
            ensureInterpolationRunning(get, set);
          } else {
            stopInterpolation();
          }
        }
      },

      setRemoteQueueSync: (msg) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            queue: msg.queue,
            upNext: msg.upNext,
          },
        }));
      },

      setRemoteArtworkUri: (uri) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            artworkUri: uri,
          },
        }));
      },

      setRemoteLyrics: (lyrics) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            lyrics,
          },
        }));
      },

      setRemoteLibrary: (tracks) => set({ remoteLibrary: tracks }),
      setRemoteLibraryLoading: (loading) => set({ isRemoteLibraryLoading: loading }),

      // Optimistic actions for instant UI feedback
      setOptimisticIsPlaying: (playing) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            isPlaying: playing,
          },
        }));
        if (playing) {
          ensureInterpolationRunning(get, set);
        } else {
          stopInterpolation();
        }
      },

      setOptimisticPosition: (pos) => {
        const now = Date.now();
        set({
          lastKnownPosition: pos,
          clientSyncReceivedAt: now,
          interpolatedPosition: pos,
        });
      },

      setOptimisticRepeatMode: (mode) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            repeatMode: mode,
          },
        }));
      },

      setOptimisticShuffle: (shuffle) => {
        set((state) => ({
          remoteState: {
            ...state.remoteState,
            isShuffle: shuffle,
          },
        }));
      },

      resetRemoteState: () => {
        stopInterpolation();
        set({
          mode: 'idle',
          connectionStatus: 'idle',
          errorMessage: null,
          connectedDeviceName: null,
          remoteState: { ...initialRemotePlaybackState },
          remoteLibrary: [],
          isRemoteLibraryLoading: false,
          lastKnownPosition: 0,
          clientSyncReceivedAt: 0,
          interpolatedPosition: 0,
          pendingPairChallenge: null,
          pendingPinVerification: null,
        });
      },
    }),
    {
      name: 'runmusic_remote_connect_storage',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (!persistedState) return persistedState;
        if (version < 2 || persistedState.isServiceEnabled === undefined) {
          persistedState.isServiceEnabled = false;
        }
        return persistedState;
      },
      partialize: (state) => ({
        isServiceEnabled: state.isServiceEnabled,
        customDeviceName: state.customDeviceName.trim() || DEFAULT_DEVICE_NAME,
        trustedDevices: state.trustedDevices,
        lastConnectedHostIp: state.lastConnectedHostIp,
        lastConnectedToken: state.lastConnectedToken,
      }),
    }
  )
);
