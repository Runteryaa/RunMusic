/**
 * ReplayGain etiketlerini dosya başlıklarından okuyan SAF (native'siz) ayrıştırıcı.
 *
 * Desteklenen biçimler:
 *  - ID3v2.2 / v2.3 / v2.4 (MP3, WAV/AIFF içindeki ID3 chunk'ları) — TXXX ve RVA2
 *  - FLAC Vorbis yorumları
 *  - Ogg Vorbis / Opus yorumları
 *  - MP4/M4A `----:com.apple.iTunes:replaygain_*` freeform atomları
 *  - APE etiketleri (özellikle eski MP3 arşivleri)
 *
 * Dosya erişimi `TagSource` arayüzüyle soyutlanmıştır; böylece aynı mantık
 * hem Expo FileSystem hem de Node tabanlı testler tarafından kullanılabilir.
 * Bu modül React Native import ETMEZ.
 */

export interface ReplayGainTags {
  trackGainDb?: number;
  trackPeak?: number;
  albumGainDb?: number;
  albumPeak?: number;
}

export interface TagSource {
  readonly size: number;
  /** `offset` konumundan en fazla `length` bayt okur. Kısa okuma dönebilir. */
  read(offset: number, length: number): Uint8Array;
}

const MAX_ID3_TAG_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BLOCK_BYTES = 16 * 1024 * 1024;
const MAX_RAW_SCAN_BYTES = 768 * 1024;

const REPLAY_GAIN_FIELDS: Record<string, keyof ReplayGainTags> = {
  REPLAYGAIN_TRACK_GAIN: 'trackGainDb',
  REPLAYGAIN_TRACK_PEAK: 'trackPeak',
  REPLAYGAIN_ALBUM_GAIN: 'albumGainDb',
  REPLAYGAIN_ALBUM_PEAK: 'albumPeak',
};

function emptyTags(): ReplayGainTags {
  return {};
}

function hasAnyTag(tags: ReplayGainTags): boolean {
  return (
    tags.trackGainDb !== undefined ||
    tags.trackPeak !== undefined ||
    tags.albumGainDb !== undefined ||
    tags.albumPeak !== undefined
  );
}

function finalize(tags: ReplayGainTags): ReplayGainTags | null {
  return hasAnyTag(tags) ? tags : null;
}

function mergeTags(
  first: ReplayGainTags | null,
  second: ReplayGainTags | null
): ReplayGainTags | null {
  if (!first && !second) return null;
  const merged: ReplayGainTags = {
    trackGainDb: first?.trackGainDb ?? second?.trackGainDb,
    trackPeak: first?.trackPeak ?? second?.trackPeak,
    albumGainDb: first?.albumGainDb ?? second?.albumGainDb,
    albumPeak: first?.albumPeak ?? second?.albumPeak,
  };
  return finalize(merged);
}

function readAt(source: TagSource, offset: number, length: number): Uint8Array {
  if (!Number.isFinite(offset) || !Number.isFinite(length)) return new Uint8Array(0);
  if (offset < 0 || length <= 0 || offset >= source.size) return new Uint8Array(0);
  const safeLength = Math.min(Math.floor(length), Math.max(0, source.size - offset));
  if (safeLength <= 0) return new Uint8Array(0);
  try {
    return source.read(Math.floor(offset), safeLength);
  } catch {
    return new Uint8Array(0);
  }
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  text: string
): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const from = Math.max(0, Math.min(start, bytes.length));
  const to = Math.max(from, Math.min(end, bytes.length));
  let out = '';
  for (let i = from; i < to; i++) {
    const code = bytes[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  if (offset + 1 >= bytes.length) return 0;
  return (bytes[offset] * 0x100 + bytes[offset + 1]) >>> 0;
}

function readI16BE(bytes: Uint8Array, offset: number): number {
  const value = readU16BE(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readU24BE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 >= bytes.length) return 0;
  return (bytes[offset] * 0x10000 + bytes[offset + 1] * 0x100 + bytes[offset + 2]) >>> 0;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function readU64BE(bytes: Uint8Array, offset: number): number {
  const high = readU32BE(bytes, offset);
  const low = readU32BE(bytes, offset + 4);
  return high * 0x100000000 + low;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

function syncSafe32(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  ) >>> 0;
}

function classifyTagKey(key: string): keyof ReplayGainTags | null {
  const normalized = key.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return REPLAY_GAIN_FIELDS[normalized] ?? null;
}

function parseNumericTag(value: string): number | undefined {
  const normalized = String(value).replace(',', '.').trim();
  const match = normalized.match(/[-+]?(?:\d+\.?\d*|\.\d+)/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setTag(tags: ReplayGainTags, key: string, value: string): void {
  const field = classifyTagKey(key);
  if (!field) return;
  if (tags[field] !== undefined) return;
  const parsed = parseNumericTag(value);
  if (parsed === undefined) return;
  tags[field] = parsed;
}

function findNullTerminator(
  bytes: Uint8Array,
  start: number,
  encoding: number
): number {
  const twoByte = encoding === 1 || encoding === 2;
  if (twoByte) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
  } else {
    for (let i = start; i < bytes.length; i++) {
      if (bytes[i] === 0) return i;
    }
  }
  return bytes.length;
}

function decodeTagString(
  bytes: Uint8Array,
  start: number,
  end: number,
  encoding: number
): string {
  const from = Math.max(0, Math.min(start, bytes.length));
  const to = Math.max(from, Math.min(end, bytes.length));
  if (from >= to) return '';

  if (encoding === 1 || encoding === 2) {
    let offset = from;
    let littleEndian = encoding === 1;
    if (encoding === 1 && offset + 1 < to) {
      if (bytes[offset] === 0xff && bytes[offset + 1] === 0xfe) {
        littleEndian = true;
        offset += 2;
      } else if (bytes[offset] === 0xfe && bytes[offset + 1] === 0xff) {
        littleEndian = false;
        offset += 2;
      }
    }
    let out = '';
    for (let i = offset; i + 1 < to; i += 2) {
      const code = littleEndian
        ? bytes[i] | (bytes[i + 1] << 8)
        : (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  let out = '';
  for (let i = from; i < to; i++) {
    const code = bytes[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID3v2
// ─────────────────────────────────────────────────────────────────────────────

function deunsynchronise(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let write = 0;
  for (let read = 0; read < bytes.length; read++) {
    out[write++] = bytes[read];
    if (bytes[read] === 0xff && read + 1 < bytes.length && bytes[read + 1] === 0x00) {
      read++;
    }
  }
  return out.subarray(0, write);
}

function parseTxxxFrame(frame: Uint8Array, tags: ReplayGainTags): void {
  if (frame.length < 2) return;
  const encoding = frame[0];
  const descriptionEnd = findNullTerminator(frame, 1, encoding);
  if (descriptionEnd >= frame.length) return;
  const description = decodeTagString(frame, 1, descriptionEnd, encoding);
  const valueStart = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  const value = decodeTagString(frame, valueStart, frame.length, encoding);
  setTag(tags, description, value);
}

function parseRva2Frame(frame: Uint8Array, tags: ReplayGainTags): void {
  const identificationEnd = findNullTerminator(frame, 0, 0);
  if (identificationEnd >= frame.length) return;
  const identification = ascii(frame, 0, identificationEnd).trim().toLowerCase();
  if (identification !== 'track' && identification !== 'album') return;

  let offset = identificationEnd + 1;
  if (offset + 4 > frame.length) return;

  // Kanal türü (0 = mono, 1 = master/left, 2 = right...) şu an kullanılmıyor.
  const gainDb = readI16BE(frame, offset + 1) / 512;
  const peakBits = frame[offset + 3];
  offset += 4;

  let peak: number | undefined;
  const peakBytes = Math.ceil(peakBits / 8);
  if (peakBits > 0 && peakBits <= 32 && peakBytes > 0 && offset + peakBytes <= frame.length) {
    let rawPeak = 0;
    for (let i = 0; i < peakBytes; i++) {
      rawPeak = rawPeak * 0x100 + frame[offset + i];
    }
    // RVA2 tepesi, `peakBits` bitlik işaretsiz bir tam sayıdır.
    peak = rawPeak / Math.pow(2, peakBits);
  }

  if (identification === 'track') {
    if (tags.trackGainDb === undefined) tags.trackGainDb = gainDb;
    if (peak !== undefined && tags.trackPeak === undefined) tags.trackPeak = peak;
  } else {
    if (tags.albumGainDb === undefined) tags.albumGainDb = gainDb;
    if (peak !== undefined && tags.albumPeak === undefined) tags.albumPeak = peak;
  }
}

function parseId3TagData(data: Uint8Array): ReplayGainTags | null {
  if (data.length < 10 || !matchesAscii(data, 0, 'ID3')) return null;

  const major = data[3];
  if (major < 2 || major > 4) return null;
  const flags = data[5];
  const declaredSize = syncSafe32(data, 6);
  if (declaredSize <= 0) return null;

  let tag = data.subarray(10, Math.min(data.length, 10 + declaredSize));
  if (flags & 0x80) tag = deunsynchronise(tag);

  let position = 0;
  if (flags & 0x40) {
    // Genişletilmiş başlık. v2.3'te 4 baytlık boyut (kendisi hariç),
    // v2.4'te syncsafe boyut (kendisi dahil) bulunur.
    if (major === 3 && tag.length >= 4) {
      position = 4 + readU32BE(tag, 0);
    } else if (major === 4 && tag.length >= 4) {
      position = syncSafe32(tag, 0);
    }
  }

  const tags = emptyTags();
  const headerSize = major === 2 ? 6 : 10;
  const idSize = major === 2 ? 3 : 4;

  let guard = 0;
  while (position + headerSize <= tag.length && guard++ < 100000) {
    const id = ascii(tag, position, position + idSize);
    if (!/^[A-Z0-9]+$/.test(id)) break;

    let frameSize: number;
    if (major === 2) {
      frameSize = readU24BE(tag, position + 3);
    } else if (major === 4) {
      frameSize = syncSafe32(tag, position + 4);
    } else {
      frameSize = readU32BE(tag, position + 4);
    }

    if (frameSize <= 0 || position + headerSize + frameSize > tag.length) break;

    let frame = tag.subarray(position + headerSize, position + headerSize + frameSize);

    if (major === 3) {
      const frameFlags = readU16BE(tag, position + 8);
      // Sıkıştırma / şifreleme / gruplama varsa atla.
      if (frameFlags & 0x00e0) {
        position += headerSize + frameSize;
        continue;
      }
    } else if (major === 4) {
      const frameFlags = readU16BE(tag, position + 8);
      // Gruplama / sıkıştırma / şifreleme varsa atla.
      if (frameFlags & 0x004c) {
        position += headerSize + frameSize;
        continue;
      }
      if (frameFlags & 0x0002) frame = deunsynchronise(frame);
      if (frameFlags & 0x0001) frame = frame.subarray(4);
    }

    if (id === 'TXXX' || id === 'TXX') {
      parseTxxxFrame(frame, tags);
    } else if (id === 'RVA2') {
      parseRva2Frame(frame, tags);
    }

    position += headerSize + frameSize;
  }

  return finalize(tags);
}

function parseId3v2(source: TagSource): ReplayGainTags | null {
  const header = readAt(source, 0, 10);
  if (header.length < 10 || !matchesAscii(header, 0, 'ID3')) return null;
  const declaredSize = syncSafe32(header, 6);
  if (declaredSize <= 0 || declaredSize > MAX_ID3_TAG_BYTES) return null;
  const data = readAt(source, 0, 10 + declaredSize);
  return parseId3TagData(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorbis yorumları (FLAC / Ogg)
// ─────────────────────────────────────────────────────────────────────────────

function parseVorbisComments(data: Uint8Array): ReplayGainTags | null {
  if (data.length < 8) return null;

  let offset = 0;
  const vendorLength = readU32LE(data, offset);
  offset += 4;
  if (vendorLength > data.length - offset) return null;
  offset += vendorLength;

  if (offset + 4 > data.length) return null;
  const commentCount = readU32LE(data, offset);
  offset += 4;

  const tags = emptyTags();
  const safeCount = Math.min(commentCount, 10000);

  for (let i = 0; i < safeCount; i++) {
    if (offset + 4 > data.length) break;
    const length = readU32LE(data, offset);
    offset += 4;
    if (length > data.length - offset) break;

    const entry = ascii(data, offset, offset + length);
    offset += length;

    const equals = entry.indexOf('=');
    if (equals > 0) {
      setTag(tags, entry.slice(0, equals), entry.slice(equals + 1));
    }
  }

  return finalize(tags);
}

function parseFlac(source: TagSource): ReplayGainTags | null {
  let offset = 4;
  for (let guard = 0; guard < 256 && offset + 4 <= source.size; guard++) {
    const header = readAt(source, offset, 4);
    if (header.length < 4) break;

    const lastBlock = (header[0] & 0x80) !== 0;
    const blockType = header[0] & 0x7f;
    const length = readU24BE(header, 1);

    if (length < 0 || length > MAX_METADATA_BLOCK_BYTES || offset + 4 + length > source.size) {
      break;
    }

    if (blockType === 4) {
      const comments = readAt(source, offset + 4, length);
      return parseVorbisComments(comments);
    }

    offset += 4 + length;
    if (lastBlock) break;
  }
  return null;
}

function indexOfBytes(haystack: Uint8Array, needle: number[]): number {
  if (needle.length === 0) return 0;
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}

function parseOgg(source: TagSource): ReplayGainTags | null {
  const maxScan = Math.min(source.size, 4 * 1024 * 1024);
  let offset = 0;
  let guard = 0;

  while (offset + 27 <= maxScan && guard++ < 4096) {
    const header = readAt(source, offset, 27);
    if (header.length < 27 || !matchesAscii(header, 0, 'OggS')) {
      offset++;
      continue;
    }

    const segmentCount = header[26];
    const segmentTable = readAt(source, offset + 27, segmentCount);
    if (segmentTable.length < segmentCount) break;

    let dataLength = 0;
    for (let i = 0; i < segmentCount; i++) {
      dataLength += segmentTable[i];
    }

    const data = readAt(source, offset + 27 + segmentCount, dataLength);

    const vorbisMarker = [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73];
    const vorbisAt = indexOfBytes(data, vorbisMarker);
    if (vorbisAt >= 0) {
      const tags = parseVorbisComments(data.subarray(vorbisAt + vorbisMarker.length));
      if (tags) return tags;
    }

    const opusAt = indexOfBytes(data, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]);
    if (opusAt >= 0) {
      const tags = parseVorbisComments(data.subarray(opusAt + 8));
      if (tags) return tags;
    }

    offset += 27 + segmentCount + dataLength;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MP4 / M4A
// ─────────────────────────────────────────────────────────────────────────────

function readFullBoxString(source: TagSource, start: number, end: number): string {
  if (start + 4 > end) return '';
  const data = readAt(source, start + 4, end - start - 4);
  return ascii(data, 0, data.length);
}

function readDataBoxValue(source: TagSource, start: number, end: number): Uint8Array | null {
  if (start + 8 > end) return null;
  return readAt(source, start + 8, end - start - 8);
}

function parseIlstItem(
  source: TagSource,
  start: number,
  end: number,
  tags: ReplayGainTags
): void {
  let name = '';
  let value: Uint8Array | null = null;
  let position = start;
  let guard = 0;

  while (position + 8 <= end && guard++ < 128) {
    const header = readAt(source, position, 16);
    if (header.length < 8) break;

    let size = readU32BE(header, 0);
    const type = ascii(header, 4, 8);
    let headerSize = 8;

    if (size === 1) {
      if (header.length < 16) break;
      size = readU64BE(header, 8);
      headerSize = 16;
    }
    if (size === 0) size = end - position;
    if (size < headerSize || position + size > end) break;

    const payloadStart = position + headerSize;
    const payloadEnd = position + size;

    if (type === 'name') {
      name = readFullBoxString(source, payloadStart, payloadEnd);
    } else if (type === 'data') {
      value = readDataBoxValue(source, payloadStart, payloadEnd);
    }

    position += size;
  }

  if (!name || !value) return;
  const key = name.trim();
  if (!classifyTagKey(key)) return;
  setTag(tags, key, ascii(value, 0, value.length));
}

function parseMp4Boxes(
  source: TagSource,
  start: number,
  end: number,
  depth: number,
  found: ReplayGainTags = emptyTags()
): ReplayGainTags | null {
  if (depth > 8) return finalize(found);

  let position = start;
  let guard = 0;

  while (position + 8 <= end && guard++ < 100000) {
    const header = readAt(source, position, 16);
    if (header.length < 8) break;

    let size = readU32BE(header, 0);
    const type = ascii(header, 4, 8);
    let headerSize = 8;

    if (size === 1) {
      if (header.length < 16) break;
      size = readU64BE(header, 8);
      headerSize = 16;
    }
    if (size === 0) size = end - position;
    if (size < headerSize || position + size > end) break;

    const payloadStart = position + headerSize;
    const payloadEnd = position + size;

    if (type === 'moov' || type === 'udta' || type === 'ilst') {
      parseMp4Boxes(source, payloadStart, payloadEnd, depth + 1, found);
    } else if (type === 'meta') {
      // `meta` bir full box'tır: 4 bayt sürüm/bayrak.
      parseMp4Boxes(source, payloadStart + 4, payloadEnd, depth + 1, found);
    } else if (type === '----') {
      parseIlstItem(source, payloadStart, payloadEnd, found);
    }

    position += size;
  }

  return finalize(found);
}

// ─────────────────────────────────────────────────────────────────────────────
// APE etiketleri
// ─────────────────────────────────────────────────────────────────────────────

function parseApe(source: TagSource): ReplayGainTags | null {
  const tailLength = Math.min(192, source.size);
  if (tailLength < 32) return null;

  const tailStart = source.size - tailLength;
  const tail = readAt(source, tailStart, tailLength);
  if (tail.length < 32) return null;

  let footerIndex = -1;
  for (let i = tail.length - 32; i >= 0; i--) {
    if (matchesAscii(tail, i, 'APETAGEX')) {
      footerIndex = i;
      break;
    }
  }
  if (footerIndex < 0) return null;

  const tagSize = readU32LE(tail, footerIndex + 12);
  const itemCount = readU32LE(tail, footerIndex + 16);
  if (tagSize < 32 || tagSize > MAX_METADATA_BLOCK_BYTES) return null;

  const footerAbsolute = tailStart + footerIndex;
  const tagStart = footerAbsolute + 32 - tagSize;
  if (tagStart < 0 || tagStart >= source.size) return null;

  const data = readAt(source, tagStart, tagSize - 32);
  const tags = emptyTags();
  let position = 0;

  for (let i = 0; i < Math.min(itemCount, 1000); i++) {
    if (position + 8 > data.length) break;
    const valueSize = readU32LE(data, position);
    position += 8; // value size + item flags

    const keyEnd = findNullTerminator(data, position, 0);
    if (keyEnd >= data.length) break;
    const key = ascii(data, position, keyEnd);
    position = keyEnd + 1;

    if (valueSize > data.length - position) break;
    const value = decodeTagString(data, position, position + valueSize, 0);
    position += valueSize;
    setTag(tags, key, value);
  }

  return finalize(tags);
}

// ─────────────────────────────────────────────────────────────────────────────
// WAV / RIFF (ID3 chunk)
// ─────────────────────────────────────────────────────────────────────────────

function parseRiff(source: TagSource): ReplayGainTags | null {
  const header = readAt(source, 0, 12);
  if (header.length < 12 || !matchesAscii(header, 0, 'RIFF')) return null;

  let position = 12;
  let guard = 0;

  while (position + 8 <= source.size && guard++ < 4096) {
    const chunk = readAt(source, position, 8);
    if (chunk.length < 8) break;

    const id = ascii(chunk, 0, 4);
    const size = readU32LE(chunk, 4);
    if (size < 0 || position + 8 + size > source.size) break;

    if (id === 'ID3 ' || id === 'id3 ') {
      const tagData = readAt(source, position + 8, Math.min(size, MAX_ID3_TAG_BYTES));
      const tags = parseId3TagData(tagData);
      if (tags) return tags;
    }

    position += 8 + size + (size & 1);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ham metin taraması (yaygın Vorbis/ID3 TXXX biçimleri için yedek)
// ─────────────────────────────────────────────────────────────────────────────

function scanRawTextTags(source: TagSource): ReplayGainTags | null {
  const length = Math.min(source.size, MAX_RAW_SCAN_BYTES);
  if (length <= 0) return null;

  const data = readAt(source, 0, length);
  const text = latin1(data);
  const pattern =
    /REPLAYGAIN[\s_-]+(TRACK|ALBUM)[\s_-]+(GAIN|PEAK)[\s\0=:]*([-+]?\d+(?:[.,]\d+)?(?:\s*dB)?)/gi;

  const tags = emptyTags();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = `REPLAYGAIN_${match[1]}_${match[2]}`;
    setTag(tags, key, match[3]);
  }

  return finalize(tags);
}

// ─────────────────────────────────────────────────────────────────────────────
// Genel giriş noktası
// ─────────────────────────────────────────────────────────────────────────────

export function readReplayGainTags(source: TagSource): ReplayGainTags | null {
  try {
    const header = readAt(source, 0, 12);
    if (header.length < 4) {
      return parseApe(source);
    }

    let tags: ReplayGainTags | null = null;

    if (matchesAscii(header, 0, 'ID3')) {
      tags = parseId3v2(source);
    } else if (matchesAscii(header, 0, 'fLaC')) {
      tags = parseFlac(source);
    } else if (matchesAscii(header, 0, 'OggS')) {
      tags = parseOgg(source);
    } else if (header.length >= 8 && matchesAscii(header, 4, 'ftyp')) {
      tags = parseMp4Boxes(source, 0, source.size, 0);
    } else if (matchesAscii(header, 0, 'RIFF')) {
      tags = parseRiff(source);
    }

    if (!tags) {
      tags = scanRawTextTags(source);
    }

    const apeTags = parseApe(source);
    return mergeTags(tags, apeTags);
  } catch {
    return null;
  }
}
