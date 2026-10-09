import { Image } from 'expo-image';
import { getDominantColorAsync } from '../../modules/audio-artwork/src';

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

// Bellek içi tema önbelleği (sadece doğrulanmış gerçek renkler)
const themeCache = new Map<string, ThemeColors>();

const BLURHASH_DIGITS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function decode83(str: string): number {
  let val = 0;
  for (let i = 0; i < str.length; i++) {
    const idx = BLURHASH_DIGITS.indexOf(str[i]);
    if (idx !== -1) val = val * 83 + idx;
  }
  return val;
}

function sRGBToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearTosRGB(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308
    ? Math.round(v * 12.92 * 255)
    : Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}

/**
 * Blurhash dizesinden gerçek albüm kapağının en canlı (vibrant) baskın rengini çıkarır (<0.1ms).
 */
function extractVibrantFromBlurhash(blurhash: string): [number, number, number] | null {
  try {
    if (!blurhash || blurhash.length < 6) return null;
    const sizeFlag = decode83(blurhash[0]);
    const numY = Math.floor(sizeFlag / 9) + 1;
    const numX = (sizeFlag % 9) + 1;
    const quantisedMaximumValue = decode83(blurhash[1]);
    const maximumValue = (quantisedMaximumValue + 1) / 166;

    const colors = new Array(numX * numY);
    const dcVal = decode83(blurhash.substring(2, 6));
    const dcR = (dcVal >> 16) & 255;
    const dcG = (dcVal >> 8) & 255;
    const dcB = dcVal & 255;
    colors[0] = [sRGBToLinear(dcR), sRGBToLinear(dcG), sRGBToLinear(dcB)];

    let hasAC = false;
    for (let i = 1; i < numX * numY; i++) {
      const start = 4 + i * 2;
      if (start + 2 > blurhash.length) break;
      const acVal = decode83(blurhash.substring(start, start + 2));
      const sign = (v: number) => (v < 0 ? -1 : 1);
      const f = (c: number) => sign(c - 9) * Math.pow(Math.abs(c - 9) / 9, 2) * maximumValue;
      colors[i] = [
        f(Math.floor(acVal / (19 * 19))),
        f(Math.floor(acVal / 19) % 19),
        f(acVal % 19),
      ];
      hasAC = true;
    }

    let bestR = dcR;
    let bestG = dcG;
    let bestB = dcB;

    const maxDC = Math.max(dcR, dcG, dcB);
    const minDC = Math.min(dcR, dcG, dcB);
    const satDC = maxDC === 0 ? 0 : (maxDC - minDC) / maxDC;
    let maxScore = satDC * 3.5 + (maxDC + minDC) / 510;

    if (hasAC) {
      // 4x4 ızgarada en canlı renge sahip pikseli tespit et
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let j = 0; j < numY; j++) {
            for (let i = 0; i < numX; i++) {
              const c = colors[i + j * numX];
              if (!c) continue;
              const basis = Math.cos((Math.PI * x * i) / 4) * Math.cos((Math.PI * y * j) / 4);
              r += c[0] * basis;
              g += c[1] * basis;
              b += c[2] * basis;
            }
          }
          const pxR = linearTosRGB(r);
          const pxG = linearTosRGB(g);
          const pxB = linearTosRGB(b);
          const max = Math.max(pxR, pxG, pxB);
          const min = Math.min(pxR, pxG, pxB);
          const delta = max - min;
          const sat = max === 0 ? 0 : delta / max;
          const l = (max + min) / 2;
          if (l < 20 || l > 235) continue;
          const score = sat * 3.5 + l / 255;
          if (score > maxScore) {
            maxScore = score;
            bestR = pxR;
            bestG = pxG;
            bestB = pxB;
          }
        }
      }
    }
    return [bestR, bestG, bestB];
  } catch {
    return null;
  }
}

/**
 * Thumbhash dizesinden gerçek albüm kapağının ortalama RGB rengini çıkarır (<0.01ms).
 */
function extractRgbFromThumbhash(thumbhash: string): [number, number, number] | null {
  try {
    if (!thumbhash) return null;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < thumbhash.length; i++) {
      const idx = chars.indexOf(thumbhash[i]);
      if (idx === -1) continue;
      buffer = (buffer << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
      if (bytes.length >= 5) break;
    }
    if (bytes.length < 3) return null;
    const header24 = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
    const l_dc = (header24 & 63) / 63;
    const p_dc = ((header24 >> 6) & 63) / 31.5 - 1;
    const q_dc = ((header24 >> 12) & 63) / 31.5 - 1;
    const r = Math.max(0, Math.min(1, l_dc + 0.3986 * p_dc + 0.701 * q_dc));
    const g = Math.max(0, Math.min(1, l_dc - 0.1878 * p_dc - 0.2078 * q_dc));
    const b = Math.max(0, Math.min(1, l_dc - 0.21 * p_dc + 0.505 * q_dc));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  } catch {
    return null;
  }
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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [59, 130, 246];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function createThemeFromRgb(r: number, g: number, b: number): ThemeColors {
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
  const l = (max + min) / (2 * 255);
  const s = max === 0 || min === 255 ? 0 : delta / (255 - Math.abs(2 * (max + min) / 2 - 255));

  // Siyah/Beyaz/Monokrom kapaklar için şık platinum/gümüş tema
  if (s < 0.08) {
    return {
      primary: '#e4e4e7',
      primaryLight: '#f4f4f5',
      primaryDark: '#a1a1aa',
      glowColor: 'rgba(255, 255, 255, 0.25)',
      surface: 'rgba(255, 255, 255, 0.12)',
      border: 'rgba(255, 255, 255, 0.25)',
      textAccent: '#f4f4f5',
    };
  }

  // Koyu AMOLED arka planda harika görünmesi için canlılık ve parlaklık ayarı
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

export function createThemeFromHex(hex: string): ThemeColors {
  const [r, g, b] = hexToRgb(hex);
  return createThemeFromRgb(r, g, b);
}

// Canlı Apple Music renk paletleri (Sadece kapak görseli hiç olmayan şarkılar için)
const VIBRANT_PALETTES: [number, number, number][] = [
  [147, 51, 234], // Deep Purple
  [225, 29, 72],  // Crimson Rose
  [37, 99, 235],  // Electric Royal Blue
  [13, 148, 136], // Neon Emerald Teal
  [234, 88, 12],  // Sunset Amber
  [16, 185, 129], // Bright Mint
  [217, 70, 239], // Vivid Magenta
  [79, 70, 229],  // Deep Indigo
  [202, 138, 4],  // Warm Gold
  [6, 182, 212],  // Cyan Azure
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getFallbackTheme(key: string): ThemeColors {
  const idx = hashString(key) % VIBRANT_PALETTES.length;
  const [r, g, b] = VIBRANT_PALETTES[idx];
  return createThemeFromRgb(r, g, b);
}

export function extractThemeFromSeed(seed: string): ThemeColors {
  return getFallbackTheme(seed);
}

/**
 * Albüm kapağının gerçek görselinden tema rengi çıkartır:
 * 1. Android native donanım hızlandırmalı dominant renk (<1ms)
 * 2. expo-image native C++/Glide Blurhash analizi (<0.1ms)
 * 3. expo-image native Thumbhash analizi (<0.01ms)
 * JS thread'ini ASLA dondurmaz ve rastgele renk üretmez.
 */
export async function extractThemeFromImageUri(uri: string): Promise<ThemeColors> {
  if (!uri || typeof uri !== 'string') {
    return DEFAULT_THEME;
  }

  if (themeCache.has(uri)) {
    return themeCache.get(uri)!;
  }

  // 1. Yerel Android modülünden donanım hızlandırmalı dominant renk dene
  try {
    const dominantHex = await getDominantColorAsync(uri);
    if (dominantHex && dominantHex.startsWith('#')) {
      const theme = createThemeFromHex(dominantHex);
      themeCache.set(uri, theme);
      return theme;
    }
  } catch {
    // Devam et
  }

  // 2. expo-image native C++/Glide Blurhash üzerinden görselin gerçek baskın rengini çıkar
  try {
    const blurhash = await Image.generateBlurhashAsync(uri, [4, 3]);
    if (blurhash) {
      const rgb = extractVibrantFromBlurhash(blurhash);
      if (rgb) {
        const theme = createThemeFromRgb(rgb[0], rgb[1], rgb[2]);
        themeCache.set(uri, theme);
        return theme;
      }
    }
  } catch {
    // Devam et
  }

  // 3. expo-image native Thumbhash üzerinden gerçek renkleri çıkar
  try {
    const thumbhash = await Image.generateThumbhashAsync(uri);
    if (thumbhash) {
      const rgb = extractRgbFromThumbhash(thumbhash);
      if (rgb) {
        const theme = createThemeFromRgb(rgb[0], rgb[1], rgb[2]);
        themeCache.set(uri, theme);
        return theme;
      }
    }
  } catch {
    // Devam et
  }

  // 4. Son çare: Görsel dosyası bozuk veya okunamıyorsa
  const fallbackTheme = getFallbackTheme(uri);
  return fallbackTheme;
}
