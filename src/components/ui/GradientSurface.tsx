import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

/**
 * RunMusic'in kart/gradient dili için tek kullanımlık yüzey bileşeni.
 *
 * NEDEN: Uygulamada gradient daha önce "yarı saydam katman" hilesiyle taklit
 * ediliyordu; bu hem bulanık görünüyor hem de her ekranda farklı elle
 * yazılıyordu. Tek bileşen, aynı köşe yarıçapını ve aynı renk geçişi yönlerini
 * koruyarak tutarlılık sağlar.
 *
 * Apple Music kopyası DEĞİL: renkler her zaman temadan veya RunMusic'e özgü
 * sabit paletlerden gelir; siyah/beyaz düz zeminler yerine markanın kart
 * görünümü korunur.
 */

export type GradientDirection =
  | 'vertical'
  | 'diagonal'
  | 'horizontal'
  | 'diagonalReverse';

const DIRECTION_POINTS: Record<
  GradientDirection,
  { start: { x: number; y: number }; end: { x: number; y: number } }
> = {
  vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
  diagonal: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  horizontal: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  diagonalReverse: { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
};

export interface GradientSurfaceProps {
  /** En az iki renk. İlk renk üst/başlangıç tarafıdır. */
  colors: readonly [ColorValue, ColorValue, ...ColorValue[]];
  direction?: GradientDirection;
  /** Renklerin hangi noktalarda konumlandığı (colors ile aynı uzunlukta). */
  locations?: readonly number[];
  style?: StyleProp<ViewStyle>;
  /** Köşe yarıçapı; verilirse `overflow: hidden` ile kırpılır. */
  borderRadius?: number;
  children?: ReactNode;
  /** Yalnızca arka plan olarak kullanılacaksa çocuk gerekmez. */
  pointerEvents?: 'none' | 'auto' | 'box-none' | 'box-only';
}

/**
 * Tema renginden yumuşak bir yüzey geçişi üretir (`primary` → saydam).
 * Kart arka planları için ortak yardımcı: aynı rengin farklı opaklıkları
 * gradient olarak eklenir, böylece tek renkli düz kartlar derinlik kazanır.
 */
export function themeGradient(
  primary: string,
  options: { from?: number; to?: number; base?: string } = {}
): readonly [string, string] {
  const from = options.from ?? 0.28;
  const to = options.to ?? 0.04;
  const startColor = withAlpha(primary, from);
  const endColor =
    options.base && options.base !== 'transparent'
      ? withAlpha(options.base, to)
      : withAlpha(primary, to);
  return [startColor, endColor];
}

/**
 * `#rrggbb`/`#rgb` rengi verilen opaklıkla `rgba(...)` biçimine çevirir.
 * Zaten rgba/hsl olan değerler olduğu gibi döner (tema renkleri karışık
 * formatlarda gelebiliyor).
 */
export function withAlpha(color: string, alpha: number): string {
  const value = String(color || '').trim();
  if (!value) return `rgba(255,255,255,${alpha})`;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (chunk: string) =>
      chunk.length === 1 ? chunk + chunk : chunk;
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(expand(hex[0]), 16);
      const g = parseInt(expand(hex[1]), 16);
      const b = parseInt(expand(hex[2]), 16);
      const a = hex.length === 4 ? parseInt(expand(hex[3]), 16) / 255 : 1;
      return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha * a))})`;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha * a))})`;
    }
  }

  if (value.startsWith('rgb(')) {
    return value.replace(/^rgb\(/i, 'rgba(').replace(/\)$/, `,${alpha})`);
  }
  if (value.startsWith('rgba(')) return value;

  return value;
}

export function GradientSurface({
  colors,
  direction = 'diagonal',
  locations,
  style,
  borderRadius,
  children,
  pointerEvents,
}: GradientSurfaceProps) {
  const points = DIRECTION_POINTS[direction] ?? DIRECTION_POINTS.diagonal;

  return (
    <LinearGradient
      colors={colors}
      locations={locations as unknown as [number, number, ...number[]] | undefined}
      start={points.start}
      end={points.end}
      style={[
        borderRadius !== undefined ? { borderRadius, overflow: 'hidden' } : null,
        style,
      ]}
      pointerEvents={pointerEvents}
    >
      {children}
    </LinearGradient>
  );
}
