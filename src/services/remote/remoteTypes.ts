import type { RepeatMode } from 'react-native-track-player';
import type { LyricLine } from '../lyricsService';

export const RUNMUSIC_BEACON_PORT = 8944;
export const RUNMUSIC_TCP_PORT = 8945;
export const PROTOCOL_VERSION = 1;

export interface RemoteTrackSummary {
  id: string;
  title: string;
  artist: string;
  duration: number;
  hasArtwork: boolean;
}

export interface RemoteLyricsSummary {
  trackId?: string;
  lines: LyricLine[];
  source?: 'lrclib' | 'genius' | 'custom' | string | null;
  isSynced: boolean;
  plainLyrics?: string;
  syncedLyrics?: string | null;
  lyricsfile?: string | null;
  lrclibId?: string | number | null;
  geniusId?: string | number | null;
  geniusUrl?: string | null;
}

export interface DiscoveredHost {
  deviceId: string;
  deviceName: string;
  hostIp: string;
  port: number;
  lastSeen: number;
}

export interface TrustedClient {
  deviceId: string;
  deviceName: string;
  token: string;
  lastConnected: number;
}

// ----------------- PROTOCOL MESSAGES -----------------

// UDP Discovery
export interface BeaconMessage {
  type: 'RUNMUSIC_BEACON';
  version: number;
  deviceId: string;
  deviceName: string;
  port: number;
}

// Pairing
export interface PairInitMessage {
  type: 'PAIR_INIT';
  clientDeviceId: string;
  clientDeviceName: string;
  token?: string;
}

export interface PairChallengeRequiredMessage {
  type: 'PAIR_CHALLENGE_REQUIRED';
}

export interface PairVerifyMessage {
  type: 'PAIR_VERIFY';
  clientDeviceId: string;
  pin: string;
}

export interface PairSuccessMessage {
  type: 'PAIR_SUCCESS';
  token: string;
}

export interface PairFailureMessage {
  type: 'PAIR_FAILURE';
  reason: 'INVALID_PIN' | 'REJECTED' | 'UNAUTHORIZED';
}

// Host -> Client State Synchronization
export interface InitialStateMessage {
  type: 'INITIAL_STATE';
  activeTrack: RemoteTrackSummary | null;
  isPlaying: boolean;
  playbackRate: number;
  position: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  queue: RemoteTrackSummary[];
  upNext: RemoteTrackSummary[];
  lyrics: RemoteLyricsSummary | null;
}

export interface PositionSyncMessage {
  type: 'POSITION_SYNC';
  position: number;
  isPlaying: boolean;
  playbackRate: number;
}

export interface StateChangeMessage {
  type: 'STATE_CHANGE';
  isPlaying?: boolean;
  repeatMode?: RepeatMode;
  isShuffle?: boolean;
  playbackRate?: number;
}

export interface TrackChangeMessage {
  type: 'TRACK_CHANGE';
  track: RemoteTrackSummary | null;
  lyrics: RemoteLyricsSummary | null;
}

export interface LyricsSyncMessage {
  type: 'LYRICS_SYNC';
  trackId: string;
  lyrics: RemoteLyricsSummary | null;
}

export interface ActiveArtworkSyncMessage {
  type: 'ACTIVE_ARTWORK_SYNC';
  trackId: string;
  base64: string;
}

export interface QueueSyncMessage {
  type: 'QUEUE_SYNC';
  queue: RemoteTrackSummary[];
  upNext: RemoteTrackSummary[];
}

// RPC Library Browsing
export interface LibraryQueryMessage {
  type: 'LIBRARY_QUERY';
  requestId: string;
  search?: string;
  offset: number;
  limit: number;
}

export interface LibraryResultMessage {
  type: 'LIBRARY_RESULT';
  requestId: string;
  tracks: RemoteTrackSummary[];
  totalCount: number;
  hasMore: boolean;
}

// Client -> Host Commands
export interface CommandPlayMessage {
  type: 'COMMAND_PLAY';
}

export interface CommandPauseMessage {
  type: 'COMMAND_PAUSE';
}

export interface CommandSkipNextMessage {
  type: 'COMMAND_SKIP_NEXT';
}

export interface CommandSkipPreviousMessage {
  type: 'COMMAND_SKIP_PREVIOUS';
}

export interface CommandSeekMessage {
  type: 'COMMAND_SEEK';
  position: number;
}

export interface CommandSetShuffleMessage {
  type: 'COMMAND_SET_SHUFFLE';
  enabled: boolean;
}

export interface CommandSetRepeatMessage {
  type: 'COMMAND_SET_REPEAT';
  mode: RepeatMode;
}

export interface CommandQueueMoveMessage {
  type: 'COMMAND_QUEUE_MOVE';
  fromIndex: number;
  toIndex: number;
}

export interface CommandQueueRemoveMessage {
  type: 'COMMAND_QUEUE_REMOVE';
  trackId?: string;
  trackIndex?: number;
}

export interface CommandPlayTrackMessage {
  type: 'COMMAND_PLAY_TRACK';
  trackIndex: number;
}

export interface CommandPlayLibraryTrackMessage {
  type: 'COMMAND_PLAY_LIBRARY_TRACK';
  trackId: string;
}

export interface CommandSelectLyricsMessage {
  type: 'COMMAND_SELECT_LYRICS';
  trackId: string;
  candidate: {
    id: string;
    source: 'lrclib' | 'genius';
    trackName: string;
    artistName: string;
    hasSynced: boolean;
    hasWordSync?: boolean;
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
    lyricsfile?: string | null;
    geniusUrl?: string;
  };
}

export interface RequestArtworkMessage {
  type: 'REQUEST_ARTWORK';
  trackId: string;
}

export interface ArtworkResponseMessage {
  type: 'ARTWORK_RESPONSE';
  trackId: string;
  base64?: string | null;
}

export type RemoteMessage =
  | BeaconMessage
  | PairInitMessage
  | PairChallengeRequiredMessage
  | PairVerifyMessage
  | PairSuccessMessage
  | PairFailureMessage
  | InitialStateMessage
  | PositionSyncMessage
  | StateChangeMessage
  | TrackChangeMessage
  | LyricsSyncMessage
  | ActiveArtworkSyncMessage
  | QueueSyncMessage
  | LibraryQueryMessage
  | LibraryResultMessage
  | CommandPlayMessage
  | CommandPauseMessage
  | CommandSkipNextMessage
  | CommandSkipPreviousMessage
  | CommandSeekMessage
  | CommandSetShuffleMessage
  | CommandSetRepeatMessage
  | CommandQueueMoveMessage
  | CommandQueueRemoveMessage
  | CommandPlayTrackMessage
  | CommandPlayLibraryTrackMessage
  | CommandSelectLyricsMessage
  | RequestArtworkMessage
  | ArtworkResponseMessage;
