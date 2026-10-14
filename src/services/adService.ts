import mobileAds, {
  MaxAdContentRating,
  TestIds,
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';

/**
 * AdMob Ad Unit IDs
 * When moving to real production AdMob ads, replace these test IDs with your AdMob Ad Unit IDs.
 */
export const AD_UNIT_IDS = {
  // Adaptive Banner Ad
  BANNER: TestIds.ADAPTIVE_BANNER,
  // Standard Interstitial Ad
  INTERSTITIAL: TestIds.INTERSTITIAL,
};

let isInitialized = false;
let interstitialInstance: InterstitialAd | null = null;
let isInterstitialLoaded = false;
let lastInterstitialTime = 0;
const INTERSTITIAL_COOLDOWN_MS = 180000; // 3 minutes cooldown between interstitials

/**
 * Initializes Google Mobile Ads SDK safely
 */
export async function initAdService(): Promise<void> {
  if (isInitialized) return;
  try {
    await mobileAds().setRequestConfiguration({
      maxAdContentRating: MaxAdContentRating.G,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    await mobileAds().initialize();
    isInitialized = true;
    console.log('[AdService] Google Mobile Ads initialized successfully');
  } catch (err) {
    console.warn('[AdService] Failed to initialize Mobile Ads:', err);
  }
}

/**
 * Preload interstitial ad in the background
 */
export function preloadInterstitial(): void {
  try {
    if (interstitialInstance) {
      interstitialInstance.removeAllListeners();
      interstitialInstance = null;
    }

    const interstitial = InterstitialAd.createForAdRequest(AD_UNIT_IDS.INTERSTITIAL, {
      requestNonPersonalizedAdsOnly: true,
    });

    interstitial.addAdEventListener(AdEventType.LOADED, () => {
      isInterstitialLoaded = true;
    });

    interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      isInterstitialLoaded = false;
      interstitialInstance = null;
      // Preload next one
      setTimeout(() => {
        preloadInterstitial();
      }, 5000);
    });

    interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
      console.log('[AdService] Interstitial error:', error);
      isInterstitialLoaded = false;
      interstitialInstance = null;
    });

    interstitialInstance = interstitial;
    interstitial.load();
  } catch (err) {
    console.warn('[AdService] Error preloading interstitial:', err);
  }
}

/**
 * Shows an interstitial ad if loaded and cooldown period has passed.
 * Returns true if the ad was shown.
 */
export function showInterstitialIfReady(): boolean {
  const now = Date.now();
  if (!isInterstitialLoaded || !interstitialInstance) {
    preloadInterstitial();
    return false;
  }

  if (now - lastInterstitialTime < INTERSTITIAL_COOLDOWN_MS) {
    return false;
  }

  try {
    interstitialInstance.show();
    lastInterstitialTime = now;
    return true;
  } catch (err) {
    console.warn('[AdService] Failed to show interstitial ad:', err);
    return false;
  }
}

/**
 * Force shows the preloaded test interstitial ad (ignoring cooldown) for testing purposes
 */
export function showTestInterstitial(): boolean {
  if (interstitialInstance && isInterstitialLoaded) {
    try {
      interstitialInstance.show();
      lastInterstitialTime = Date.now();
      return true;
    } catch (err) {
      console.warn('[AdService] Error showing test interstitial:', err);
      return false;
    }
  }
  preloadInterstitial();
  return false;
}
