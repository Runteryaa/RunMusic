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
