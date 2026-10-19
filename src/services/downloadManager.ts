import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useDownloadStore } from '../store/useDownloadStore';
import { useStore } from '../store/useStore';
import type { DownloadTask } from '../types/download';

const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

export interface StartDownloadParams {
  title: string;
  artist?: string;
  artwork?: string;
  downloadUrl: string;
  suggestedFileName?: string;
  storageTarget?: 'public' | 'private';
  sourceExtensionId?: string;
}

/**
 * Evrensel İndirme Başlatıcı:
 * Eklentilerden veya uygulama içinden çağrılan ses indirmelerini yönetir.
 */
export async function startDownload(params: StartDownloadParams): Promise<{ downloadId: string }> {
  const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const store = useDownloadStore.getState();

  const title = (params.title || 'Unknown Title').trim();
  const artist = (params.artist || 'Unknown Artist').trim();

  // Dosya uzantısını belirle (.mp3 veya .m4a varsayılan)
  let ext = '.mp3';
  if (params.suggestedFileName && params.suggestedFileName.includes('.')) {
    const rawExt = params.suggestedFileName.substring(params.suggestedFileName.lastIndexOf('.')).toLowerCase();
    if (['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg'].includes(rawExt)) {
      ext = rawExt;
    }
  } else if (params.downloadUrl.includes('.m4a')) {
    ext = '.m4a';
  }

  const baseName = sanitizeFileName(params.suggestedFileName?.replace(/\.[^/.]+$/, '') || `${artist} - ${title}`);
  const finalFileName = `${baseName}${ext}`;

  // Hedef depolama
  const defaultTarget = store.defaultStorageTarget === 'ask' ? 'public' : store.defaultStorageTarget;
  const target: 'public' | 'private' = params.storageTarget || defaultTarget;

  const downloadDir = `${FileSystem.documentDirectory || ''}downloads/`;
  const localFileUri = `${downloadDir}${downloadId}_${finalFileName}`;

  const task: DownloadTask = {
    id: downloadId,
    title,
    artist,
    artwork: params.artwork,
    downloadUrl: params.downloadUrl,
    fileName: finalFileName,
    localFileUri,
    status: 'downloading',
    progress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    createdAt: Date.now(),
    sourceExtensionId: params.sourceExtensionId,
    storageTarget: target,
  };

  store.addTask(task);

  // Arka planda indirmeyi başlat
  executeDownload(task).catch((err) => {
    console.warn('[downloadManager] İndirme yürütme hatası:', err);
  });

  return { downloadId };
}

async function executeDownload(task: DownloadTask): Promise<void> {
  const downloadDir = `${FileSystem.documentDirectory || ''}downloads/`;

  try {
    const dirInfo = await FileSystem.getInfoAsync(downloadDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });
    }

    const callback = (downloadProgress: FileSystem.DownloadProgressData) => {
      const progress = downloadProgress.totalBytesExpectedToWrite > 0
        ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
        : 0;

      useDownloadStore.getState().updateTask(task.id, {
        progress,
        downloadedBytes: downloadProgress.totalBytesWritten,
        totalBytes: downloadProgress.totalBytesExpectedToWrite,
      });
    };

    const downloadResumable = FileSystem.createDownloadResumable(
      task.downloadUrl,
      task.localFileUri!,
      {},
      callback
    );

    activeDownloads.set(task.id, downloadResumable);

    const result = await downloadResumable.downloadAsync();
    activeDownloads.delete(task.id);

    if (!result || !result.uri) {
      throw new Error('İndirme tamamlanamadı veya dosya oluşturulamadı.');
    }

    let mediaAssetId: string | undefined;

    // Eğer genel müzik kütüphanesine kaydedilmesi istenmişse
    if (task.storageTarget === 'public') {
      try {
        let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
        if (!permission.granted && permission.canAskAgain) {
          permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
        }

        if (permission.granted) {
          const createdAsset = await MediaLibrary.createAssetAsync(result.uri);
          mediaAssetId = createdAsset.id;

          // RunMusic ana kütüphanesine yeni varlığı anında ekle
          const currentLib = useStore.getState().library;
          if (!currentLib.some((a) => a.id === createdAsset.id || a.uri === createdAsset.uri)) {
            useStore.getState().setLibrary([createdAsset, ...currentLib]);
          }
        }
      } catch (mediaLibErr) {
        console.warn('[downloadManager] MediaLibrary kayıt uyarısı:', mediaLibErr);
      }
    }

    useDownloadStore.getState().updateTask(task.id, {
      status: 'completed',
      progress: 1,
      completedAt: Date.now(),
      mediaLibraryAssetId: mediaAssetId,
    });
  } catch (error: any) {
    activeDownloads.delete(task.id);
    const errMsg = error?.message || 'İndirme sırasında bir hata oluştu.';
    useDownloadStore.getState().updateTask(task.id, {
      status: 'failed',
      error: errMsg,
    });
  }
}

/**
 * Devam eden indirmeyi iptal eder.
 */
export async function cancelDownload(downloadId: string): Promise<void> {
  const resumable = activeDownloads.get(downloadId);
  if (resumable) {
    try {
      await resumable.cancelAsync();
    } catch {
      // ignore
    }
    activeDownloads.delete(downloadId);
  }

  const task = useDownloadStore.getState().tasks.find((t) => t.id === downloadId);
  if (task && task.localFileUri) {
    FileSystem.deleteAsync(task.localFileUri, { idempotent: true }).catch(() => {});
  }

  useDownloadStore.getState().updateTask(downloadId, {
    status: 'cancelled',
  });
}
