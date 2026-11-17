import * as SQLite from 'expo-sqlite';

import type { LyricsResult } from './lyricsService';
import {
  isLyricsCacheRef,
  normalizeLyricsCache,
  type LyricsCacheEntry,
} from './persistSanitize';

/**
 * Şarkı sözü önbelleği ve parça başına söz ofsetleri için SQLite deposu.
 *
 * NEDEN AYRI VERİTABANI: söz önbelleği tek bir AsyncStorage anahtarına
 * yazıldığında (tüm store tek `setItem` ile yazılır) Android'in tek-değer
 * sınırına takılabiliyor ve yazma SESSİZCE başarısız oluyordu. Bu da yalnızca
 * sözlerin değil, aynı kayıttaki TÜM kullanıcı tercihlerinin kaybolmasına yol
 * açıyordu. SQLite satır bazlı olduğu için böyle bir sınır yoktur.
 *
 * Ana store (`useStore`) sözleri bellekte tutmaya devam eder; bu dosya yalnızca
 * kalıcı katmandır. Açılışta bir kez okunur, yazmalarda artımlı olarak
 * güncellenir. Bu dosya native bağımlıdır (expo-sqlite), bu yüzden Node
 * doğrulama betiklerinden import EDİLMEMELİDİR.
 */

const DB_NAME = 'runmusic_lyrics.db';

/** Eski AsyncStorage kaydının SQLite'a bir kez taşındığını işaretleyen anahtar. */
const LEGACY_IMPORT_KEY = 'legacy_import_v1';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openLyricsDB(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DB_NAME);

  try {
    await database.execAsync('PRAGMA journal_mode = WAL;').catch(() => {});

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS lyrics_cache (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lyrics_offsets (
        track_id TEXT PRIMARY KEY,
        offset_seconds REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lyrics_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    return database;
  } catch (error) {
    await database.closeAsync().catch(() => {});
    throw error;
  }
}

function getLyricsDB(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openLyricsDB().catch((error) => {
      // Yarım kalan kurulum kalıcı "bozuk veritabanı" durumuna dönüşmesin.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function parseEntry(raw: string): LyricsCacheEntry | null {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    return value as LyricsCacheEntry;
  } catch {
    return null;
  }
}

/** Tüm söz önbelleğini (kanonik kayıtlar + `ref` işaretçileri) okur. */
export async function loadLyricsCache(): Promise<Record<string, LyricsCacheEntry>> {
  const database = await getLyricsDB();
  const rows = await database.getAllAsync<{ key: string; payload: string }>(
    'SELECT key, payload FROM lyrics_cache'
  );

  const cache: Record<string, LyricsCacheEntry> = {};
  for (const row of rows) {
    const entry = parseEntry(row.payload);
    if (entry) cache[row.key] = entry;
  }
  return normalizeLyricsCache(cache);
}

/**
 * Önbelleği verilen içerikle birebir değiştirir (tek işlem).
 * Migrasyonda ve "söz önbelleğini temizle" sonrasında kullanılır.
 */
export async function replaceLyricsCache(
  cache: Record<string, LyricsCacheEntry>
): Promise<void> {
  const database = await getLyricsDB();
  const normalized = normalizeLyricsCache(cache);
  const now = Date.now();

  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM lyrics_cache');
    for (const [key, entry] of Object.entries(normalized)) {
      await database.runAsync(
        'INSERT OR REPLACE INTO lyrics_cache (key, payload, updated_at) VALUES (?, ?, ?)',
        key,
        JSON.stringify(entry),
        now
      );
    }
  });
}

/**
 * Tek bir parçanın sözünü ve alternatif anahtarlarını yazar.
 * Kanonik içerik `id` anahtarına, diğer anahtarlara yalnızca `{ ref }`
 * işaretçisi yazılır; böylece aynı içerik diskte tekrar tekrar tutulmaz.
 */
export async function saveLyricsEntry(
  id: string,
  lyrics: LyricsResult,
  alternateKeys: string[] = []
): Promise<void> {
  const database = await getLyricsDB();
  const now = Date.now();
  const canonical: LyricsResult = { ...lyrics };
  // Türetilmiş alanlar kalıcı kayda yazılmaz; söz metninden yeniden üretilir.
  delete (canonical as Partial<LyricsResult>).parsedLines;
  delete (canonical as Partial<LyricsResult>).candidates;

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'INSERT OR REPLACE INTO lyrics_cache (key, payload, updated_at) VALUES (?, ?, ?)',
      id,
      JSON.stringify(canonical),
      now
    );
    for (const key of alternateKeys) {
      if (!key || key === id) continue;
      await database.runAsync(
        'INSERT OR REPLACE INTO lyrics_cache (key, payload, updated_at) VALUES (?, ?, ?)',
        key,
        JSON.stringify({ ref: id }),
        now
      );
    }
  });
}

export async function clearLyricsCacheDB(): Promise<void> {
  const database = await getLyricsDB();
  await database.runAsync('DELETE FROM lyrics_cache');
}

/** Parça başına söz ofsetlerini okur (0 ve geçersiz değerler yazılmaz). */
export async function loadLyricsOffsets(): Promise<Record<string, number>> {
  const database = await getLyricsDB();
  const rows = await database.getAllAsync<{ track_id: string; offset_seconds: number }>(
    'SELECT track_id, offset_seconds FROM lyrics_offsets'
  );

  const offsets: Record<string, number> = {};
  for (const row of rows) {
    if (!row.track_id) continue;
    if (typeof row.offset_seconds !== 'number' || !Number.isFinite(row.offset_seconds)) {
      continue;
    }
    if (row.offset_seconds !== 0) offsets[row.track_id] = row.offset_seconds;
  }
  return offsets;
}

/** Ofset haritasını birebir yazar (tek işlem). */
export async function replaceLyricsOffsets(offsets: Record<string, number>): Promise<void> {
  const database = await getLyricsDB();
  const now = Date.now();

  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM lyrics_offsets');
    for (const [trackId, value] of Object.entries(offsets)) {
      if (!trackId) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
      await database.runAsync(
        'INSERT OR REPLACE INTO lyrics_offsets (track_id, offset_seconds, updated_at) VALUES (?, ?, ?)',
        trackId,
        value,
        now
      );
    }
  });
}

let offsetsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOffsets: Record<string, number> | null = null;

/**
 * Ofset yazmalarını geciktirir: fullscreen oynatıcıda +/- butonuna basılı
 * tutulduğunda saniyede onlarca gereksiz SQLite işlemi açılmasın.
 */
export function scheduleLyricsOffsetsSave(offsets: Record<string, number>): void {
  pendingOffsets = { ...offsets };
  if (offsetsSaveTimer) clearTimeout(offsetsSaveTimer);
  offsetsSaveTimer = setTimeout(() => {
    offsetsSaveTimer = null;
    const snapshot = pendingOffsets;
    pendingOffsets = null;
    if (!snapshot) return;
    replaceLyricsOffsets(snapshot).catch((error) => {
      console.warn('[lyricsStore] ofsetler yazılamadı:', error);
    });
  }, 400);
}

async function readMeta(key: string): Promise<string | null> {
  const database = await getLyricsDB();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM lyrics_meta WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

async function writeMeta(key: string, value: string): Promise<void> {
  const database = await getLyricsDB();
  await database.runAsync(
    'INSERT OR REPLACE INTO lyrics_meta (key, value) VALUES (?, ?)',
    key,
    value
  );
}

/**
 * Eski AsyncStorage kaydındaki sözleri SQLite'a BİR KEZ taşır.
 *
 * Sıra önemli: önce veri yazılır, ardından bayrak işaretlenir. Yazma başarısız
 * olursa bayrak yazılmaz ve bir sonraki açılışta taşıma yeniden denenir; yani
 * kullanıcı sözleri yarıda kalan bir migrasyon yüzünden kaybolmaz.
 */
export async function importLegacyLyricsOnce(params: {
  cache: Record<string, LyricsCacheEntry>;
  offsets: Record<string, number>;
}): Promise<{ imported: boolean }> {
  const alreadyImported = await readMeta(LEGACY_IMPORT_KEY);
  if (alreadyImported === 'done') return { imported: false };

  const hasCache = Object.keys(params.cache).length > 0;
  const hasOffsets = Object.keys(params.offsets).length > 0;

  if (hasCache) await replaceLyricsCache(params.cache);
  if (hasOffsets) await replaceLyricsOffsets(params.offsets);

  await writeMeta(LEGACY_IMPORT_KEY, 'done');
  return { imported: hasCache || hasOffsets };
}

/** Test/teşhis için: taşıma bayrağını sıfırlar. */
export async function resetLegacyLyricsImportFlag(): Promise<void> {
  const database = await getLyricsDB();
  await database.runAsync('DELETE FROM lyrics_meta WHERE key = ?', LEGACY_IMPORT_KEY);
}

/** Önbellekte işaretçi olmayan kanonik kayıt sayısı (teşhis için). */
export function countCanonicalLyrics(cache: Record<string, LyricsCacheEntry>): number {
  return Object.values(cache).filter((entry) => !isLyricsCacheRef(entry)).length;
}
