import type { ReplayGainTags } from './replayGainTags';

/**
 * Audio effects (equalizer + ReplayGain) ayarlarının SAF (native'siz) tanımı.
 *
 * Bu modül bilinçli olarak React Native / Expo import ETMEZ; böylece hem
 * kalıcı depolama migrasyonu hem de Node doğrulama scriptleri tarafından
 * doğrudan kullanılabilir.
 */

export type ReplayGainMode = 'off' | 'track' | 'album';

/** UI'daki beş sabit bant. Cihazın gerçek bantlarına en yakınları eşlenir. */
export const EQUALIZER_BAND_FREQUENCIES = [60, 230, 910, 3600, 14000] as const;

export const EQUALIZER_BAND_COUNT = EQUALIZER_BAND_FREQUENCIES.length;

export const EQUALIZER_MIN_DB = -12;
export const EQUALIZER_MAX_DB = 12;

/** Ortak preamp: hem EQ hem ReplayGain kazancına eklenir. */
export const PREAMP_MIN_DB = -12;
export const PREAMP_MAX_DB = 6;

/** ReplayGain etiketi + preamp birleşiminin mutlak sınırları. */
export const REPLAY_GAIN_MIN_DB = -24;
export const REPLAY_GAIN_MAX_DB = 12;

export interface AudioEffectsSettings {
  equalizerEnabled: boolean;
  /** Beş sabit bandın dB kazançları (EQUALIZER_BAND_FREQUENCIES sırasıyla). */
  equalizerBands: number[];
  replayGainMode: ReplayGainMode;
  /** Ortak preamp (dB). Negatif değer baş payı (headroom) oluşturur. */
  preampDb: number;
  /** ReplayGain peak değeri varsa kırpılmayı önlemek için kazancı sınırla. */
  preventClipping: boolean;
}

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsSettings = {
  equalizerEnabled: false,
  equalizerBands: EQUALIZER_BAND_FREQUENCIES.map(() => 0),
  replayGainMode: 'off',
  preampDb: 0,
  preventClipping: true,
};

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0.1 dB hassasiyetle yuvarlar; -0 değerini 0'a çevirir. */
export function roundGain(value: number): number {
  return Math.round(value * 10) / 10 || 0;
}

export function normalizeEqualizerBands(input: unknown): number[] {
  const source = Array.isArray(input) ? input : [];
  return EQUALIZER_BAND_FREQUENCIES.map((_, index) => {
    const raw = source[index];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
    return roundGain(clampNumber(raw, EQUALIZER_MIN_DB, EQUALIZER_MAX_DB));
  });
}

export function normalizeReplayGainMode(input: unknown): ReplayGainMode {
  return input === 'track' || input === 'album' || input === 'off' ? input : 'off';
}

/**
 * Eski/bozuk kayıtları güvenli hale getirir. Eksik alanlar varsayılana döner,
 * sayısal değerler makul aralığa sıkıştırılır. İdempotenttir.
 */
export function normalizeAudioEffects(input: unknown): AudioEffectsSettings {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const rawPreamp = source.preampDb;
  const preampDb =
    typeof rawPreamp === 'number' && Number.isFinite(rawPreamp)
      ? roundGain(clampNumber(rawPreamp, PREAMP_MIN_DB, PREAMP_MAX_DB))
      : DEFAULT_AUDIO_EFFECTS.preampDb;

  return {
    equalizerEnabled:
      typeof source.equalizerEnabled === 'boolean'
        ? source.equalizerEnabled
        : DEFAULT_AUDIO_EFFECTS.equalizerEnabled,
    equalizerBands: normalizeEqualizerBands(source.equalizerBands),
    replayGainMode: normalizeReplayGainMode(source.replayGainMode),
    preampDb,
    preventClipping:
      typeof source.preventClipping === 'boolean'
        ? source.preventClipping
        : DEFAULT_AUDIO_EFFECTS.preventClipping,
  };
}

/** Ayar nesnesinin kopyasını üretir (dizi paylaşımını önler). */
export function cloneAudioEffects(settings: AudioEffectsSettings): AudioEffectsSettings {
  return {
    ...settings,
    equalizerBands: [...settings.equalizerBands],
  };
}

/**
 * Etiketlerden ve kullanıcı tercihlerinden parça için uygulanacak ReplayGain
 * kazancını hesaplar. Preamp BURAYA dahil edilmez; native katman preamp'ı
 * ayrıca ekler.
 *
 * - `track` modu: track gain/peak, yoksa album değerlerine düşer.
 * - `album` modu: album gain/peak, yoksa track değerlerine düşer.
 * - Peak varsa ve kırpma koruması açıksa kazanç `-20*log10(peak)` ile sınırlanır.
 */
export function computeReplayGainDb(
  tags: ReplayGainTags | null | undefined,
  settings: AudioEffectsSettings
): number {
  if (settings.replayGainMode === 'off' || !tags) return 0;

  const useAlbum = settings.replayGainMode === 'album';
  const gain = useAlbum
    ? tags.albumGainDb ?? tags.trackGainDb
    : tags.trackGainDb ?? tags.albumGainDb;

  if (typeof gain !== 'number' || !Number.isFinite(gain)) return 0;

  const peak = useAlbum
    ? tags.albumPeak ?? tags.trackPeak
    : tags.trackPeak ?? tags.albumPeak;

  let result = gain;
  if (settings.preventClipping && typeof peak === 'number' && Number.isFinite(peak) && peak > 0) {
    // peak tam ölçeğe göre normalize edilmiştir (1.0 = 0 dBFS).
    const maxGainDb = -20 * Math.log10(peak);
    if (Number.isFinite(maxGainDb)) result = Math.min(result, maxGainDb);
  }

  return roundGain(clampNumber(result, REPLAY_GAIN_MIN_DB, REPLAY_GAIN_MAX_DB));
}

/** Efektlerin toplam kazancı (preamp + ReplayGain). */
export function getTotalGainDb(
  settings: AudioEffectsSettings,
  replayGainDb: number
): number {
  const effectsActive = settings.equalizerEnabled || settings.replayGainMode !== 'off';
  if (!effectsActive) return 0;
  return roundGain(
    clampNumber(
      settings.preampDb + (Number.isFinite(replayGainDb) ? replayGainDb : 0),
      REPLAY_GAIN_MIN_DB,
      REPLAY_GAIN_MAX_DB
    )
  );
}
