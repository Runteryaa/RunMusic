import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function initStatsDB() {
  if (db) return;
  db = await SQLite.openDatabaseAsync('runmusic_stats.db');
  
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
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

  // Var olan veritabanı için güvenli sütun göçü (varsa hatayı sessizce yut)
  try {
    await db.execAsync('ALTER TABLE play_history ADD COLUMN title TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE play_history ADD COLUMN artist TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE play_history ADD COLUMN artwork TEXT;');
  } catch {}
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
  if (!db) await initStatsDB();
  try {
    await db!.runAsync(
      'INSERT INTO play_history (track_id, duration_listened, title, artist, artwork) VALUES (?, ?, ?, ?, ?)',
      trackId,
      durationListened,
      meta?.title ?? null,
      meta?.artist ?? null,
      meta?.artwork ?? null
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

export async function getRecentHistory(limit?: number, offset: number = 0): Promise<PlayHistoryItem[]> {
  if (!db) await initStatsDB();
  try {
    if (typeof limit === 'number' && limit > 0) {
      return await db!.getAllAsync<PlayHistoryItem>(
        'SELECT * FROM play_history ORDER BY played_at DESC LIMIT ? OFFSET ?',
        limit,
        offset
      );
    }
    // Limit verilmezse tüm geçmiş kayıtlarını döner (sonsuz geçmiş)
    return await db!.getAllAsync<PlayHistoryItem>(
      'SELECT * FROM play_history ORDER BY played_at DESC'
    );
  } catch (error) {
    console.warn('Failed to get recent history:', error);
    return [];
  }
}

export async function getTotalHistoryCount(): Promise<number> {
  if (!db) await initStatsDB();
  try {
    const res = await db!.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM play_history');
    return res?.cnt || 0;
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

export async function getMostPlayed(limit: number = 20, timeframe?: 'month'): Promise<MostPlayedItem[]> {
  if (!db) await initStatsDB();
  try {
    let query = 'SELECT track_id, COUNT(*) as play_count, MAX(title) as title, MAX(artist) as artist, MAX(artwork) as artwork FROM play_history';
    if (timeframe === 'month') {
      // SQLite date function to filter last 30 days
      query += " WHERE played_at >= datetime('now', '-30 days')";
    }
    query += ' GROUP BY track_id ORDER BY play_count DESC LIMIT ?';
    
    return await db!.getAllAsync<MostPlayedItem>(query, limit);
  } catch (error) {
    console.warn('Failed to get most played:', error);
    return [];
  }
}

/**
 * Akıllı karıştırma (Smart Shuffle) için tüm parçaların dinleme sayılarını harita olarak döner.
 */
export async function getPlayCountsMap(): Promise<Record<string, number>> {
  if (!db) await initStatsDB();
  try {
    const rows = await db!.getAllAsync<{ track_id: string; play_count: number }>(
      'SELECT track_id, COUNT(*) as play_count FROM play_history GROUP BY track_id'
    );
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (r.track_id) {
        map[r.track_id] = r.play_count;
      }
    }
    return map;
  } catch (error) {
    console.warn('Failed to get play counts map:', error);
    return {};
  }
}

export async function addListeningTime(seconds: number) {
  if (!db) await initStatsDB();
  try {
    await db!.runAsync(
      'UPDATE app_stats SET value = value + ? WHERE key = ?',
      seconds,
      'total_listening_seconds'
    );
  } catch (error) {
    console.warn('Failed to add listening time:', error);
  }
}

export async function getTotalListeningTime(): Promise<number> {
  if (!db) await initStatsDB();
  try {
    const statsResult = await db!.getFirstAsync<{ value: number }>(
      "SELECT value FROM app_stats WHERE key = 'total_listening_seconds'"
    );
    const histResult = await db!.getFirstAsync<{ total_duration: number | null }>(
      'SELECT SUM(duration_listened) as total_duration FROM play_history'
    );
    
    return (statsResult?.value || 0) + (histResult?.total_duration || 0);
  } catch (error) {
    console.warn('Failed to get total listening time:', error);
    return 0;
  }
}
