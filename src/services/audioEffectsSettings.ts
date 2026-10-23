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

export interface EqualizerPreset {
  id: string;
  name: string;
  /** Beş sabit bandın dB kazançları. */
  bands: number[];
}

export interface AudioEffectsSettings {
  equalizerEnabled: boolean;
  /** Beş sabit bandın dB kazançları (EQUALIZER_BAND_FREQUENCIES sırasıyla). */
  equalizerBands: number[];
  replayGainMode: ReplayGainMode;
  /** Ortak preamp (dB). Negatif değer baş payı (headroom) oluşturur. */
  preampDb: number;
  /** ReplayGain peak değeri varsa kırpılmayı önlemek için kazancı sınırla. */
  preventClipping: boolean;
  /** Kullanıcının kaydettiği ekolayzer presetleri. */
  customPresets: EqualizerPreset[];
}

/** Hazır presetler. Etiketleri UI katmanı çevirir. */
export const BUILT_IN_EQUALIZER_PRESETS: readonly {
  id: 'flat' | 'bass' | 'vocal' | 'rock' | 'podcast';
  bands: readonly number[];
}[] = [
  { id: 'flat', bands: [0, 0, 0, 0, 0] },
  { id: 'bass', bands: [8, 5, 1, -1, -2] },
  { id: 'vocal', bands: [-4, -2, 3, 5, 3] },
  { id: 'rock', bands: [5, 3, -1, 4, 5] },
  { id: 'podcast', bands: [-5, 0, 4, 4, -1] },
];

export const MAX_CUSTOM_PRESETS = 8;
export const PRESET_NAME_MAX_LENGTH = 24;

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsSettings = {
  equalizerEnabled: false,
  equalizerBands: EQUALIZER_BAND_FREQUENCIES.map(() => 0),
  replayGainMode: 'off',
  preampDb: 0,
  preventClipping: true,
  customPresets: [],
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

/** Preset adını kırpar, boşlukları sadeleştirir ve uzunluğu sınırlar. */
export function normalizePresetName(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX_LENGTH);
}

/**
 * Kaydedilmiş presetleri güvenli hale getirir. Bozuk kayıtlar atılır, kimlikler
 * benzersizleştirilir, bantlar aralığa sıkıştırılır ve sayı sınırlanır.
 */
export function normalizeCustomPresets(input: unknown): EqualizerPreset[] {
  if (!Array.isArray(input)) return [];

  const seenIds = new Set<string>();
  const result: EqualizerPreset[] = [];

  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const source = item as Record<string, unknown>;
    const name = normalizePresetName(source.name);
    if (!name) continue;

    const rawId = typeof source.id === 'string' ? source.id.trim().slice(0, 64) : '';
    const baseId = rawId || `custom-${index}`;
    let id = baseId;
    let suffix = 1;
    while (seenIds.has(id)) {
      id = `${baseId}-${suffix++}`;
    }
    seenIds.add(id);

    result.push({
      id,
      name,
      bands: normalizeEqualizerBands(source.bands),
    });

    if (result.length >= MAX_CUSTOM_PRESETS) break;
  }

  return result;
}

/** İki bant dizisinin aynı preset sayılacak kadar yakın olup olmadığı. */
export function bandsMatch(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== EQUALIZER_BAND_COUNT || b.length !== EQUALIZER_BAND_COUNT) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.05);
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
    customPresets: normalizeCustomPresets(source.customPresets),
  };
}

/** Ayar nesnesinin kopyasını üretir (dizi paylaşımını önler). */
export function cloneAudioEffects(settings: AudioEffectsSettings): AudioEffectsSettings {
  return {
    ...settings,
    equalizerBands: [...settings.equalizerBands],
    customPresets: settings.customPresets.map((preset) => ({
      ...preset,
      bands: [...preset.bands],
    })),
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
