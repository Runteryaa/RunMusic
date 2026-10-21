import { File, FileMode, type FileHandle } from 'expo-file-system';
import {
  readReplayGainTags,
  type ReplayGainTags,
  type TagSource,
} from './replayGainTags';

/**
 * Expo FileSystem üzerinden ReplayGain etiketlerini okur.
 *
 * Yalnızca tag başlıkları kadar veri okunur; dosyanın tamamı belleğe alınmaz.
 * `content://` (SAF) dosyaları salt-okunur modda desteklenir.
 *
 * Hata/erişim yok/etiket yok durumlarında `null` döner; çağıran taraf her
 * zaman "ReplayGain yok" varsayımıyla devam edebilmelidir.
 */
export async function readReplayGainTagsFromFile(
  uri: string | null | undefined
): Promise<ReplayGainTags | null> {
  const rawUri = String(uri ?? '').trim();
  if (!rawUri) return null;

  let handle: FileHandle | null = null;
  try {
    const file = new File(rawUri);
    if (!file.exists) return null;
    const fileSize = file.size;
    if (!Number.isFinite(fileSize) || fileSize <= 0) return null;

    handle = file.open(FileMode.ReadOnly);
    const size = handle.size ?? fileSize;
    if (!Number.isFinite(size) || size <= 0) return null;

    const source: TagSource = {
      size,
      read: (offset, length) => {
        if (!handle || offset < 0 || length <= 0 || offset >= size) {
          return new Uint8Array(0);
        }
        handle.offset = offset;
        return handle.readBytes(length);
      },
    };

    return readReplayGainTags(source);
  } catch {
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      // ignore
    }
  }
}
