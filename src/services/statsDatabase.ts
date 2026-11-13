import * as SQLite from 'expo-sqlite';

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
        'INSERT INTO play_history (track_id, duration_listened, title, artist, artwork) VALUES (?, ?, ?, ?, ?)',
        trackId,
        durationListened,
        meta?.title ?? null,
        meta?.artist ?? null,
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
    return await withStatsDB((database) => {
      let query =
        'SELECT track_id, COUNT(*) as play_count, MAX(title) as title, MAX(artist) as artist, MAX(artwork) as artwork FROM play_history';
      if (timeframe === 'month') {
        // SQLite date function to filter last 30 days
        query += " WHERE played_at >= datetime('now', '-30 days')";
      }
      query += ' GROUP BY track_id ORDER BY play_count DESC LIMIT ?';

      return database.getAllAsync<MostPlayedItem>(query, limit);
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

export async function getTotalListeningTime(): Promise<number> {
  try {
    return await withStatsDB(async (database) => {
      const statsResult = await database.getFirstAsync<{ value: number }>(
        "SELECT value FROM app_stats WHERE key = 'total_listening_seconds'"
      );
      const histResult = await database.getFirstAsync<{ total_duration: number | null }>(
        'SELECT SUM(duration_listened) as total_duration FROM play_history'
      );

      return (statsResult?.value || 0) + (histResult?.total_duration || 0);
    });
  } catch (error) {
    console.warn('Failed to get total listening time:', error);
    return 0;
  }
}
