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
      duration_listened INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_track_id ON play_history(track_id);
    CREATE INDEX IF NOT EXISTS idx_played_at ON play_history(played_at);
    
    CREATE TABLE IF NOT EXISTS app_stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO app_stats (key, value) VALUES ('total_listening_seconds', 0);
  `);
}

export async function recordPlay(trackId: string, durationListened: number) {
  if (!db) await initStatsDB();
  try {
    await db!.runAsync(
      'INSERT INTO play_history (track_id, duration_listened) VALUES (?, ?)',
      trackId,
      durationListened
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
}

export async function getRecentHistory(limit: number = 50): Promise<PlayHistoryItem[]> {
  if (!db) await initStatsDB();
  try {
    return await db!.getAllAsync<PlayHistoryItem>(
      'SELECT * FROM play_history ORDER BY played_at DESC LIMIT ?',
      limit
    );
  } catch (error) {
    console.warn('Failed to get recent history:', error);
    return [];
  }
}

export interface MostPlayedItem {
  track_id: string;
  play_count: number;
}

export async function getMostPlayed(limit: number = 20, timeframe?: 'month'): Promise<MostPlayedItem[]> {
  if (!db) await initStatsDB();
  try {
    let query = 'SELECT track_id, COUNT(*) as play_count FROM play_history';
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
