/**
 * ReplayGain etiket ayrıştırıcısının (src/services/replayGainTags.ts)
 * sentetik dosya başlıklarıyla doğrulanması.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-replay-gain.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-replay-gain.js
 */

import {
  readReplayGainTags,
  type ReplayGainTags,
  type TagSource,
} from '../src/services/replayGainTags';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function approx(name: string, actual: number | undefined, expected: number, epsilon = 0.001): void {
  check(
    name,
    typeof actual === 'number' && Math.abs(actual - expected) <= epsilon,
    `actual=${String(actual)}, expected=${expected}`
  );
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bayt yardımcıları
// ─────────────────────────────────────────────────────────────────────────────

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text.split('').map((char) => char.charCodeAt(0) & 0xff));
}

function u16be(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

function i16be(value: number): Uint8Array {
  return u16be(value < 0 ? value + 0x10000 : value);
}

function u24be(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function u32be(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function u32le(value: number): Uint8Array {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function syncSafe(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = (code >>> 8) & 0xff;
  }
  return out;
}

function sourceFrom(bytes: Uint8Array): TagSource {
  return {
    size: bytes.length,
    read: (offset, length) => bytes.slice(offset, offset + length),
  };
}

function parse(bytes: Uint8Array): ReplayGainTags | null {
  return readReplayGainTags(sourceFrom(bytes));
}

// ─────────────────────────────────────────────────────────────────────────────
// ID3v2 kurucuları
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ID3v2.3/2.4 TXXX çerçevesi.
 * `encoding`: 0 = ISO-8859-1, 1 = UTF-16LE (BOM'suz).
 */
function txxxFrame(
  description: string,
  value: string,
  major: 3 | 4 = 3,
  encoding: 0 | 1 = 0
): Uint8Array {
  const descriptionBytes = encoding === 1 ? utf16le(description) : asciiBytes(description);
  const valueBytes = encoding === 1 ? utf16le(value) : asciiBytes(value);
  const terminator = encoding === 1 ? new Uint8Array([0, 0]) : new Uint8Array([0]);
  const payload = concat(
    Uint8Array.from([encoding]),
    descriptionBytes,
    terminator,
    valueBytes,
    terminator
  );
  const frameSize = major === 4 ? syncSafe(payload.length) : u32be(payload.length);
  return concat(asciiBytes('TXXX'), frameSize, u16be(0), payload);
}

function rva2Frame(identification: string, gainDb: number, peak: number): Uint8Array {
  const gainRaw = Math.round(gainDb * 512);
  const peakBits = 16;
  const peakRaw = Math.round(peak * Math.pow(2, peakBits));
  const payload = concat(
    asciiBytes(identification),
    new Uint8Array([0]),
    Uint8Array.from([1]), // master channel
    i16be(gainRaw),
    Uint8Array.from([peakBits]),
    u16be(peakRaw)
  );
  return concat(asciiBytes('RVA2'), u32be(payload.length), u16be(0), payload);
}

function id3Tag(major: 3 | 4, frames: Uint8Array[]): Uint8Array {
  const body = concat(...frames);
  return concat(asciiBytes('ID3'), Uint8Array.from([major, 0, 0]), syncSafe(body.length), body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vorbis / FLAC / Ogg kurucuları
// ─────────────────────────────────────────────────────────────────────────────

function vorbisComments(comments: string[]): Uint8Array {
  const vendor = asciiBytes('RunMusic test');
  const parts: Uint8Array[] = [u32le(vendor.length), vendor, u32le(comments.length)];
  for (const comment of comments) {
    const bytes = asciiBytes(comment);
    parts.push(u32le(bytes.length), bytes);
  }
  return concat(...parts);
}

function flacFile(comments: string[]): Uint8Array {
  const streamInfo = new Uint8Array(34);
  const streamInfoHeader = concat(Uint8Array.from([0x00]), u24be(streamInfo.length));
  const commentData = vorbisComments(comments);
  const commentHeader = concat(Uint8Array.from([0x84]), u24be(commentData.length));
  return concat(asciiBytes('fLaC'), streamInfoHeader, streamInfo, commentHeader, commentData);
}

function oggPage(packetPrefix: Uint8Array, comments: string[]): Uint8Array {
  const packet = concat(packetPrefix, vorbisComments(comments));
  const segmentCount = Math.ceil(packet.length / 255);
  const segments = new Uint8Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    segments[i] = Math.min(255, packet.length - i * 255);
  }
  const header = concat(
    asciiBytes('OggS'),
    Uint8Array.from([0, 0]),
    new Uint8Array(8),
    u32le(1),
    u32le(0),
    u32le(0),
    Uint8Array.from([segmentCount]),
    segments
  );
  return concat(header, packet);
}

// ─────────────────────────────────────────────────────────────────────────────
// MP4 kurucuları
// ─────────────────────────────────────────────────────────────────────────────

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32be(8 + payload.length), asciiBytes(type), payload);
}

function fullBox(type: string, versionFlags: number, payload: Uint8Array): Uint8Array {
  return box(type, concat(u32be(versionFlags), payload));
}

function mp4File(trackGain: string, albumGain: string): Uint8Array {
  const mean = fullBox('mean', 0, asciiBytes('com.apple.iTunes'));
  const trackName = fullBox('name', 0, asciiBytes('replaygain_track_gain'));
  const trackData = box(
    'data',
    concat(u32be(1), u32be(0), asciiBytes(trackGain))
  );
  const albumName = fullBox('name', 0, asciiBytes('replaygain_album_gain'));
  const albumData = box(
    'data',
    concat(u32be(1), u32be(0), asciiBytes(albumGain))
  );

  const trackItem = box('----', concat(mean, trackName, trackData));
  const albumItem = box('----', concat(mean, albumName, albumData));
  const ilst = box('ilst', concat(trackItem, albumItem));
  const meta = fullBox('meta', 0, ilst);
  const udta = box('udta', meta);
  const moov = box('moov', udta);
  const ftyp = box('ftyp', asciiBytes('M4A '));
  return concat(ftyp, moov);
}

// ─────────────────────────────────────────────────────────────────────────────
// APE / RIFF kurucuları
// ─────────────────────────────────────────────────────────────────────────────

function apeFile(key: string, value: string): Uint8Array {
  const keyBytes = concat(asciiBytes(key), new Uint8Array([0]));
  const valueBytes = asciiBytes(value);
  const item = concat(u32le(valueBytes.length), u32le(0), keyBytes, valueBytes);
  const footer = concat(
    asciiBytes('APETAGEX'),
    u32le(2000),
    u32le(32 + item.length),
    u32le(1),
    u32le(0),
    new Uint8Array(8)
  );
  return concat(item, footer);
}

function riffFileWithId3(tag: Uint8Array): Uint8Array {
  const chunk = concat(asciiBytes('ID3 '), u32le(tag.length), tag);
  const padding = tag.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  const body = concat(asciiBytes('WAVE'), chunk, padding);
  return concat(asciiBytes('RIFF'), u32le(body.length), body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Testler
// ─────────────────────────────────────────────────────────────────────────────

section('1) ID3v2.3 TXXX');

const id3v23 = id3Tag(3, [
  txxxFrame('REPLAYGAIN_TRACK_GAIN', '-7.25 dB'),
  txxxFrame('REPLAYGAIN_TRACK_PEAK', '0.9876'),
  txxxFrame('REPLAYGAIN_ALBUM_GAIN', '+2.00 dB'),
  txxxFrame('REPLAYGAIN_ALBUM_PEAK', '1.0200'),
]);
const tagsId3v23 = parse(id3v23);
approx('track gain', tagsId3v23?.trackGainDb, -7.25);
approx('track peak', tagsId3v23?.trackPeak, 0.9876);
approx('album gain', tagsId3v23?.albumGainDb, 2);
approx('album peak', tagsId3v23?.albumPeak, 1.02);

section('2) ID3v2.4 UTF-16 TXXX ve virgüllü ondalık');

const id3v24 = id3Tag(4, [
  txxxFrame('REPLAYGAIN_TRACK_GAIN', '-3,50 dB', 4, 1),
  txxxFrame('REPLAYGAIN_ALBUM_GAIN', '-4.5 dB', 4, 1),
]);
const tagsId3v24 = parse(id3v24);
approx('UTF-16 track gain', tagsId3v24?.trackGainDb, -3.5);
approx('UTF-16 album gain', tagsId3v24?.albumGainDb, -4.5);

section('3) ID3v2.3 RVA2');

const id3Rva2 = id3Tag(3, [rva2Frame('track', -6.02, 0.98)]);
const tagsRva2 = parse(id3Rva2);
approx('RVA2 track gain', tagsRva2?.trackGainDb, -6.0195);
approx('RVA2 track peak', tagsRva2?.trackPeak, 0.98);

section('4) FLAC Vorbis yorumları');

const flac = flacFile([
  'REPLAYGAIN_TRACK_GAIN=-6.50 dB',
  'REPLAYGAIN_TRACK_PEAK=0.8123',
  'REPLAYGAIN_ALBUM_GAIN=-5.00 dB',
  'REPLAYGAIN_ALBUM_PEAK=0.9000',
]);
const tagsFlac = parse(flac);
approx('FLAC track gain', tagsFlac?.trackGainDb, -6.5);
approx('FLAC track peak', tagsFlac?.trackPeak, 0.8123);
approx('FLAC album gain', tagsFlac?.albumGainDb, -5);
approx('FLAC album peak', tagsFlac?.albumPeak, 0.9);

section('5) Ogg Vorbis');

const oggVorbis = oggPage(Uint8Array.from([0x03]), ['REPLAYGAIN_TRACK_GAIN=-3.20 dB']);
const tagsOggVorbis = parse(oggVorbis);
approx('Ogg Vorbis track gain', tagsOggVorbis?.trackGainDb, -3.2);

section('6) Ogg Opus');

const oggOpus = oggPage(asciiBytes('OpusTags'), ['REPLAYGAIN_ALBUM_GAIN=-4.40 dB']);
const tagsOggOpus = parse(oggOpus);
approx('Ogg Opus album gain', tagsOggOpus?.albumGainDb, -4.4);

section('7) MP4 / M4A freeform atomları');

const mp4 = mp4File('-8.10 dB', '-2.00 dB');
const tagsMp4 = parse(mp4);
approx('MP4 track gain', tagsMp4?.trackGainDb, -8.1);
approx('MP4 album gain', tagsMp4?.albumGainDb, -2);

section('8) APE etiketi');

const ape = apeFile('REPLAYGAIN_TRACK_GAIN', '-9.00 dB');
const tagsApe = parse(ape);
approx('APE track gain', tagsApe?.trackGainDb, -9);

section('9) RIFF/WAV içindeki ID3 chunk');

const riff = riffFileWithId3(id3Tag(3, [txxxFrame('REPLAYGAIN_ALBUM_GAIN', '-2.50 dB')]));
const tagsRiff = parse(riff);
approx('RIFF ID3 album gain', tagsRiff?.albumGainDb, -2.5);

section('10) Ham metin yedeği ve etiketsiz dosya');

const raw = concat(
  asciiBytes('XXXX'),
  asciiBytes('REPLAYGAIN_TRACK_GAIN'),
  new Uint8Array([0]),
  asciiBytes('-3.50 dB')
);
const tagsRaw = parse(raw);
approx('ham metin track gain', tagsRaw?.trackGainDb, -3.5);

check('ReplayGain etiketi olmayan dosya null döndürüyor', parse(asciiBytes('not a music file')) === null);

section('Sonuç');

if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
}
