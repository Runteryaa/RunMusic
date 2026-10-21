import { NativeModules, Platform } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import {
  EQUALIZER_BAND_COUNT,
  computeReplayGainDb,
  getTotalGainDb,
  type AudioEffectsSettings,
} from './audioEffectsSettings';
import { readReplayGainTagsFromFile } from './replayGainReader';
import type { ReplayGainTags } from './replayGainTags';
import { toPlayableUri } from './playbackUri';

interface NativeAudioEffectsModule {
  setAudioEffects?: (payload: {
    equalizerEnabled: boolean;
    bands: number[];
    preampDb: number;
    replayGainDb: number;
  }) => Promise<void>;
}

interface AudioEffectsTrack {
  id?: string;
  url?: string;
}

function getNativeAudioEffectsModule(): NativeAudioEffectsModule | undefined {
  return NativeModules.TrackPlayerModule as NativeAudioEffectsModule | undefined;
}

let initialized = false;
let currentReplayGainDb = 0;
let currentTrackKey: string | null = null;
let trackSequence = 0;
let fallbackVolumeApplied = false;
let applyTimer: ReturnType<typeof setTimeout> | null = null;
const replayGainCache = new Map<string, ReplayGainTags | null>();
const MAX_CACHE_ENTRIES = 256;

/** Android'de yeni native APK'daki `setAudioEffects` köprüsü var mı? */
export function isNativeAudioEffectsAvailable(): boolean {
  return (
    Platform.OS === 'android' &&
    typeof getNativeAudioEffectsModule()?.setAudioEffects === 'function'
  );
}

function getSettings(): AudioEffectsSettings {
  return useStore.getState().preferences.audioEffects;
}

function effectsAreActive(settings: AudioEffectsSettings): boolean {
  return settings.equalizerEnabled || settings.replayGainMode !== 'off';
}

function cacheTags(key: string, tags: ReplayGainTags | null): void {
  if (replayGainCache.size >= MAX_CACHE_ENTRIES && !replayGainCache.has(key)) {
    const oldest = replayGainCache.keys().next().value;
    if (oldest !== undefined) replayGainCache.delete(oldest);
  }
  replayGainCache.set(key, tags);
}

function trackCacheKey(track: AudioEffectsTrack | null | undefined): string {
  const id = String(track?.id ?? '').trim();
  const url = String(track?.url ?? '').trim();
  return id || url;
}

function resolveTrackUri(track: AudioEffectsTrack): string {
  const id = String(track.id ?? '').trim();
  const url = String(track.url ?? '').trim();
  const state = useStore.getState();

  let asset = id ? state.allAssets.find((item) => String(item.id) === id) : undefined;
  if (!asset && id) {
    asset = state.library.find((item) => String(item.id) === id);
  }
  if (!asset && url) {
    asset =
      state.library.find((item) => item.uri === url) ||
      state.allAssets.find((item) => item.uri === url);
  }

  return toPlayableUri(asset?.uri || url);
}

async function getTagsForTrack(track: AudioEffectsTrack): Promise<ReplayGainTags | null> {
  const key = trackCacheKey(track);
  if (!key) return null;
  if (replayGainCache.has(key)) return replayGainCache.get(key) ?? null;

  const uri = resolveTrackUri(track);
  const tags = await readReplayGainTagsFromFile(uri);
  cacheTags(key, tags);
  return tags;
}

function buildNativePayload(
  settings: AudioEffectsSettings,
  replayGainDb: number
): {
  equalizerEnabled: boolean;
  bands: number[];
  preampDb: number;
  replayGainDb: number;
} {
  const bands = settings.equalizerBands.slice(0, EQUALIZER_BAND_COUNT);
  while (bands.length < EQUALIZER_BAND_COUNT) bands.push(0);
  return {
    equalizerEnabled: settings.equalizerEnabled,
    bands,
    // Efektler tamamen kapalıyken preamp da uygulanmamalı.
    preampDb: effectsAreActive(settings) ? settings.preampDb : 0,
    replayGainDb: Number.isFinite(replayGainDb) ? replayGainDb : 0,
  };
}

async function applyFallbackVolume(
  settings: AudioEffectsSettings,
  replayGainDb: number
): Promise<void> {
  // Native EQ köprüsü olmayan platformlarda (iOS veya eski APK) en azından
  // ReplayGain zayıflatmasını uygula. Pozitif kazanç TrackPlayer volume ile
  // güvenilir biçimde artırılamadığı için 0 dB'de sınırlanır.
  const totalGainDb = Math.min(0, getTotalGainDb(settings, replayGainDb));
  const volume = Math.max(0, Math.min(1, Math.pow(10, totalGainDb / 20)));
  try {
    await TrackPlayer.setVolume(volume);
    fallbackVolumeApplied = volume < 0.999;
  } catch {
    // Player henüz hazır değil; sonraki olayda tekrar denenir.
  }
}

/**
 * Kayıtlı EQ/preamp/ReplayGain ayarlarını yerel oynatıcıya uygular.
 * `replayGainDb` çağıran tarafından hesaplanır; verilmezse son değer kullanılır.
 */
export async function applyAudioEffectsSettings(
  replayGainDb: number = currentReplayGainDb
): Promise<void> {
  const settings = getSettings();
  const gain = Number.isFinite(replayGainDb) ? replayGainDb : 0;

  if (isNativeAudioEffectsAvailable()) {
    try {
      await getNativeAudioEffectsModule()?.setAudioEffects?.(buildNativePayload(settings, gain));
      if (fallbackVolumeApplied) {
        // Native katman kazancı devraldı; JS volume'u nötrle.
        await TrackPlayer.setVolume(1).catch(() => {});
        fallbackVolumeApplied = false;
      }
      return;
    } catch {
      // Servis henüz bağlı değil veya eski APK; aşağıdaki yedeğe düş.
    }
  }

  await applyFallbackVolume(settings, gain);
}

/**
 * Aktif parçanın ReplayGain etiketlerini okur ve kazancı uygular.
 * Parça değişimlerinde `service.ts` tarafından çağrılır.
 */
export async function syncReplayGainForTrack(
  track: AudioEffectsTrack | null | undefined
): Promise<void> {
  const sequence = ++trackSequence;
  const settings = getSettings();

  if (!track || settings.replayGainMode === 'off') {
    currentTrackKey = null;
    currentReplayGainDb = 0;
    await applyAudioEffectsSettings(0);
    return;
  }

  const key = trackCacheKey(track);
  if (!key) {
    currentTrackKey = null;
    currentReplayGainDb = 0;
    await applyAudioEffectsSettings(0);
    return;
  }

  currentTrackKey = key;
  const tags = await getTagsForTrack(track);
  if (sequence !== trackSequence || currentTrackKey !== key) return;

  const gain = computeReplayGainDb(tags, getSettings());
  currentReplayGainDb = gain;
  await applyAudioEffectsSettings(gain);
}

/**
 * Ayar ekranından mod/kırpma koruması değiştiğinde, dosyayı yeniden okumadan
 * önbellekteki etiketlerle kazancı yeniden hesaplar.
 */
export async function refreshReplayGainForActiveTrack(): Promise<void> {
  const sequence = ++trackSequence;
  const settings = getSettings();
  const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
  if (sequence !== trackSequence) return;

  if (!activeTrack || settings.replayGainMode === 'off') {
    currentTrackKey = null;
    currentReplayGainDb = 0;
    await applyAudioEffectsSettings(0);
    return;
  }

  const key = trackCacheKey(activeTrack);
  if (!key) return;

  currentTrackKey = key;
  if (!replayGainCache.has(key)) {
    // Önbellekte yoksa normal okuma yoluna düş.
    await syncReplayGainForTrack(activeTrack);
    return;
  }

  const tags = replayGainCache.get(key) ?? null;
  const gain = computeReplayGainDb(tags, getSettings());
  currentReplayGainDb = gain;
  await applyAudioEffectsSettings(gain);
}

/**
 * Uygulama açılışında bir kez çağrılır. Store aboneliği sayesinde ayar
 * değişiklikleri (ve persist hidrasyonu) anında uygulanır.
 */
export function initAudioEffects(): void {
  if (initialized) return;
  initialized = true;

  let lastSettings = useStore.getState().preferences.audioEffects;

  useStore.subscribe((state) => {
    const nextSettings = state.preferences.audioEffects;
    if (nextSettings === lastSettings) return;

    const previous = lastSettings;
    lastSettings = nextSettings;

    const replayGainChanged =
      previous.replayGainMode !== nextSettings.replayGainMode ||
      previous.preventClipping !== nextSettings.preventClipping;

    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }

    if (replayGainChanged) {
      void refreshReplayGainForActiveTrack();
    } else {
      // Kaydırıcı sürüklenirken her pikselde native köprü çağırmamak için
      // kısa bir gecikmeyle son değeri uygula.
      applyTimer = setTimeout(() => {
        applyTimer = null;
        void applyAudioEffectsSettings(currentReplayGainDb);
      }, 60);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
    if (event.state === State.Playing || event.state === State.Buffering) {
      // Native servis yeni bağlanmış olabilir; ayarları tekrar dene.
      void applyAudioEffectsSettings(currentReplayGainDb);
    }
  });

  void applyAudioEffectsSettings(currentReplayGainDb);
  void refreshReplayGainForActiveTrack();
}
