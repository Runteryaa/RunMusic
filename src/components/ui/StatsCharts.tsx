import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * İstatistik ekranının SVG grafikleri.
 *
 * NEDEN: Saat dağılımı 24 ayrı `View` kutusuyla, hafta günü 7 kutuyla
 * çiziliyordu. Bu hem çok sayıda native view üretiyor hem de eğri/alan grafiği
 * gibi ifadeleri imkânsız kılıyordu. Tek bir `Svg` çizimi daha az view, daha
 * yumuşak görünüm ve tema rengiyle gerçek gradient dolgu sağlar.
 *
 * Renkler dışarıdan gelir (tema); RunMusic'in kart dili korunur.
 */

interface ChartProps {
  /** Değer dizisi (saat için 24, hafta günü için 7 eleman). */
  data: number[];
  /** Vurgulanacak indeks (en yoğun saat/gün). */
  highlightIndex: number | null;
  /** Tema vurgu rengi. */
  color: string;
  height?: number;
}

/** Grafik genişliği bilinmeden çizim yapılamaz; ilk karede ölçülür. */
function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (next > 0 && next !== current ? next : current));
  };
  return { width, onLayout };
}

/** Çizgi/alan grafiği: 24 saatlik dinleme yoğunluğu. */
export function HourAreaChart({ data, highlightIndex, color, height = 92 }: ChartProps) {
  const { width, onLayout } = useMeasuredWidth();
  const max = Math.max(1, ...data);
  const pointCount = data.length;

  // Kenar boşluğu: noktaların yarıçapı ve vurgu dairesi kesilmesin.
  const paddingX = 6;
  const paddingTop = 10;
  const bottom = height - 2;
  const usableWidth = Math.max(0, width - paddingX * 2);

  const pointAt = (index: number, value: number) => {
    const x = paddingX + (pointCount <= 1 ? 0 : (usableWidth * index) / (pointCount - 1));
    const ratio = value / max;
    const y = paddingTop + (1 - ratio) * (bottom - paddingTop);
    return { x, y };
  };

  const points = data.map((value, index) => pointAt(index, value));

  const linePath = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    )
    .join(' ');

  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${bottom.toFixed(2)} ` +
        `L${points[0].x.toFixed(2)},${bottom.toFixed(2)} Z`
      : '';

  const highlight =
    highlightIndex !== null && highlightIndex >= 0 && highlightIndex < points.length
      ? points[highlightIndex]
      : null;

  return (
    <View style={{ height, width: '100%' }} onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgLinearGradient id="hourFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.55} />
              <Stop offset="1" stopColor={color} stopOpacity={0.02} />
            </SvgLinearGradient>
          </Defs>

          {/* Yatay kılavuz çizgileri */}
          {[0.25, 0.5, 0.75].map((ratio) => {
            const y = paddingTop + ratio * (bottom - paddingTop);
            return (
              <Line
                key={`grid-${ratio}`}
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
            );
          })}

          <Path d={areaPath} fill="url(#hourFill)" />
          <Path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {highlight ? (
            <>
              <Circle cx={highlight.x} cy={highlight.y} r={5.5} fill={color} opacity={0.25} />
              <Circle cx={highlight.x} cy={highlight.y} r={3} fill={color} />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Dikey çubuklar: hafta günü dağılımı. */
export function WeekdayBarChart({ data, highlightIndex, color, height = 64 }: ChartProps) {
  const { width, onLayout } = useMeasuredWidth();
  const max = Math.max(1, ...data);
  const count = data.length;

  // Her çubuk arasında eşit boşluk; çubuk genişliği alanın ~%55'i.
  const slotWidth = count > 0 ? width / count : 0;
  const barWidth = Math.max(6, slotWidth * 0.55);
  const minBarHeight = 3;

  return (
    <View style={{ height, width: '100%' }} onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {data.map((value, index) => {
            const barHeight = Math.max(minBarHeight, (value / max) * height);
            const isHighlight = highlightIndex === index;
            const fill = value === 0 ? '#27272a' : isHighlight ? color : `${color}80`;
            const x = slotWidth * index + (slotWidth - barWidth) / 2;

            return (
              <Rect
                key={`wd-${index}`}
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                rx={barWidth / 2}
                fill={fill}
              />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

interface ShareRingProps {
  /** 0..1 arası oran. */
  value: number;
  color: string;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}

/** Yüzde halkası (ör. en çok dinlenen parçanın payı). */
export function ShareRing({
  value,
  color,
  size = 74,
  strokeWidth = 7,
  children,
}: ShareRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          // -90°: halka saat 12 yönünden başlasın.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
