import * as SQLite from 'expo-sqlite';

import { renameArtistInField } from './artistRename';
import { cleanTrackFields } from './displayNames';
import { bumpStatsEpoch } from './statsEpoch';

const DB_NAME = 'runmusic_stats.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Veritabanını ve şemayı tek seferde hazırlar.
 *
 * Önemli: bağlantı ancak şema kurulumu başarılı olduktan sonra önbelleğe
 * alınır. Böylece yarım kalan bir kurulum (ör. WAL desteklemeyen bir cihaz)
 * sonraki çağrılarda kalıcı olarak "bozuk veritabanı" durumuna dönüşmez.
 */
async function openStatsDB(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DB_NAME);

  try {
    // WAL yalnızca bir performans ayarıdır; başarısız olursa şemayı kurmaya
    // devam et. Bazı dosya sistemlerinde WAL açılamayabiliyor.
    await database.execAsync('PRAGMA journal_mode = WAL;').catch(() => {});

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_listened INTEGER NOT NULL,
        title TEXT,
        artist TEXT,
        album TEXT,
        artwork TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_track_id ON play_history(track_id);
      CREATE INDEX IF NOT EXISTS idx_played_at ON play_history(played_at);

      CREATE TABLE IF NOT EXISTS app_stats (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO app_stats (key, value) VALUES ('total_listening_seconds', 0);
    `);

    // Eski sürümlerden kalan veritabanları için eksik sütunları ekle.
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info(play_history)'
    );
    const columnNames = new Set(columns.map((column) => column.name));
    for (const [name, type] of [
      ['title', 'TEXT'],
      ['artist', 'TEXT'],
      ['album', 'TEXT'],
      ['artwork', 'TEXT'],
    ] as const) {
      if (!columnNames.has(name)) {
        await database.execAsync(`ALTER TABLE play_history ADD COLUMN ${name} ${type};`);
      }
    }

    // Satır herhangi bir nedenle silinmişse dinleme süresi sayacını geri getir.
    await database.runAsync(
      "INSERT OR IGNORE INTO app_stats (key, value) VALUES ('total_listening_seconds', 0)"
    );

    return database;
  } catch (error) {
    await database.closeAsync().catch(() => {});
    throw error;
  }
}

function getStatsDB(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openStatsDB().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function resetStatsDB(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  if (current) {
    const database = await current.catch(() => null);
    await database?.closeAsync().catch(() => {});
  }
}

/**
 * Bir sorgu başarısız olursa bağlantıyı tazeleyip bir kez daha dener. Bu,
 * uygulama güncellemelerinden sonra eski/yarım kalmış bir şema veya geçici
 * kilit hatasında istatistiklerin sessizce tamamen durmasını engeller.
 */
async function withStatsDB<T>(
  operation: (database: SQLite.SQLiteDatabase) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const database = await getStatsDB();
      return await operation(database);
    } catch (error) {
      lastError = error;
      await resetStatsDB();
    }
  }
  throw lastError;
}

export async function initStatsDB(): Promise<void> {
  await getStatsDB();
}

export interface PlayMetadataPayload {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  artwork?: string | null;
}

export async function recordPlay(
  trackId: string,
  durationListened: number,
  meta?: PlayMetadataPayload
) {
  try {
    await withStatsDB((database) =>
      database.runAsync(
        'INSERT INTO play_history (track_id, duration_listened, title, artist, album, artwork) VALUES (?, ?, ?, ?, ?, ?)',
        trackId,
        durationListened,
        meta?.title ?? null,
        meta?.artist ?? null,
        meta?.album ?? null,
        meta?.artwork ?? null
      )
    );
  } catch (error) {
    console.warn('Failed to record play stat:', error);
  }
}

export interface PlayHistoryItem {
  id: number;
  track_id: string;
  played_at: string;
  duration_listened: number;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  artwork?: string | null;
}

export async function getRecentHistory(
  limit?: number,
  offset: number = 0
): Promise<PlayHistoryItem[]> {
  try {
    return await withStatsDB(async (database) => {
      if (typeof limit === 'number' && limit > 0) {
        return database.getAllAsync<PlayHistoryItem>(
          'SELECT * FROM play_history ORDER BY played_at DESC LIMIT ? OFFSET ?',
          limit,
          offset
        );
      }
      // Limit verilmezse tüm geçmiş kayıtlarını döner (sonsuz geçmiş)
      return database.getAllAsync<PlayHistoryItem>(
        'SELECT * FROM play_history ORDER BY played_at DESC'
      );
    });
  } catch (error) {
    console.warn('Failed to get recent history:', error);
    return [];
  }
}

export async function getTotalHistoryCount(): Promise<number> {
  try {
    return await withStatsDB(async (database) => {
      const res = await database.getFirstAsync<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM play_history'
      );
      return res?.cnt || 0;
    });
  } catch {
    return 0;
  }
}

export interface MostPlayedItem {
  track_id: string;
  play_count: number;
  title?: string;
  artist?: string;
  artwork?: string;
}

export async function getMostPlayed(
  limit: number = 20,
  timeframe?: 'month'
): Promise<MostPlayedItem[]> {
  try {
    return await withStatsDB(async (database) => {
      let query =
        'SELECT track_id, COUNT(*) as play_count, MAX(title) as title, MAX(artist) as artist, MAX(artwork) as artwork FROM play_history';
      if (timeframe === 'month') {
        // SQLite date function to filter last 30 days
        query += " WHERE played_at >= datetime('now', '-30 days')";
      }
      query += ' GROUP BY track_id ORDER BY play_count DESC LIMIT ?';

      const rows = await database.getAllAsync<MostPlayedItem>(query, limit);
      // Ham etiketler gösterime sızmaz: "MODELOfficial" → "MODEL",
      // "Song (Official Video)" → "Song".
      return rows.map((row) => {
        const fields = cleanTrackFields(row.title, row.artist);
        return { ...row, title: fields.title, artist: fields.artist };
      });
    });
  } catch (error) {
    console.warn('Failed to get most played:', error);
    return [];
  }
}

/**
 * Akıllı karıştırma (Smart Shuffle) için tüm parçaların dinleme sayılarını harita olarak döner.
 */
export async function getPlayCountsMap(): Promise<Record<string, number>> {
  try {
    return await withStatsDB(async (database) => {
      const rows = await database.getAllAsync<{ track_id: string; play_count: number }>(
        'SELECT track_id, COUNT(*) as play_count FROM play_history GROUP BY track_id'
      );
      const map: Record<string, number> = {};
      for (const row of rows) {
        if (row.track_id) {
          map[row.track_id] = row.play_count;
        }
      }
      return map;
    });
  } catch (error) {
    console.warn('Failed to get play counts map:', error);
    return {};
  }
}

export async function addListeningTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    await withStatsDB(async (database) => {
      await database.runAsync(
        "INSERT OR IGNORE INTO app_stats (key, value) VALUES ('total_listening_seconds', 0)"
      );
      await database.runAsync(
        'UPDATE app_stats SET value = value + ? WHERE key = ?',
        Math.floor(seconds),
        'total_listening_seconds'
      );
    });
  } catch (error) {
    console.warn('Failed to add listening time:', error);
  }
}

/**
 * `play_history` sorgularında seçilen sütunlar.
 *
 * `SELECT *` kullanıldığında tüm geçmiş (on binlerce satır) köprüden geçiyordu
 * ve bu, istatistik ekranlarını saniyelerce kilitliyordu.
 */
const HISTORY_COLUMNS =
  'track_id, played_at, duration_listened, title, artist, album, artwork';

/**
 * Belirli bir zaman aralığındaki dinlemeleri döner (Wrapped için).
 *
 * `startSql` / `endSql`: `YYYY-MM-DD HH:MM:SS` (UTC) — `played_at` ile aynı
 * biçim. SQLite'ta metin karşılaştırması bu biçimde kronolojik sıralamayla
 * aynı sonucu verir.
 */
export async function getHistoryInRange(
  startSql: string,
  endSql: string
): Promise<PlayHistoryItem[]> {
  try {
    return await withStatsDB((database) =>
      database.getAllAsync<PlayHistoryItem>(
        `SELECT ${HISTORY_COLUMNS} FROM play_history WHERE played_at >= ? AND played_at < ? ORDER BY played_at ASC`,
        startSql,
        endSql
      )
    );
  } catch (error) {
    console.warn('Failed to get history range:', error);
    return [];
  }
}

/** Isı haritası için hafif satır: yalnızca zaman damgası ve dinlenen süre. */
export interface DailyPlayRow {
  played_at: string;
  duration_listened: number | null;
}

/**
 * Verilen aralıktaki dinlemelerin **hafif** listesi (ısı haritası ve aylık özet).
 *
 * Başlık/sanatçı/kapak alanları seçilmez: bir yıllık geçmişte binlerce satır
 * dönebildiği için gereksiz veri taşınmaz. Gün bazında gruplama JS'te yerel
 * saat dilimine göre yapılır (SQLite UTC tutar, `played_at` yerel değildir).
 */
export async function getDailyPlayStats(
  startSql: string,
  endSql: string
): Promise<DailyPlayRow[]> {
  try {
    return await withStatsDB((database) =>
      database.getAllAsync<DailyPlayRow>(
        `SELECT played_at, duration_listened FROM play_history
          WHERE played_at >= ? AND played_at < ?
          ORDER BY played_at ASC`,
        startSql,
        endSql
      )
    );
  } catch (error) {
    console.warn('Failed to get daily play stats:', error);
    return [];
  }
}

/** LIKE deseninde özel karakterleri kaçırır (`%`, `_`, `\`). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Belirli bir dönemde **yalnızca verilen sanatçı adlarını** içeren dinlemeler.
 *
 * Sanatçı sayfası için kritik: tüm geçmişi çekip JS'te süzmek yerine SQL'de
 * ön süzme yapılır. Dönen satırlar yine JS'te tam eşleşmeyle doğrulanır
 * (`artistMatch`), çünkü `LIKE` alt dize eşleşmesidir.
 *
 * `names` en fazla `MAX_ARTIST_FILTER_NAMES` adet kullanılır; bu, sanatçı
 * alanında çok sayıda isim olan derleme etiketlerine karşı üst sınırdır.
 */
const MAX_ARTIST_FILTER_NAMES = 8;

export async function getHistoryInRangeForArtists(
  startSql: string,
  endSql: string,
  names: string[]
): Promise<PlayHistoryItem[]> {
  const patterns = [
    ...new Set(
      names
        .map((name) => (name || '').trim())
        // Tek harfli sanatçı adları da geçerli; yalnızca boş ad atlanır.
        .filter((name) => name.length > 0)
        .map((name) => `%${escapeLikePattern(name)}%`)
    ),
  ].slice(0, MAX_ARTIST_FILTER_NAMES);

  // Ad yoksa hiçbir satır dönmez (tüm geçmişi çekmek yerine boş sonuç).
  if (patterns.length === 0) return [];

  const where = patterns.map(() => "artist LIKE ? ESCAPE '\\'").join(' OR ');

  try {
    return await withStatsDB((database) =>
      database.getAllAsync<PlayHistoryItem>(
        `SELECT ${HISTORY_COLUMNS} FROM play_history
          WHERE played_at >= ? AND played_at < ? AND (${where})
          ORDER BY played_at ASC`,
        startSql,
        endSql,
        ...patterns
      )
    );
  } catch (error) {
    console.warn('Failed to get artist history range:', error);
    return [];
  }
}

/** İlk ve son dinlemenin zaman damgası (Wrapped "tüm zamanlar" penceresi için). */
export async function getHistoryBounds(): Promise<{
  first: string | null;
  last: string | null;
  count: number;
}> {
  try {
    return await withStatsDB(async (database) => {
      const row = await database.getFirstAsync<{
        first: string | null;
        last: string | null;
        cnt: number;
      }>('SELECT MIN(played_at) as first, MAX(played_at) as last, COUNT(*) as cnt FROM play_history');
      return { first: row?.first ?? null, last: row?.last ?? null, count: row?.cnt ?? 0 };
    });
  } catch (error) {
    console.warn('Failed to get history bounds:', error);
    return { first: null, last: null, count: 0 };
  }
}

export async function getTotalListeningTime(): Promise<number> {
  try {
    return await withStatsDB(async (database) => {
      const statsResult = await database.getFirstAsync<{ value: number }>(
        "SELECT value FROM app_stats WHERE key = 'total_listening_seconds'"
      );
      const histResult = await database.getFirstAsync<{ total_duration: number | null }>(
        'SELECT SUM(duration_listened) as total_duration FROM play_history'
      );

      // İki kaynak aynı dinlemeyi ölçer: `app_stats` tüm oynatma süresini,
      // `play_history.duration_listened` ise eşiği geçen dinlemelerin süresini
      // tutar. Önceden geçmiş süresi hep 0 olduğu için toplamak zararsızdı;
      // artık gerçek süre yazıldığı için toplamak çift sayardı. Daha büyük
      // olanı kullanmak hem eski hem yeni kayıtlarda doğru sonuç verir.
      return Math.max(statsResult?.value || 0, histResult?.total_duration || 0);
    });
  } catch (error) {
    console.warn('Failed to get total listening time:', error);
    return 0;
  }
}

/**
 * Geçmişteki tüm kayıtlarda sanatçı adını değiştirir (sanatçı sayfası).
 *
 * Satırlar tek tek okunur çünkü sanatçı alanı ortak çalışma listesi olabilir
 * ("Mavi Solman, UZI"). Değişen satır sayısı döner; `0` ise hata değil, sadece
 * bu adda kayıt yok demektir.
 */
export async function renameArtistInHistory(oldName: string, newName: string): Promise<number> {
  try {
    return await withStatsDB(async (database) => {
      const rows = await database.getAllAsync<{ id: number; artist: string | null }>(
        'SELECT id, artist FROM play_history'
      );

      let changed = 0;
      const updates: { id: number; artist: string }[] = [];
      for (const row of rows) {
        const next = renameArtistInField(row.artist, oldName, newName);
        if (next == null) continue;
        updates.push({ id: row.id, artist: next });
      }

      if (updates.length > 0) {
        await database.withTransactionAsync(async () => {
          for (const update of updates) {
            await database.runAsync(
              'UPDATE play_history SET artist = ? WHERE id = ?',
              update.artist,
              update.id
            );
            changed++;
          }
        });
      }

      return changed;
    });
  } catch (error) {
    console.warn('Failed to rename artist in history:', error);
    return 0;
  }
}

/**
 * Tüm istatistikleri sıfırlar (Ayarlar → Veri ve Bakım).
 *
 * Dinleme geçmişi, toplam süre sayacı ve uygulama içi sayaçlar silinir.
 * Kütüphane, metadata ve söz önbelleği **korunur** — bunlar istatistik değil,
 * kullanıcı verisidir. Silme başarısız olursa `false` döner ve ayarlar ekranı
 * kullanıcıya hata gösterir.
 */
export async function resetStats(): Promise<boolean> {
  try {
    await withStatsDB(async (database) => {
      await database.execAsync(`
        DELETE FROM play_history;
        DELETE FROM app_stats;
      `);
    });
    // İstatistik ekranının kısa süreli önbelleği eski sayıları göstermesin.
    bumpStatsEpoch();
    return true;
  } catch (error) {
    console.warn('Failed to reset stats:', error);
    return false;
  }
}
