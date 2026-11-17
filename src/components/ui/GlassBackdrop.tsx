import { BlurView } from 'expo-blur';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Cam (glass) arka plan katmanı.
 *
 * NEDEN: Android'de `Image blurRadius` pahalı ve düşük kaliteliydi. Dimezis
 * BlurView (Android 12+ donanım yolu) alttaki içeriği gerçekten bulanıklaştırır,
 * üzerine ince bir renk perdesi eklenerek metin okunabilirliği korunur.
 *
 * Android 31+ hedeflendiği için `dimezisBlurViewSdk31Plus` seçildi; daha eski
 * sürümlerde otomatik olarak yarı saydam görünüme düşer (uygulama zaten
 * minSdk 31).
 *
 * ÖNEMLİ: RN `Modal` içinde blur, modal kendi penceresinde çizildiği için
 * arkadaki uygulamayı bulanıklaştırmaz; bu bileşen modallarda yalnızca hafif
 * bir cam tonu verir, uygulama ağacında ise gerçek bulanıklık sağlar.
 */
export interface GlassBackdropProps {
  intensity?: number;
  tint?: 'dark' | 'light' | 'default';
  /** Blur üzerine binen renk perdesi (okunabilirlik için). */
  overlayColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function GlassBackdrop({
  intensity = 60,
  tint = 'dark',
  overlayColor = 'rgba(9, 9, 11, 0.45)',
  style,
}: GlassBackdropProps) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint={tint}
        blurMethod="dimezisBlurViewSdk31Plus"
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} />
    </View>
  );
}

/**
 * Kapağın arkasından başlayıp kenarlara doğru azalan bulanıklık.
 *
 * NEDEN TÜM EKRAN: Android'de maske API'si olmadığı için "sadece ortada
 * bulanık" bir alan ancak elips bir BlurView ile taklit edilebiliyordu; o da
 * ekranın ortasında ayrı bir yuvarlak leke gibi görünüyordu. Doğru görünüm
 * için blur tüm ekranı kaplar, üzerine binen radial gradyan ise merkezde
 * tamamen saydamdan başlayıp kenarlara doğru koyulaşır. Böylece kapak
 * bölgesinde blur en güçlüdür, dışa doğru yumuşakça söner ve hiçbir yerde
 * keskin bir daire kenarı oluşmaz.
 */
export interface RadialBlurFocusProps {
  /** Odak (kapak) bölgesindeki bulanıklık şiddeti. */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}

export function RadialBlurFocus({ intensity = 65, style }: RadialBlurFocusProps) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint="dark"
        blurMethod="dimezisBlurViewSdk31Plus"
      />
      {/*
        Sönümleme: merkez (kapak) saydam → blur tam görünür; dışa doğru
        gradyan koyulaşarak bulanıklığı yumuşakça örter. En uçta bile tam
        opak değil, aksi hâlde ekranın çevresi siyah bir çerçeveye dönüşüyor.
      */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage:
              'radial-gradient(circle at 50% 40%, rgba(10, 10, 14, 0) 18%, rgba(10, 10, 14, 0.10) 40%, rgba(10, 10, 14, 0.32) 64%, rgba(7, 7, 10, 0.58) 86%, rgba(5, 5, 8, 0.72) 100%)',
          },
        ]}
      />
    </View>
  );
}
