/**
 * RunMusic İndirme Yöneticisi Veri Tipleri
 */

export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
export type DownloadStorageTarget = 'public' | 'private' | 'ask';

export interface DownloadTask {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  duration?: number;
  downloadUrl: string;
  fileName: string;
  localFileUri?: string;
  mediaLibraryAssetId?: string;
  status: DownloadStatus;
  progress: number; // 0 to 1
  totalBytes: number;
  downloadedBytes: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
  sourceExtensionId?: string;
  storageTarget: 'public' | 'private';
}
