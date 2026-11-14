/**
 * Apple Music TTML söz formatı için bağımlılıksız parser.
 *
 * Belge yapısı:
 *   <p begin end>            → bir söz satırı
 *     <span begin end>…</span> → bir hece
 *   </p>
 *
 * Bir kelimenin heceleri arasında boşluk yoktur ("Mo" + "tor" + "ways");
 * kelimeleri ayıran şey span sınırı değil, aradaki **whitespace**'tir.
 * Formatta DOMParser gerektiren bir yapı yok; React Native/Hermes'te de
 * çalışsın diye küçük, toleranslı bir tarayıcı kullanılır.
 *
 * Apple'ın kendi belgeleri dışında lrc.red de aynı biçimi (`lrc:timing="Word"`
 * veya `"Line"`) döndürür. `x-translation` / `x-roman` aynı kelimelerin ikinci
 * bir dökümü olduğu için atlanır; `x-bg` ise cevap vokalidir ve satırın altına
 * ayrı bir `background` satırı olarak taşınır.
 */

import type { LyricLine, LyricWord } from './lyricsTypes';

/** Kısa enstrümantal araları kesinti saymaya değmez. */
export const MIN_GAP_MS = 4000;

const SKIPPED_ROLES = new Set(['x-translation', 'x-roman']);
const BACKGROUND_ROLE = 'x-bg';

interface Piece {
  text: string;
  time: number;
  endTime?: number;
  background: boolean;
  spaceBefore: boolean;
}

interface OpenSpan {
  begin?: number;
  end?: number;
  skipped: boolean;
  background: boolean;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Niteliği tam adıyla (`ttm:role`) ya da yerel adıyla (`role`) okur.
 * Bazı XML uygulamaları prefix'i nitelik adından düşürür.
 */
function getAttribute(attrs: Record<string, string>, name: string): string {
  if (attrs[name] !== undefined) return attrs[name];
  const local = name.split(':').pop() || name;
  for (const key of Object.keys(attrs)) {
    if (key === name || key.split(':').pop() === local) return attrs[key];
  }
  return '';
}

/** `12.345`, `0:12.345`, `1:02:03.456` biçimlerini saniyeye çevirir. */
export function parseTtmlTime(value?: string | null): number | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const plain = raw.endsWith('s') ? raw.slice(0, -1) : raw;
  if (/^\d+(\.\d+)?$/.test(plain)) {
    const seconds = Number(plain);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  const parts = plain.split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n))) return undefined;
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

/** Bir `<p>`/`<div>` etiketinin içeriğini (açılış etiketinden sonra) döndürür. */
type XmlBlock = { attrs: Record<string, string>; inner: string };

function findBlocks(xml: string, tag: string): XmlBlock[] {
  const blocks: XmlBlock[] = [];
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  const closeTag = `</${tag}>`;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(xml)) !== null) {
    const start = openRe.lastIndex;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    blocks.push({ attrs: parseAttributes(match[1]), inner: xml.slice(start, end) });
    openRe.lastIndex = end + closeTag.length;
  }
  return blocks;
}

function nearestTimedSpan(stack: OpenSpan[]): OpenSpan | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].begin !== undefined) return stack[i];
  }
  return null;
}

/**
 * Paragraf içeriğini zamanlı parçalara (hecelere) indirger.
 * İç içe span'lar en içteki zamanlamaya iner; `x-bg` alt ağacı ayrı işaretlenir.
 */
function collectPieces(inner: string): Piece[] {
  const pieces: Piece[] = [];
  const stack: OpenSpan[] = [];
  let pendingSpace = false;

  const pushText = (raw: string) => {
    if (!raw) return;
    const decoded = decodeEntities(raw);
    if (!decoded) return;

    const span = nearestTimedSpan(stack);
    const skipped = stack.some((entry) => entry.skipped);
    if (skipped || !span) {
      // Zamanlı bir span'ın dışındaki metin yalnızca kelime ayırıcı olabilir.
      if (/\s/.test(decoded)) pendingSpace = true;
      return;
    }

    if (!/\S/.test(decoded)) {
      pendingSpace = true;
      return;
    }

    const startsWithSpace = /^\s/.test(decoded);
    const endsWithSpace = /\s$/.test(decoded);
    const words = decoded.trim().split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      pieces.push({
        text: word,
        time: span.begin as number,
        endTime: span.end,
        background: span.background,
        spaceBefore: index > 0 || startsWithSpace || pendingSpace,
      });
    });
    pendingSpace = endsWithSpace;
  };

  let cursor = 0;
  while (cursor < inner.length) {
    const lt = inner.indexOf('<', cursor);
    if (lt === -1) {
      pushText(inner.slice(cursor));
      break;
    }
    if (lt > cursor) pushText(inner.slice(cursor, lt));
    const gt = inner.indexOf('>', lt);
    if (gt === -1) break;
    const rawTag = inner.slice(lt + 1, gt);
    cursor = gt + 1;

    if (rawTag.startsWith('!--')) {
      const commentEnd = inner.indexOf('-->', lt);
      cursor = commentEnd === -1 ? inner.length : commentEnd + 3;
      continue;
    }
    if (rawTag.startsWith('?') || rawTag.startsWith('!')) continue;

    const closing = rawTag.startsWith('/');
    const selfClosing = rawTag.endsWith('/');
    const body = rawTag.replace(/^\//, '').replace(/\/$/, '').trim();
    const nameMatch = body.match(/^([A-Za-z_][\w:.-]*)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';

    if (closing) {
      stack.pop();
      continue;
    }

    if (name === 'br') {
      pendingSpace = true;
      continue;
    }

    const attrs = parseAttributes(body);
    const role = getAttribute(attrs, 'ttm:role').toLowerCase();
    const parentSkipped = stack.some((entry) => entry.skipped);
    const parentBackground = stack.some((entry) => entry.background);
    const span: OpenSpan = {
      begin: parseTtmlTime(getAttribute(attrs, 'begin')),
      end: parseTtmlTime(getAttribute(attrs, 'end')),
      skipped: parentSkipped || SKIPPED_ROLES.has(role),
      background: parentBackground || role === BACKGROUND_ROLE,
    };

    if (!selfClosing) stack.push(span);
  }

  return pieces;
}

/** Parçaları, aralarındaki boşluğa göre kelimelere birleştirir. */
function mergeWords(pieces: Piece[], background: boolean): LyricWord[] {
  const words: LyricWord[] = [];
  let current: LyricWord | null = null;

  for (const piece of pieces) {
    if (piece.background !== background) continue;
    if (!current || piece.spaceBefore) {
      if (current) words.push(current);
      current = { time: piece.time, endTime: piece.endTime, text: piece.text };
    } else {
      current.text += piece.text;
      if (piece.endTime !== undefined) current.endTime = piece.endTime;
    }
  }
  if (current) words.push(current);

  // `end` vermeyen heceler için sonraki hecenin başlangıcını kullan.
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].endTime === undefined) words[i].endTime = words[i + 1].time;
  }
  return words;
}

function textWithoutTags(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLine(attrs: Record<string, string>, inner: string): LyricLine | null {
  const begin = parseTtmlTime(getAttribute(attrs, 'begin'));
  if (begin === undefined) return null;

  const pieces = collectPieces(inner);
  const words = mergeWords(pieces, false);
  const backingWords = mergeWords(pieces, true);

  let line: LyricLine;
  if (words.length === 0) {
    // Satır senkronlu TTML: <p begin>düz metin</p>. Arka vokal ayrımı için
    // zaman bilgisi yok; parantez fallback'i UI tarafında uygulanır.
    const text = textWithoutTags(inner);
    if (!text) return null;
    const end = parseTtmlTime(getAttribute(attrs, 'end'));
    line = { time: begin, text, endTime: end !== undefined && end > begin ? end : undefined };
  } else {
    const end = parseTtmlTime(getAttribute(attrs, 'end'));
    const firstWordTime = Math.min(begin, words[0].time);
    line = {
      time: firstWordTime,
      // Satırın kendi `end`'i, şarkı söylemenin bittiği anı söyler ve boşluk
      // (enstrümantal ara) tespiti buna dayanır.
      endTime: end !== undefined && end > firstWordTime ? end : words[words.length - 1].endTime,
      text: words.map((word) => word.text).join(' '),
      words,
    };
  }

  if (backingWords.length > 0) {
    const first = backingWords[0];
    line.background = {
      time: first.time,
      endTime: backingWords[backingWords.length - 1].endTime,
      text: backingWords.map((word) => word.text).join(' '),
      words: backingWords,
    };
  }

  const agent = getAttribute(attrs, 'ttm:agent');
  if (agent) line.agent = agent;
  return line;
}

/**
 * TTML belgesini `LyricLine[]` dizisine çevirir.
 *
 * Farklı `ttm:agent` kimlikleri varsa (duet), ilk söyleyen sol, ikincisi sağ
 * tarafa hizalanır. Apple Music bu ayrımı satırları kaydırarak gösterir.
 */
export function parseTtml(ttml: string): LyricLine[] {
  if (!ttml || ttml.indexOf('<p') === -1) return [];

  const lines: LyricLine[] = [];
  for (const block of findBlocks(ttml, 'p')) {
    const line = buildLine(block.attrs, block.inner);
    if (line) lines.push(line);
  }
  lines.sort((a, b) => a.time - b.time);

  const agentOrder: string[] = [];
  for (const line of lines) {
    if (line.agent && !agentOrder.includes(line.agent)) agentOrder.push(line.agent);
  }
  // Tek söyleyen varsa hizalama bilgisi anlamsızdır; her satır solda kalır.
  if (agentOrder.length > 1) {
    for (const line of lines) {
      if (!line.agent) continue;
      line.alignment = agentOrder.indexOf(line.agent) === 0 ? 'start' : 'end';
    }
  }

  return lines;
}

export interface LyricGapRow {
  kind: 'gap';
  key: string;
  time: number;
  endTime: number;
}

export interface LyricLineRow {
  kind: 'line';
  key: string;
  time: number;
  endTime?: number;
  line: LyricLine;
}

export type LyricDisplayRow = LyricLineRow | LyricGapRow;

/**
 * Satırların arasına enstrümantal ara işaretleri yerleştirir.
 *
 * İşaret yalnızca **önceki satırın bilinen bir bitişi** varsa çizilir; aksi
 * halde sonraki satıra olan mesafe satırın kendi süresidir ve her satırdan
 * sonra nokta çıkardı. İlk satır 4 sn'den sonra başlıyorsa intro da bir ara
 * olarak işaretlenir.
 */
export function buildLyricRows(lines: LyricLine[]): LyricDisplayRow[] {
  if (lines.length === 0) return [];

  const rows: LyricDisplayRow[] = [];
  const first = lines[0];
  if (first.time * 1000 >= MIN_GAP_MS) {
    rows.push({ kind: 'gap', key: 'gap-intro', time: 0, endTime: first.time });
  }

  lines.forEach((line, index) => {
    rows.push({ kind: 'line', key: `line-${index}`, time: line.time, endTime: line.endTime, line });

    const next = lines[index + 1];
    if (!next || line.endTime === undefined) return;
    if (line.endTime <= line.time) return;

    const silenceMs = (next.time - line.endTime) * 1000;
    if (silenceMs >= MIN_GAP_MS) {
      rows.push({
        kind: 'gap',
        key: `gap-${index}`,
        time: line.endTime,
        endTime: next.time,
      });
    }
  });

  return rows;
}

/** Genius'un `[Verse]`, `[Chorus 2: Artist]` gibi bölüm başlıkları mı? */
export function isGeniusSectionHeader(text: string): boolean {
  const trimmed = (text || '').trim();
  return (
    trimmed.startsWith('[') &&
    trimmed.endsWith(']') &&
    trimmed.length >= 3 &&
    trimmed.length <= 60
  );
}

/**
 * `[Verse 2: Artist]` → `Verse 2`.
 *
 * Apple Music ham köşeli parantez göstermez; panel bunu küçük, sakin bir
 * etikete çevirir. Sanatçı notu etiketten düşürülür.
 */
export function getGeniusSectionLabel(text: string): string {
  const trimmed = (text || '').trim();
  if (!isGeniusSectionHeader(trimmed)) return '';
  const inner = trimmed.slice(1, -1).trim();
  const withoutArtist = inner.split(':')[0].trim();
  return withoutArtist || inner;
}

/** Satır sonundaki parantezin açılış indeksi; yoksa null. */
function trailingBracketStart(text: string): number | null {
  if (!text.endsWith(')')) return null;
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] === ')') depth++;
    else if (text[index] === '(') {
      depth--;
      if (depth === 0) return index > 0 ? index : null;
    }
  }
  return null;
}

function wordIndexAtOffset(words: LyricWord[], offset: number): number | null {
  let at = 0;
  for (let index = 0; index < words.length; index++) {
    if (at === offset) return index;
    if (at > offset) return null;
    at += words[index].text.length + 1;
  }
  return null;
}

/**
 * Satır sonundaki `( ... )` parantezini ayrı bir arka vokal satırına böler.
 *
 * Apple dışındaki kaynaklar (LRCLIB, Genius) cevap vokalini parantez içinde
 * yazar. Parantez metinde kalır: kaynak ne yayınladıysa odur ve küçük alt
 * satır zaten "bu cevap" demektedir.
 */
export function splitBackgroundVocals(lines: LyricLine[]): LyricLine[] {
  return lines.map((line) => {
    if (line.background) return line;

    const text = line.text || '';
    const open = trailingBracketStart(text);
    if (open === null) return line;

    const lead = text.slice(0, open).trimEnd();
    const backing = text.slice(open).trim();
    if (!lead || !/[0-9A-Za-zÀ-ÿ]/.test(backing)) return line;

    if (!line.words || line.words.length === 0) {
      return {
        ...line,
        text: lead,
        background: { time: line.time, endTime: line.endTime, text: backing },
      };
    }

    const split = wordIndexAtOffset(line.words, open);
    if (split === null || split <= 0) return line;

    const backingWords = line.words.slice(split);
    return {
      ...line,
      text: lead,
      words: line.words.slice(0, split),
      background: {
        time: backingWords[0].time,
        endTime: backingWords[backingWords.length - 1].endTime ?? line.endTime,
        text: backing,
        words: backingWords,
      },
    };
  });
}
