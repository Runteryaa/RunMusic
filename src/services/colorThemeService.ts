import * as FileSystem from 'expo-file-system';
import jpeg from 'jpeg-js';
import { decode as decodePng } from 'fast-png';
import { extractColors } from 'extract-colors';

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

// Bellek içi tema önbelleği (aynı şarkıya dönüldüğünde anında 0ms tepki)
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
  // Aşırı karanlık renkleri karanlık modda görünür kılmak için hafif aydınlat
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

  // Koyu arka planda zengin görünmesi için lightness aralığını ayarla [0.5, 0.65]
  const targetLightness = Math.max(0.48, Math.min(0.68, l));
  const targetSat = Math.max(0.6, s);
  const [prR, prG, prB] = hslToRgb(h, targetSat, targetLightness);

  const [lightR, lightG, lightB] = hslToRgb(h, targetSat, Math.min(0.82, targetLightness + 0.15));
  const [darkR, darkG, darkB] = hslToRgb(h, targetSat, Math.max(0.3, targetLightness - 0.2));

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
 * Verilen albüm kapağı URI adresinden canlı tema renklerini çıkartır.
 * Ön belleğe alır ve sonraki çağrılarda anında döndürür.
 */
export async function extractThemeFromImageUri(uri: string): Promise<ThemeColors> {
  if (!uri || typeof uri !== 'string') {
    return DEFAULT_THEME;
  }

  // 1. Önbellek kontrolü
  if (themeCache.has(uri)) {
    return themeCache.get(uri)!;
  }

  try {
    let bytes: Uint8Array | null = null;

    // 2. Baytları oku (HTTP veya Dosya)
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      bytes = new Uint8Array(ab);
    } else {
      let fileUri = uri;
      if (!fileUri.startsWith('file://') && !fileUri.startsWith('content://')) {
        fileUri = 'file://' + fileUri;
      }
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      bytes = base64ToUint8Array(base64);
    }

    if (!bytes || bytes.length < 8) {
      return DEFAULT_THEME;
    }

    // 3. Format kontrolü ve Decode (JPEG veya PNG)
    let rawPixels: ArrayLike<number> | null = null;
    let width = 0;
    let height = 0;

    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;

    if (isJpeg) {
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      rawPixels = decoded.data;
      width = decoded.width;
      height = decoded.height;
    } else if (isPng) {
      const decoded = decodePng(bytes);
      rawPixels = decoded.data;
      width = decoded.width;
      height = decoded.height;
    }

    if (!rawPixels || width === 0 || height === 0) {
      return DEFAULT_THEME;
    }

    // 4. Yıldırım hızı için piksel örnekleme (Maksimum 48x48 piksele indirgeme)
    const targetDim = 48;
    const stepX = Math.max(1, Math.floor(width / targetDim));
    const stepY = Math.max(1, Math.floor(height / targetDim));

    const sampleWidth = Math.ceil(width / stepX);
    const sampleHeight = Math.ceil(height / stepY);
    const sampledPixels = new Uint8ClampedArray(sampleWidth * sampleHeight * 4);

    let outIndex = 0;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const srcIndex = (y * width + x) * 4;
        sampledPixels[outIndex] = rawPixels[srcIndex];
        sampledPixels[outIndex + 1] = rawPixels[srcIndex + 1];
        sampledPixels[outIndex + 2] = rawPixels[srcIndex + 2];
        sampledPixels[outIndex + 3] = rawPixels[srcIndex + 3];
        outIndex += 4;
      }
    }

    // 5. Renkleri kümeleme ve en canlı/baskın tonu seçme
    const extracted = await extractColors(
      { data: sampledPixels, width: sampleWidth, height: sampleHeight },
      {
        pixels: sampleWidth * sampleHeight,
        distance: 0.18,
        colorValidator: (r, g, b, a = 255) => {
          if (a < 128) return false;
          // Aşırı koyu ve aşırı açık beyazları eleyerek asıl rengi bul
          const l = (Math.max(r, g, b) + Math.min(r, g, b)) / (2 * 255);
          return l >= 0.12 && l <= 0.92;
        },
      }
    );

    if (!extracted || extracted.length === 0) {
      themeCache.set(uri, DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    // En zengin, renkli tonu puanla (Doygunluk x Alan)
    const scored = [...extracted].sort((a, b) => {
      const scoreA = (a.saturation || 0) * 0.7 + (a.area || 0) * 0.3;
      const scoreB = (b.saturation || 0) * 0.7 + (b.area || 0) * 0.3;
      return scoreB - scoreA;
    });

    const bestColor = scored[0];
    const theme = createThemeFromRgb(bestColor.red, bestColor.green, bestColor.blue);

    themeCache.set(uri, theme);
    return theme;
  } catch (err) {
    console.warn('Cover art color extraction failed:', err);
    themeCache.set(uri, DEFAULT_THEME);
    return DEFAULT_THEME;
  }
}
