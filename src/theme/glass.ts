import type { ViewStyle } from 'react-native';

/**
 * RunMusic cam yüzey dili.
 *
 * NEDEN AYRI MODÜL: Cam görünümü tek bir saydam dolguyla verilemiyordu; düz
 * `rgba(...)` arka planlar normal (mat) buton gibi görünüyordu. Gerçek cam
 * izlenimi üç katmandan gelir:
 *
 *  1. **Dolgu gradyanı** — üst-sol köşede parlak, alt-sağa doğru sönümlenen
 *     ışık; yüzeyin "eğimli" olduğunu hissettirir.
 *  2. **Kenar (rim)** — gövdeden daha parlak, üstte en parlak ince çizgi;
 *     camın kırılan kenarını taklit eder.
 *  3. **Gölge** — yüzeyi arka plandan ayırıp havada duruyormuş gibi gösterir.
 *
 * Gradyan `experimental_backgroundImage` ile çizilir (RN 0.86); Android'de ek
 * bir görünüm katmanı veya maske gerektirmez.
 */
const GLASS_GRADIENT =
  'linear-gradient(160deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.11) 40%, rgba(255,255,255,0.04) 72%, rgba(255,255,255,0.10) 100%)';

const GLASS_GRADIENT_ACTIVE =
  'linear-gradient(160deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.18) 42%, rgba(255,255,255,0.08) 74%, rgba(255,255,255,0.16) 100%)';

/** Büyük kartlar için daha yumuşak cam: parlaklık metni rahatsız etmesin. */
const GLASS_GRADIENT_CARD =
  'linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0.025) 72%, rgba(255,255,255,0.06) 100%)';

export interface GlassSurfaceOptions {
  /** Seçili/aktif durum: daha parlak gövde ve kenar. */
  active?: boolean;
  /** Yüzeyi arka plandan ayıran gölge (varsayılan: açık). */
  shadow?: boolean;
  /** Büyük kart/panel yüzeyi: gradyan ve kenar daha yumuşak. */
  card?: boolean;
}

/**
 * Cam yüzey stili.
 *
 * @param radius Köşe yarıçapı — daire için butonun yarısı verilir.
 */
export function glassSurface(radius: number, options: GlassSurfaceOptions = {}): ViewStyle {
  const { active = false, shadow = true, card = false } = options;
  const gradient = card
    ? GLASS_GRADIENT_CARD
    : active
      ? GLASS_GRADIENT_ACTIVE
      : GLASS_GRADIENT;
  return {
    borderRadius: radius,
    backgroundColor: active ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.05)',
    experimental_backgroundImage: gradient,
    borderWidth: 1,
    borderColor: active ? 'rgba(255, 255, 255, 0.30)' : 'rgba(255, 255, 255, 0.18)',
    // Üst kenar daha parlak: camın ışığı kırdığı yer.
    borderTopColor: active ? 'rgba(255, 255, 255, 0.62)' : 'rgba(255, 255, 255, 0.4)',
    ...(shadow
      ? {
          shadowColor: '#000000',
          shadowOpacity: 0.3,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }
      : null),
  };
}
