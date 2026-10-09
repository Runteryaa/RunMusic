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

// Bellek içi tema önbelleği
const themeCache = new Map<string, ThemeColors>();

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

export function createThemeFromHex(hex: string): ThemeColors {
  const [r, g, b] = hexToRgb(hex);
  return createThemeFromRgb(r, g, b);
}

// Canlı Apple Music renk paletleri (OTA / Fallback için sıfır CPU gecikmesi)
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

/**
 * Albüm kapağından tema rengi çıkartır.
 * - Yerel donanım hızlandırmalı Android katmanı üzerinden ~1ms içinde çalışır.
 * - JS thread'ini ASLA bloklamaz (0ms Hermes CPU etkisi).
 * - Yerel modül olmadığı durumlarda anında akıllı ve canlı bir degrade seçer.
 */
export async function extractThemeFromImageUri(uri: string): Promise<ThemeColors> {
  if (!uri || typeof uri !== 'string') {
    return DEFAULT_THEME;
  }

  if (themeCache.has(uri)) {
    return themeCache.get(uri)!;
  }

  // 1. Yerel Android modülünden donanım hızlandırmalı dominant renk almayı dene (<1ms)
  try {
    const dominantHex = await getDominantColorAsync(uri);
    if (dominantHex && dominantHex.startsWith('#')) {
      const theme = createThemeFromHex(dominantHex);
      themeCache.set(uri, theme);
      return theme;
    }
  } catch {
    // Yerel modül henüz hazır değilse veya hata verirse fallback'e geç
  }

  // 2. Anında (0ms) canlı ve estetik iOS Apple Music renk teması
  const fallbackTheme = getFallbackTheme(uri);
  themeCache.set(uri, fallbackTheme);
  return fallbackTheme;
}
