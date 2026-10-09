import * as FileSystem from 'expo-file-system';
import jpeg from 'jpeg-js';

export interface ThemeColors {
  primary: string;       // Canlı ana vurgu rengi (örn. #9333ea mor)
  primaryLight: string;  // Açık ton (vurgular ve butonlar için)
  primaryDark: string;   // Koyu ton
  glowColor: string;     // Arka plan ışık/degrade için rgba
  surface: string;       // Kart ve arkaplan yarı-saydam tonu
  border: string;        // İnce kenarlık rengi
  textAccent: string;    // Metin ve ikon vurgu rengi
}

export const DEFAULT_THEME: ThemeColors = {
  primary: '#3b82f6',
  primaryLight: '#60a5fa',
  primaryDark: '#1d4ed8',
  glowColor: 'rgba(59, 130, 246, 0.35)',
  surface: 'rgba(59, 130, 246, 0.12)',
  border: 'rgba(59, 130, 246, 0.28)',
  textAccent: '#93c5fd',
};

// Bellek içi tema önbelleği
const themeCache = new Map<string, ThemeColors>();

function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const len = base64.length;
  let bufferLength = base64.length * 0.75;
  if (base64[len - 1] === '=') {
    bufferLength--;
    if (base64[len - 2] === '=') bufferLength--;
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return bytes;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function createThemeFromRgb(r: number, g: number, b: number): ThemeColors {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  let l = (max + min) / (2 * 255);
  const s = max === 0 || min === 255 ? 0 : delta / (255 - Math.abs(2 * (max + min) / 2 - 255));

  // Koyu AMOLED arka planda harika görünmesi için ayarla
  const targetLightness = Math.max(0.48, Math.min(0.66, l));
  const targetSat = Math.max(0.65, s);
  const [prR, prG, prB] = hslToRgb(h, targetSat, targetLightness);

  const [lightR, lightG, lightB] = hslToRgb(h, targetSat, Math.min(0.84, targetLightness + 0.15));
  const [darkR, darkG, darkB] = hslToRgb(h, targetSat, Math.max(0.28, targetLightness - 0.22));

  const primaryHex = rgbToHex(prR, prG, prB);
  const primaryLightHex = rgbToHex(lightR, lightG, lightB);
  const primaryDarkHex = rgbToHex(darkR, darkG, darkB);

  return {
    primary: primaryHex,
    primaryLight: primaryLightHex,
    primaryDark: primaryDarkHex,
    glowColor: `rgba(${prR}, ${prG}, ${prB}, 0.35)`,
    surface: `rgba(${prR}, ${prG}, ${prB}, 0.14)`,
    border: `rgba(${prR}, ${prG}, ${prB}, 0.32)`,
    textAccent: primaryLightHex,
  };
}

/**
 * Saf JavaScript renk kümeleme algoritması.
 * Dış bağımlılık gerektirmez, React Native Hermes üzerinde asla çökmez.
 */
function extractDominantRgbFromPixels(
  data: ArrayLike<number>,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const totalPixels = width * height;
  // En fazla 2000 piksel örnekle (0.2 milisaniyede tamamlanır)
  const step = Math.max(1, Math.floor(totalPixels / 2000)) * 4;
  const buckets: Record<string, { r: number; g: number; b: number; weight: number }> = {};

  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3] ?? 255;

    if (a < 128) continue; // Saydam pikselleri atla

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;

    // Saf siyah veya saf beyaz arkaplanları atla
    if (lightness < 20 || lightness > 235) continue;

    const delta = max - min;
    const saturation = max === 0 ? 0 : delta / max;

    // 5-bit renk kümeleme (32 seviye)
    const qr = Math.floor(r / 16) * 16;
    const qg = Math.floor(g / 16) * 16;
    const qb = Math.floor(b / 16) * 16;
    const key = `${qr}_${qg}_${qb}`;

    // Canlı renklere yüksek ağırlık ver (doygunluk ağırlığı)
    const weight = 1 + saturation * 3.5;

    if (!buckets[key]) {
      buckets[key] = { r: qr, g: qg, b: qb, weight };
    } else {
      buckets[key].weight += weight;
    }
  }

  let best = { r: 59, g: 130, b: 246 };
  let maxWeight = -1;

  for (const key in buckets) {
    if (buckets[key].weight > maxWeight) {
      maxWeight = buckets[key].weight;
      best = buckets[key];
    }
  }

  return best;
}

/**
 * Verilen albüm kapağı URI adresinden canlı tema renklerini çıkartır.
 * Asla hata fırlatmaz, zaman aşımı korumalıdır.
 */
async function internalExtractTheme(uri: string): Promise<ThemeColors> {
  if (!uri || typeof uri !== 'string') {
    return DEFAULT_THEME;
  }

  if (themeCache.has(uri)) {
    return themeCache.get(uri)!;
  }

  try {
    let bytes: Uint8Array | null = null;

    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(uri, { signal: controller.signal });
        clearTimeout(timeoutId);
        const ab = await resp.arrayBuffer();
        bytes = new Uint8Array(ab);
      } catch {
        clearTimeout(timeoutId);
        themeCache.set(uri, DEFAULT_THEME);
        return DEFAULT_THEME;
      }
    } else {
      let fileUri = uri;
      if (!fileUri.startsWith('file://') && !fileUri.startsWith('content://')) {
        fileUri = 'file://' + fileUri;
      }

      // Dosya boyutu kontrolü (1MB'dan büyük dosyaları atla)
      try {
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (!fileInfo.exists || (fileInfo.size && fileInfo.size > 1024 * 1024)) {
          themeCache.set(uri, DEFAULT_THEME);
          return DEFAULT_THEME;
        }
      } catch {
        // Android content:// şemalarında getInfoAsync desteklenmeyebilir
      }

      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const cleanBase64 = base64.replace(/\s+/g, '');
      bytes = base64ToUint8Array(cleanBase64);
    }

    if (!bytes || bytes.length < 8) {
      themeCache.set(uri, DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    // JPEG kontrolü (0xFF, 0xD8)
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isJpeg) {
      themeCache.set(uri, DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    if (!decoded || !decoded.data || decoded.width === 0 || decoded.height === 0) {
      themeCache.set(uri, DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    const dominant = extractDominantRgbFromPixels(decoded.data, decoded.width, decoded.height);
    const theme = createThemeFromRgb(dominant.r, dominant.g, dominant.b);

    themeCache.set(uri, theme);
    return theme;
  } catch (err) {
    console.warn('Cover art color extraction fallback:', err);
    themeCache.set(uri, DEFAULT_THEME);
    return DEFAULT_THEME;
  }
}

export async function extractThemeFromImageUri(uri: string): Promise<ThemeColors> {
  return Promise.race([
    internalExtractTheme(uri),
    new Promise<ThemeColors>((resolve) => setTimeout(() => resolve(DEFAULT_THEME), 2500)),
  ]);
}
