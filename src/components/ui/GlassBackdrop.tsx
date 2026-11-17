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
 * Merkezden yayılan bulanıklık (oynatıcı arka planı).
 *
 * NEDEN AYRI KATMAN: `BlurView` tek başına tüm ekranı eşit bulanıklaştırır.
 * İstenen görünüm, oynatıcının ana alanında (kapak/parça bilgisi) daha güçlü
 * bulanıklık ve köşelere doğru azalan bir etki. Android'de maske API'si
 * olmadığı için çözüm dairesel bir ikinci blur katmanı: geniş bir elipsin
 * içine yüksek yoğunluklu blur konur, elipsin kenarı da aynı arka plan rengine
 * doğru saydamlaşan radial gradyanla gizlenir. Böylece geçiş keskin bir daire
 * olarak görünmez, yumuşak bir odak oluşur.
 */
export interface RadialBlurFocusProps {
  /** Odak bölgesindeki bulanıklık şiddeti (taban katmandan yüksek olmalı). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}

export function RadialBlurFocus({ intensity = 55, style }: RadialBlurFocusProps) {
  return (
    <View pointerEvents="none" style={[styles.focusCircle, style]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint="dark"
        blurMethod="dimezisBlurViewSdk31Plus"
      />
      {/*
        Elips kenarını gizleyen yumuşak geçiş. NEDEN BU KADAR SAYDAM: önceki
        değerler kenarlarda neredeyse opak koyu bir halka bırakıyordu; ekranın
        dışına taşan bulanıklık "abartılı" görünüyordu. Artık geçiş çok daha
        erken başlıyor ve en uçta bile yalnızca hafif bir karartma kalıyor.
      */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage:
              'radial-gradient(circle at 50% 50%, rgba(10, 10, 14, 0) 42%, rgba(10, 10, 14, 0.18) 74%, rgba(8, 8, 11, 0.36) 100%)',
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  focusCircle: {
    position: 'absolute',
    // Elips daraltıldı: bulanıklık artık kenarlara taşmıyor, yalnızca
    // oynatıcının orta alanında (kapak/parça bilgisi) kalıyor.
    left: '-4%',
    right: '-4%',
    top: '13%',
    bottom: '32%',
    borderRadius: 9999,
    overflow: 'hidden',
  },
});
