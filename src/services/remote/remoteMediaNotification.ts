import TrackPlayer, { RepeatMode, State } from 'react-native-track-player';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import type { RemoteTrackSummary } from './remoteTypes';
import { useThemeStore } from '../../store/useThemeStore';
import { restoreQueueIfNeeded } from '../playerBootstrap';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

class RemoteMediaNotificationService {
  private silentWavPath: string | null = null;
  private currentTrackId: string | null = null;
  private currentArtworkUri: string | null = null;
  private isShadowActive = false;

  /**
   * Generates a 5-second PCM 8000Hz 8-bit mono silent WAV file in cacheDirectory if not already present.
   */
  public async ensureSilentAudioFile(): Promise<string> {
    if (this.silentWavPath) {
      const exists = await FileSystem.getInfoAsync(this.silentWavPath);
      if (exists.exists) return this.silentWavPath;
    }

    const path = `${FileSystem.cacheDirectory}remote_silent.wav`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      this.silentWavPath = path;
      return path;
    }

    const sampleRate = 8000;
    const numChannels = 1;
    const bitsPerSample = 8;
    const durationSec = 5;
    const dataSize = sampleRate * numChannels * (bitsPerSample / 8) * durationSec; // 40,000 bytes
    const chunkSize = 36 + dataSize;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    // 0x80 is silence in 8-bit unsigned PCM
    const data = Buffer.alloc(dataSize, 0x80);
    const fullWav = Buffer.concat([header, data]);

    await FileSystem.writeAsStringAsync(path, fullWav.toString('base64'), {
      encoding: FileSystem.EncodingType.Base64,
    });

    this.silentWavPath = path;
    return path;
  }

  /**
   * Synchronizes the host's playing track into the client's local TrackPlayer at volume 0
   * so Android displays the native notification, lock screen controls, and widget.
   */
  public async syncRemoteTrackToLocalPlayer(
    track: RemoteTrackSummary | null,
    isPlaying: boolean,
    artworkUri?: string | null
  ): Promise<void> {
    if (!track) {
      await this.cleanupRemoteMediaNotification();
      return;
    }

    try {
      this.isShadowActive = true;
      this.currentTrackId = track.id;
      if (artworkUri !== undefined) {
        this.currentArtworkUri = artworkUri;
      }

      const silentUri = await this.ensureSilentAudioFile();

      // Ensure zero volume on client device
      await TrackPlayer.setVolume(0);

      // Reset and load the remote track metadata with silent audio stream
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: `remote_${track.id}`,
        url: silentUri,
        title: track.title,
        artist: track.artist,
        artwork: this.currentArtworkUri || undefined,
        duration: track.duration,
      });

      // Loop silent stream so it never ends or disappears
      await TrackPlayer.setRepeatMode(RepeatMode.Track);
      await TrackPlayer.setVolume(0);

      if (isPlaying) {
        await TrackPlayer.play();
      } else {
        await TrackPlayer.pause();
      }

      // Update home screen widget on client device
      this.updateWidget(track.title, track.artist, this.currentArtworkUri, isPlaying);
    } catch (e) {
      console.warn('[RemoteMediaNotification] Failed to sync remote track:', e);
    }
  }

  /**
   * Updates playback state (play/pause) on client's local shadow player.
   */
  public async syncRemotePlaybackState(isPlaying: boolean): Promise<void> {
    if (!this.isShadowActive) return;

    try {
      await TrackPlayer.setVolume(0);
      if (isPlaying) {
        await TrackPlayer.play();
      } else {
        await TrackPlayer.pause();
      }

      const active = await TrackPlayer.getActiveTrack();
      if (active) {
        this.updateWidget(
          active.title || '',
          active.artist || '',
          this.currentArtworkUri,
          isPlaying
        );
      }
    } catch (e) {
      console.warn('[RemoteMediaNotification] Failed to sync playback state:', e);
    }
  }

  /**
   * Updates artwork for currently displayed remote notification.
   */
  public async syncRemoteArtwork(artworkLocalUri: string): Promise<void> {
    if (!this.isShadowActive) return;

    try {
      this.currentArtworkUri = artworkLocalUri;
      await TrackPlayer.updateMetadataForTrack(0, {
        artwork: artworkLocalUri,
      });

      const active = await TrackPlayer.getActiveTrack();
      const state = await TrackPlayer.getPlaybackState();
      this.updateWidget(
        active?.title || '',
        active?.artist || '',
        artworkLocalUri,
        state.state === State.Playing
      );
    } catch (e) {
      console.warn('[RemoteMediaNotification] Failed to sync artwork:', e);
    }
  }

  /**
   * Cleans up shadow player when client disconnects and restores local playback state.
   */
  public async cleanupRemoteMediaNotification(): Promise<void> {
    if (!this.isShadowActive) return;

    try {
      this.isShadowActive = false;
      this.currentTrackId = null;
      this.currentArtworkUri = null;

      await TrackPlayer.reset();
      await TrackPlayer.setVolume(1);

      // Restore user's local music queue and playback state
      await restoreQueueIfNeeded();
    } catch (e) {
      console.warn('[RemoteMediaNotification] Cleanup error:', e);
    }
  }

  private updateWidget(
    title: string,
    artist: string,
    artworkUri: string | null,
    isPlaying: boolean
  ): void {
    if (MusicWidgetModule && MusicWidgetModule.updateWidget) {
      try {
        const theme = useThemeStore.getState().theme;
        MusicWidgetModule.updateWidget(
          title || 'RunMusic',
          artist || 'Müzik Çalar',
          artworkUri || null,
          isPlaying,
          theme.primary || '#212121'
        );
      } catch {
        // Ignored
      }
    }
  }
}

export const remoteMediaNotification = new RemoteMediaNotificationService();
