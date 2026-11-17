import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Parça başına "kaldığın yerden devam" konumları.
 *
 * NEDEN ayrı bir anahtar: kuyruk anlık görüntüsü zaten tek bir konum tutuyor
 * (son çalınan parça). Uzun parçalarda (podcast, mix, klasik eser) kullanıcı
 * her parçayı kendi yerinden açmak ister; bu listeyi zustand store'a koymak
 * AsyncStorage'daki tek kaydı büyütürdü. Bu yüzden en fazla 200 kayıtla
 * sınırlı, küçük ve bağımsız bir anahtar kullanılıyor.
 */

export const RESUME_POSITIONS_KEY = '@runmusic_resume_positions_v1';

/** Yalnızca bu süreden uzun parçalarda konum hatırlanır (10 dakika). */
export const RESUME_MIN_DURATION_SEC = 10 * 60;

/** Bu kadar geride kalan konum anlamsızdır; parça baştan açılır. */
export const RESUME_MIN_POSITION_SEC = 30;

/** Parça sonuna bu kadar kalınca konum kaydı silinir. */
export const RESUME_MIN_REMAINING_SEC = 30;

/** Aynı parça için iki kayıt arasındaki en az fark (saniye). */
const MIN_SAVE_DELTA_SEC = 15;

const MAX_ENTRIES = 200;

export interface ResumeEntry {
  position: number;
  duration: number;
  /** Son yazma zamanı (ms) — LRU temizliği için. */
  at: number;
}

type ResumeMap = Record<string, ResumeEntry>;

let cache: ResumeMap | null = null;
let loadPromise: Promise<ResumeMap> | null = null;

function normalizeEntry(value: unknown): ResumeEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const position = Number(raw.position);
  const duration = Number(raw.duration);
  const at = Number(raw.at);
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return null;
  if (duration < RESUME_MIN_DURATION_SEC) return null;
  if (position < RESUME_MIN_POSITION_SEC) return null;
  return {
    position: Math.max(0, position),
    duration: Math.max(0, duration),
    at: Number.isFinite(at) ? at : 0,
  };
}

function normalizeMap(value: unknown): ResumeMap {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, normalizeEntry(entry)] as const)
    .filter((pair): pair is readonly [string, ResumeEntry] => pair[1] != null);
  // En yeni kayıtlar önce; 200 sınırı aşılırsa eskiler düşer.
  entries.sort((a, b) => b[1].at - a[1].at);
  const map: ResumeMap = {};
  for (const [key, entry] of entries.slice(0, MAX_ENTRIES)) {
    map[key] = entry;
  }
  return map;
}

async function load(): Promise<ResumeMap> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(RESUME_POSITIONS_KEY);
        cache = normalizeMap(raw ? JSON.parse(raw) : null);
      } catch {
        cache = {};
      }
      return cache;
    })();
  }
  return loadPromise;
}

async function persist(map: ResumeMap): Promise<void> {
  cache = map;
  try {
    await AsyncStorage.setItem(RESUME_POSITIONS_KEY, JSON.stringify(map));
  } catch {
    // Depolama hatası özelliği sessizce devre dışı bırakır; çalma etkilenmez.
  }
}

/** Kayıtların anahtarı: parça kimliği, yoksa dosya yolu. */
export function resumeKey(trackId: string | null | undefined, url?: string | null): string {
  return String(trackId || url || '').trim();
}

/** Parçanın kayıtlı konumu (yoksa `null`). */
export async function getResumeEntry(key: string): Promise<ResumeEntry | null> {
  if (!key) return null;
  const map = await load();
  return map[key] ?? null;
}

/**
 * Konumu kaydeder. Kayda değmeyen durumlarda (kısa parça, başlangıç, son)
 * mevcut kayıt silinir ve `false` döner.
 */
export async function saveResumePosition(
  key: string,
  position: number,
  duration: number
): Promise<boolean> {
  if (!key || !Number.isFinite(position) || !Number.isFinite(duration)) return false;
  const map = await load();

  const shouldForget =
    duration < RESUME_MIN_DURATION_SEC ||
    position < RESUME_MIN_POSITION_SEC ||
    duration - position < RESUME_MIN_REMAINING_SEC;

  if (shouldForget) {
    if (!map[key]) return false;
    const next = { ...map };
    delete next[key];
    await persist(next);
    return false;
  }

  const existing = map[key];
  if (
    existing &&
    Math.abs(existing.position - position) < MIN_SAVE_DELTA_SEC &&
    Math.abs(existing.duration - duration) < 1
  ) {
    return true;
  }

  const next: ResumeMap = {
    ...map,
    [key]: { position, duration, at: Date.now() },
  };
  // LRU: en eski kayıtları at.
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => next[a].at - next[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((oldKey) => {
        delete next[oldKey];
      });
  }
  await persist(next);
  return true;
}

export async function clearResumePosition(key: string): Promise<void> {
  if (!key) return;
  const map = await load();
  if (!map[key]) return;
  const next = { ...map };
  delete next[key];
  await persist(next);
}

export async function clearAllResumePositions(): Promise<void> {
  await persist({});
}
